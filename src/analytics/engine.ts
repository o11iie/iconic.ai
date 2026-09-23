import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString } from '@/types/domain/primitives';
import { classify, countQueue, nextDueAt } from '@/learning/queue';
import type { LearningItem } from '@/learning/queue';
import { computeStreak, dailyGoalProgress } from '@/learning/streaks';
import type {
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsSnapshot,
  KnowledgeMap,
  SessionAnalytics,
  TodayMetrics,
} from './contract';
import { detectDecay, detectStrengths, detectWeakAreas, gatherEvidence } from './detection';
import { clean, type CleanSnapshot } from './integrity';
import { buildKnowledgeMap } from './knowledge-map';
import { computeMastery, strongStructures, structureViews } from './mastery';
import {
  computeActivity,
  computeRecall,
  computeRetention,
  computeSessions,
  computeVelocity,
} from './metrics';
import { resolveWindow } from './periods';
import { buildRecommendations } from './recommendations';

/**
 * The analytics engine.
 *
 * One entry point that takes a raw snapshot and an instant and returns
 * everything the dashboard and the analytics page need. PURE: no clock, no
 * database, no network, no AI.
 *
 * ## Why it is assembled in one pass
 *
 * The blocks share work. Structure mastery feeds weak-area detection, which
 * feeds recommendations; the evidence gathered once for detection is the same
 * evidence decay needs. Computing them separately would mean the same
 * structure could be "struggling" in one panel and "developing" in another,
 * because two passes had rounded or filtered slightly differently. A learner
 * looking at one screen must see one consistent account of themselves.
 *
 * ## Why AI is absent
 *
 * Nothing here calls a model, and nothing here can. Analytics that depended on
 * a language model would return different numbers for the same history on two
 * different days, and a learner could never tell a genuine change from
 * sampling noise. A future explanation layer may READ these facts; it may not
 * produce them.
 */

export interface EngineOptions {
  readonly period: AnalyticsPeriod;
  readonly now: Date;
  /**
   * Which models can actually be opened right now.
   *
   * Resolved by the caller from the anatomy provider, not assumed here. With
   * Gate 9 RED this is empty, and every `canViewInModel` is correspondingly
   * false — which is the honest answer, not a degraded one.
   */
  readonly availableModels: ReadonlySet<string>;
}

export interface AnalyticsResult {
  readonly overview: AnalyticsOverview;
  readonly sessions: readonly SessionAnalytics[];
  readonly knowledgeMap: KnowledgeMap;
}

/** Bridge an analytics record back to the shape the queue functions take. */
function toLearningItem(record: CleanSnapshot['items'][number]): LearningItem {
  return {
    id: record.id,
    contentId: record.id,
    contentType: record.contentType,
    semanticId: record.semanticId,
    modelRef: record.modelRef,
    state: {
      phase: record.phase,
      stability: record.stability,
      difficulty: record.difficulty,
      repetitions: record.repetitions,
      lapses: record.lapses,
      step: 0,
      intervalDays: record.intervalDays,
      dueAt: record.dueAt,
      lastReviewedAt: record.lastReviewedAt,
    },
  };
}

/**
 * Today, from persisted rows.
 *
 * Reuses Gate 12's streak and goal functions rather than recomputing them, so
 * the figure on the analytics page is necessarily the figure on the recall
 * page. Two implementations of "current streak" is how a product tells a
 * learner two different numbers in two places.
 */
function computeToday(snapshot: CleanSnapshot, now: Date): TodayMetrics {
  const items = snapshot.items.map(toLearningItem);
  const counts = countQueue(items, now);
  const streak = computeStreak(snapshot.days, now, snapshot.timeZone);
  const goal = dailyGoalProgress(snapshot.days, now, snapshot.timeZone, snapshot.dailyTarget);

  return {
    dueNow: counts.actionable,
    overdue: counts.overdue,
    reviewsCompleted: goal.completed,
    goalTarget: goal.target,
    goalMet: goal.met,
    streakCurrent: streak.current,
    streakLongest: streak.longest,
    studiedToday: streak.studiedToday,
    nextDueAt: nextDueAt(items, now) as ISODateString | null,
  };
}

export function analyse(raw: AnalyticsSnapshot, options: EngineOptions): AnalyticsResult {
  const { now, period, availableModels } = options;

  // Integrity first. Everything downstream works from records that survived,
  // so an impossible row can never become a statistic.
  const snapshot = clean(raw, now);
  const window = resolveWindow(period, now, snapshot.timeZone);

  // Computed once and shared, so every panel describes the same learner.
  const views = structureViews(snapshot, now);
  const evidence = gatherEvidence(snapshot, views, window, now);

  const attention = detectWeakAreas(evidence);
  const strengths = detectStrengths(evidence);
  const decay = detectDecay(evidence);

  const recommendations = buildRecommendations(
    snapshot,
    views,
    attention,
    evidence,
    window,
    now,
    { availableModels },
  );

  const overview: AnalyticsOverview = {
    window,
    // The gate for the entire surface. False means no reviews have ever been
    // completed, so every figure below is a structural zero rather than a
    // measurement, and the UI shows calls to action instead of statistics.
    hasData: snapshot.events.length > 0,
    today: computeToday(snapshot, now),
    retention: computeRetention(snapshot, window, now),
    mastery: computeMastery(snapshot, window, now),
    activity: computeActivity(snapshot, window, now),
    velocity: computeVelocity(snapshot, window, now, strongStructures(views)),
    attention,
    strengths,
    decay,
    recommendations,
    integrity: snapshot.integrity,
  };

  return {
    overview,
    sessions: computeSessions(snapshot, window, now),
    knowledgeMap: buildKnowledgeMap(snapshot, views, { availableModels }),
  };
}

/** Recall metrics, for the analytics page's recall panel. */
export function analyseRecall(raw: AnalyticsSnapshot, options: EngineOptions) {
  const snapshot = clean(raw, options.now);
  const window = resolveWindow(options.period, options.now, snapshot.timeZone);
  return computeRecall(snapshot, window, options.now);
}

/** Which structures a learner has actually studied, for the 3D affordance. */
export function studiedStructures(raw: AnalyticsSnapshot, now: Date): Set<SemanticId> {
  const snapshot = clean(raw, now);
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  const out = new Set<SemanticId>();

  for (const event of snapshot.events) {
    const semanticId = itemsById.get(event.itemId)?.semanticId;
    if (semanticId) out.add(semanticId);
  }
  return out;
}

/** Whether an item is currently actionable, for a recommendation's status. */
export function itemBucket(record: CleanSnapshot['items'][number], now: Date) {
  return classify(toLearningItem(record), now).bucket;
}
