import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/** Recent sessions, measured from their events rather than stored counters. */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({ sessions: result.sessions }));
}
