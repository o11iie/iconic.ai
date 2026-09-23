import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/**
 * Activity and velocity: effort, never achievement.
 *
 * A hundred flashcards completed is a hundred flashcards completed. Nothing
 * in this response may be read as progress.
 */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({
    activity: result.overview.activity,
    velocity: result.overview.velocity,
  }));
}
