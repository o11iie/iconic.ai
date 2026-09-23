import { isSemanticId } from '@/lib/semantic-id';
import { withLearner } from '@/learning/server/learning-api';
import { buildQueue, countQueue, nextDueAt, upcomingWithin } from '@/learning/queue';
import { aggregateMastery, retention, structureMastery } from '@/learning/mastery';
import { computeStreak, dailyGoalProgress, recentActivity, summariseProgress } from '@/learning/streaks';

export const dynamic = 'force-dynamic';

/**
 * Everything the recall dashboard and the review screen need.
 *
 * One round trip, computed on the server from persisted rows. The client is
 * sent conclusions, not the arithmetic: a browser that derived its own streak
 * or its own due list could derive a flattering one.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedZone = url.searchParams.get('timeZone')?.trim() ?? '';

  return withLearner(async ({ store, userId }, now) => {
    const snapshot = await store.snapshot(userId);

    // The learner's stored zone wins; a query parameter only fills it in for
    // a session that has not set one. Reading the browser's guess is how the
    // day boundary follows a traveller's laptop rather than their life.
    const timeZone = snapshot.timeZone || requestedZone || 'UTC';

    const queue = buildQueue(snapshot.items, now);
    const structures = structureMastery(snapshot.items, now);
    const activeSession = await store.activeSession(userId);

    return {
      timeZone,
      counts: countQueue(snapshot.items, now),
      queue: queue.map((entry) => ({
        itemId: entry.item.id,
        contentId: entry.item.contentId,
        contentType: entry.item.contentType,
        semanticId: entry.item.semanticId,
        modelRef: entry.item.modelRef,
        bucket: entry.bucket,
        overdueDays: entry.overdueDays,
        phase: entry.item.state.phase,
      })),
      nextDueAt: nextDueAt(snapshot.items, now),
      upcoming: upcomingWithin(snapshot.items, now, 7).length,
      streak: computeStreak(snapshot.days, now, timeZone),
      goal: dailyGoalProgress(snapshot.days, now, timeZone, snapshot.dailyTarget),
      progress: summariseProgress(snapshot.days),
      activity: recentActivity(snapshot.days, now, timeZone),
      retention: retention(snapshot.recentReviews),
      mastery: {
        structures: structures.slice(0, 50),
        // Labels belong to the loaded model, which the server does not have
        // here — the client resolves them from the scene it is showing, and
        // falls back to the id. Inventing a name server-side would be
        // inventing anatomy.
        tree: aggregateMastery(structures, (id) => id, { maxDepth: 3 }),
      },
      activeSession,
      /** For the "View in 3D" affordance: only ids VEO itself minted. */
      reviewable: queue.filter((entry) => isSemanticId(entry.item.semanticId)).length,
    };
  });
}
