import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/**
 * Everything the dashboard needs, in one round trip.
 *
 * The whole surface is computed server-side from persisted rows. The browser
 * receives conclusions, never the events — a client that derived its own
 * retention or streak could derive a flattering one, and two implementations
 * of the same rule eventually disagree.
 */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({ overview: result.overview }));
}
