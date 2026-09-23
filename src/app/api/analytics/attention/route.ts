import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/**
 * What needs work, and the evidence that says so.
 *
 * Every flagged structure carries the numbers that flagged it, so "why this?"
 * is always answerable from data the learner could check themselves.
 */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({
    attention: result.overview.attention,
    decay: result.overview.decay,
    strengths: result.overview.strengths,
  }));
}
