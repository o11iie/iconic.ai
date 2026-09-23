import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/** Retention: how often the learner recalled what they were shown. */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({
    retention: result.overview.retention,
    decay: result.overview.decay,
  }));
}
