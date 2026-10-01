import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteNote, updateNote } from '@/notes/server/note-service';
import { NOTE_LIMITS, NOTE_REJECTION_MESSAGES, validateNote } from '@/notes/note';
import { correlationId, withRequestId } from '@/observability/log';
import { rateLimit } from '@/security/rate-limit';
import type { UUID } from '@/types/domain/primitives';
import { failure, invalid } from '../route';

export const dynamic = 'force-dynamic';

/**
 * One note, by id.
 *
 * The id in the path is a CLIENT-SUPPLIED IDENTIFIER, which is the whole
 * security story of this file. It is validated as a UUID before it reaches a
 * query, and the service scopes every statement by the session's owner id as
 * well as the note id — so a well-formed id belonging to somebody else
 * matches nothing and answers 404, exactly as an id that does not exist does.
 */

const idSchema = z.string().uuid();

const draftSchema = z.object({
  title: z.string().max(NOTE_LIMITS.titleMax * 2).nullish(),
  body: z.string().max(NOTE_LIMITS.bodyMax * 2).optional(),
  semanticId: z.string().max(200).nullish(),
  modelRef: z.string().max(200).nullish(),
  tags: z.array(z.string().max(NOTE_LIMITS.tagMax * 2)).max(NOTE_LIMITS.tagsMax * 4).optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return withRequestId(correlationId(request), async () => {
    const limited = await rateLimit(request, 'notes.write');
    if (limited) return limited;

    const { id } = await context.params;
    const parsedId = idSchema.safeParse(id);
    /*
     * A malformed id answers 404, not 400.
     *
     * 400 would distinguish "that is not an id" from "that is an id you
     * cannot have", which hands back one bit about the id space. There is
     * nothing a learner can do differently with either answer.
     */
    if (!parsedId.success) return failure('not_found');

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

    const result = await updateNote(parsedId.data as UUID, validated.note);
    if (!result.ok) return failure(result.reason);

    return NextResponse.json({ ok: true, note: result.value });
  });
}

export async function DELETE(request: Request, context: Context) {
  return withRequestId(correlationId(request), async () => {
    const limited = await rateLimit(request, 'notes.write');
    if (limited) return limited;

    const { id } = await context.params;
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) return failure('not_found');

    const result = await deleteNote(parsedId.data as UUID);
    if (!result.ok) return failure(result.reason);

    return NextResponse.json({ ok: true });
  });
}
