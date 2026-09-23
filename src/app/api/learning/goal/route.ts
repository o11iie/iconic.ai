import { goalSchema, readBody, withLearner } from '@/learning/server/learning-api';

export const dynamic = 'force-dynamic';

/**
 * Set the daily review target.
 *
 * The stored value is clamped by the store, and the clamped value is what
 * comes back — so a UI that sent 10,000 shows the 500 that was actually kept
 * rather than the number it asked for.
 */
export async function PUT(request: Request) {
  const body = await readBody(request, goalSchema);
  if (!body.ok) return body.response;

  return withLearner(async ({ store, userId }) => ({
    target: await store.setDailyTarget(userId, body.data.target, body.data.timeZone),
  }));
}
