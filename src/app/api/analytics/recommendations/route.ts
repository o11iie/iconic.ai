import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/**
 * What to study next.
 *
 * Deterministic and derived entirely from the learner's own material and
 * history. `sufficientData: false` with an empty list is a real answer — VEO
 * would rather say it does not know than pad a list with plausible filler.
 */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({
    recommendations: result.overview.recommendations,
  }));
}
