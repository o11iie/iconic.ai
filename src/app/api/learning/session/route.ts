import {
  endSessionSchema,
  readBody,
  startSessionSchema,
  withLearner,
} from '@/learning/server/learning-api';
import { buildQueue } from '@/learning/queue';
import type { UUID } from '@/types/domain/primitives';

export const dynamic = 'force-dynamic';

/** The learner's in-flight session, so a refresh rejoins rather than restarts. */
export async function GET() {
  return withLearner(async ({ store, userId }) => ({
    session: await store.activeSession(userId),
  }));
}

/**
 * Begin a session.
 *
 * The client may PROPOSE which items to review; the server decides. Requested
 * ids are intersected with the queue the server builds from its own data, so a
 * request cannot pull in a suspended item, an item due next month, or an item
 * belonging to somebody else. Sending nothing means "whatever is due", which
 * is the normal case.
 */
export async function POST(request: Request) {
  const body = await readBody(request, startSessionSchema);
  if (!body.ok) return body.response;

  return withLearner(async ({ store, userId }, now) => {
    const snapshot = await store.snapshot(userId);
    const queue = buildQueue(snapshot.items, now);

    const requested = new Set(body.data.itemIds);
    const planned = (
      requested.size > 0
        ? queue.filter((entry) => requested.has(entry.item.id))
        : queue
    ).map((entry) => entry.item.id as UUID);

    const session = await store.startSession(userId, planned, now);
    const payloads = await store.getPayloads(userId, session.plannedItemIds);

    return {
      session,
      items: session.plannedItemIds.map((itemId) => {
        const item = snapshot.items.find((candidate) => candidate.id === itemId);
        return {
          itemId,
          contentType: item?.contentType ?? 'question',
          semanticId: item?.semanticId ?? null,
          modelRef: item?.modelRef ?? null,
          payload: payloads.get(itemId) ?? {},
        };
      }),
    };
  });
}

/** End a session. Ending one that already ended is a no-op, not an error. */
export async function PATCH(request: Request) {
  const body = await readBody(request, endSessionSchema);
  if (!body.ok) return body.response;

  return withLearner(async ({ store, userId }, now) => ({
    session: await store.endSession(
      userId,
      body.data.sessionId as UUID,
      body.data.status,
      now,
    ),
  }));
}
