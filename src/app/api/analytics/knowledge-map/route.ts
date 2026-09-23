import { withAnalytics } from '@/analytics/server/analytics-api';

export const dynamic = 'force-dynamic';

/**
 * The learner's knowledge as a tree, built from semantic ids alone.
 *
 * Complete without any 3D model: each node reports whether its structure can
 * currently be opened, and with Gate 9 RED the answer is no. Analytics that
 * went blank without geometry would make a learner's history hostage to an
 * asset licence.
 */
export async function GET(request: Request) {
  return withAnalytics(request, (result) => ({ knowledgeMap: result.knowledgeMap }));
}
