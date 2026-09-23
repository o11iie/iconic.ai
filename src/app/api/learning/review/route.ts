import { readBody, submitReviewSchema, withLearner } from '@/learning/server/learning-api';
import type { UUID } from '@/types/domain/primitives';

export const dynamic = 'force-dynamic';

/**
 * Record one answer.
 *
 * The client sends WHAT was answered and HOW the learner rated it. It does not
 * send the resulting schedule, the due date, the interval, the repetition
 * count, or the time the review happened — the server computes every one of
 * those from state it already holds, at an instant it mints itself.
 *
 * The idempotency key is the one thing the client is trusted with, and only
 * because trusting it costs nothing: a key it reuses deduplicates its own
 * submission, and a key it varies cannot reach anyone else's data.
 */
export async function POST(request: Request) {
  const body = await readBody(request, submitReviewSchema);
  if (!body.ok) return body.response;

  return withLearner(async ({ store, userId }, now) => {
    const outcome = await store.submitReview({
      userId,
      itemId: body.data.itemId as UUID,
      rating: body.data.rating,
      correct: body.data.correct,
      responseMs: body.data.responseMs,
      sessionId: (body.data.sessionId as UUID | null) ?? null,
      idempotencyKey: body.data.idempotencyKey,
      now,
      timeZone: body.data.timeZone,
    });

    return {
      deduplicated: outcome.deduplicated,
      // The schedule VEO decided, echoed back so the UI can say when this
      // comes round again — as a result, never as an input.
      state: {
        phase: outcome.state.phase,
        dueAt: outcome.state.dueAt,
        intervalDays: outcome.state.intervalDays,
        repetitions: outcome.state.repetitions,
        lapses: outcome.state.lapses,
      },
    };
  });
}
