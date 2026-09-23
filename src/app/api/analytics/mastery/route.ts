import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/** Mastery, using Gate 12's definition. No second formula exists. */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({
    mastery: result.overview.mastery,
    strengths: result.overview.strengths,
  }));
}
