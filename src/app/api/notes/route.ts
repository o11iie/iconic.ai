import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createNote, listNotes, type NoteFailure } from '@/notes/server/note-service';
import { NOTE_LIMITS, NOTE_REJECTION_MESSAGES, validateNote } from '@/notes/note';
import { isSemanticId, semanticIdAncestors, type SemanticId } from '@/lib/semantic-id';
import { correlationId, withRequestId } from '@/observability/log';
import { rateLimit } from '@/security/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * A learner's notes: listing, searching and writing.
 *
 * Identity comes from the session on every path. Neither verb accepts an
 * owner id, so neither can be pointed at somebody else's notes.
 *
 * Writing is deliberately NOT entitlement-gated. A learner recording their
 * own understanding is the product working; metering it would be charging
 * rent on their own thinking. Only `export` is a paid capability, because
 * taking the whole corpus out is a different thing from writing in it.
 */

export const NOTE_FAILURE_STATUS: Record<NoteFailure, number> = {
  unauthenticated: 401,
  not_configured: 503,
  // 404 and not 403: see the note at the top of `note-service.ts`. Telling a
  // caller that a note exists but is not theirs is an enumeration oracle.
  not_found: 404,
  unavailable: 503,
};

export const NOTE_FAILURE_MESSAGES: Record<NoteFailure, string> = {
  unauthenticated: 'Sign in to use notes.',
  not_configured: 'Notes are not configured in this deployment.',
  not_found: 'That note does not exist.',
  unavailable: 'VEO could not reach your notes just now. Nothing has been changed.',
};

export function failure(reason: NoteFailure): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: reason, message: NOTE_FAILURE_MESSAGES[reason] } },
    { status: NOTE_FAILURE_STATUS[reason] },
  );
}

export function invalid(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'invalid_request', message } },
    { status: 400 },
  );
}

// ---------------------------------------------------------------------------

const draftSchema = z.object({
  title: z.string().max(NOTE_LIMITS.titleMax * 2).nullish(),
  body: z.string().max(NOTE_LIMITS.bodyMax * 2).optional(),
  semanticId: z.string().max(200).nullish(),
  modelRef: z.string().max(200).nullish(),
  tags: z.array(z.string().max(NOTE_LIMITS.tagMax * 2)).max(NOTE_LIMITS.tagsMax * 4).optional(),
});

/*
 * The Zod bounds above are deliberately LOOSER than `NOTE_LIMITS`.
 *
 * Zod's job here is to stop an unbounded payload being parsed at all; the
 * product rule — what a note may actually contain — belongs to `validateNote`,
 * which is pure and testable and shared with the browser. If Zod enforced the
 * exact limit, a body one character over would be rejected with a generic
 * schema error instead of the sentence that tells a learner what the limit is.
 */

export async function GET(request: Request) {
  return withRequestId(correlationId(request), async () => {
    const url = new URL(request.url);

    const q = url.searchParams.get('q');
    const anchor = url.searchParams.get('semanticId');
    const includeAncestors = url.searchParams.get('includeAncestors') === 'true';
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');

    let semanticId: SemanticId | undefined;
    let anchors: readonly SemanticId[] | undefined;

    if (anchor !== null && anchor !== '') {
      if (!isSemanticId(anchor)) return invalid('That is not a structure VEO recognises.');

      if (includeAncestors) {
        /*
         * The lineage is computed HERE, from the id itself, rather than being
         * accepted from the browser.
         *
         * A client that could supply the ancestor list could supply any list,
         * which would turn a contextual lookup into "fetch these arbitrary
         * anchors". It would still only ever return the caller's own notes —
         * RLS and the owner scope both hold — but it would let one learner
         * probe which structures they themselves have notes on through an
         * endpoint that is supposed to answer one question.
         */
        anchors = [anchor, ...semanticIdAncestors(anchor)];
      } else {
        semanticId = anchor;
      }
    }

    const parsedLimit = limitParam === null ? undefined : Number(limitParam);
    const parsedOffset = offsetParam === null ? undefined : Number(offsetParam);

    if (
      (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) ||
      (parsedOffset !== undefined && !Number.isFinite(parsedOffset))
    ) {
      return invalid('limit and offset must be numbers.');
    }

    const result = await listNotes({
      ...(q ? { q } : {}),
      ...(semanticId ? { semanticId } : {}),
      ...(anchors ? { anchors } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
      ...(parsedOffset !== undefined ? { offset: parsedOffset } : {}),
    });

    if (!result.ok) return failure(result.reason);

    return NextResponse.json({
      ok: true,
      notes: result.value.notes,
      total: result.value.total,
    });
  });
}

export async function POST(request: Request) {
  return withRequestId(correlationId(request), async () => {
    // Abuse control, not an allowance. See `src/security/rate-limit.ts`.
    const limited = await rateLimit(request, 'notes.write');
    if (limited) return limited;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return invalid('Send a JSON body.');
    }

    const parsed = draftSchema.safeParse(payload);
    if (!parsed.success) return invalid('That note is not in a shape VEO can read.');

    const validated = validateNote(parsed.data);
    if (!validated.ok) return invalid(NOTE_REJECTION_MESSAGES[validated.reason]);

    const result = await createNote(validated.note);
    if (!result.ok) return failure(result.reason);

    return NextResponse.json({ ok: true, note: result.value }, { status: 201 });
  });
}
