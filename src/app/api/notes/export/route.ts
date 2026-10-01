import { NextResponse } from 'next/server';
import { allNotes } from '@/notes/server/note-service';
import { notesToMarkdown } from '@/notes/note';
import { requireEntitlement } from '@/billing/server/gate';
import { correlationId, serverLog, withRequestId } from '@/observability/log';
import { rateLimit } from '@/security/rate-limit';
import { failure } from '../route';

export const dynamic = 'force-dynamic';

/**
 * Take your notes with you.
 *
 * ## The first thing to use `export.notes`
 *
 * That entitlement key has existed since Gate 1, appears in the plan
 * comparison a learner reads before paying, and until now was granted by
 * nothing and checked by nobody. A capability sold and never implemented is
 * the defect Gate 14 found in `resolveEntitlements` and Gate 15 found in the
 * account lifecycle; this closes the third instance.
 *
 * ## Why Markdown
 *
 * It opens in anything, reads fine without VEO, and survives VEO. An export
 * that needs the product it came from in order to be read is not an export,
 * it is a backup.
 *
 * ## Why this is gated and writing is not
 *
 * Writing a note is the product working — metering it would be charging rent
 * on somebody's own thinking. Taking the entire corpus out in one request is
 * a different action with a different cost, and it is the one the plan
 * comparison has always said was paid.
 */
export async function GET(request: Request) {
  return withRequestId(correlationId(request), async () => {
    /*
     * Rate limit first: the limit is what bounds how often the entitlement
     * lookup and the full-corpus read below can be made to run.
     */
    const limited = await rateLimit(request, 'notes.export');
    if (limited) return limited;

    /*
     * The gate resolves identity itself and answers 401 for an anonymous
     * caller, 403 `plan_required` without the entitlement — the same
     * vocabulary every other gated action uses, so the UI's existing refusal
     * handling applies without a special case.
     */
    const gate = await requireEntitlement('export.notes');
    if (!gate.ok) return gate.failure.response;

    const result = await allNotes();
    if (!result.ok) return failure(result.reason);

    const exportedAt = new Date().toISOString();
    const document = notesToMarkdown(result.value, exportedAt);

    // The count is logged; no title and no body. A note is personal data and
    // a log is the wrong place for it.
    serverLog('info', 'notes.exported', { count: result.value.length });

    return new NextResponse(document, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        /*
         * A fixed filename, not one built from anything a learner typed. A
         * note title in a Content-Disposition header is a header-injection
         * and path-traversal surface for no benefit — the date is what makes
         * one export distinguishable from another.
         */
        'content-disposition': `attachment; filename="veo-notes-${exportedAt.slice(0, 10)}.md"`,
        'cache-control': 'no-store',
      },
    });
  });
}
