import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString } from '@/types/domain/primitives';
import { isRecalled } from '@/learning/scheduler';
import { MASTERY, structureMastery, type StructureMastery } from '@/learning/mastery';
import type { LearningItem } from '@/learning/queue';
import type {
  AnalyticsItemRecord,
  MasteryBand,
  MasteryMetrics,
  PeriodWindow,
  StructureMasteryView,
} from './contract';
import type { CleanSnapshot } from './integrity';
import { usableInstant } from './integrity';
import { within } from './periods';

/**
 * Mastery, aggregated.
 *
 * This module computes NO mastery of its own. `itemMastery` and
 * `structureMastery` live in `@/learning/mastery` and are Gate 12's, and every
 * figure here is built from what they return.
 *
 * That constraint is the point. Two mastery formulas in one product means the
 * recall screen and the analytics screen disagree about whether a learner
 * knows something, and there is no way to tell which is right — both are
 * "the" mastery. So Gate 13 adds banding, counting, period attribution and
 * hierarchy rollup, and not one line of arithmetic about how well a single
 * item is known.
 */

/** Bridge an analytics record back into the shape Gate 12's mastery takes. */
function toLearningItem(record: AnalyticsItemRecord): LearningItem {
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

/** Which model a structure's items belong to, when they agree on one. */
function modelIndex(snapshot: CleanSnapshot): Map<SemanticId, string | null> {
  const index = new Map<SemanticId, string | null>();

  for (const item of snapshot.items) {
    if (!item.semanticId) continue;
    if (!index.has(item.semanticId)) {
      index.set(item.semanticId, item.modelRef);
      continue;
    }
    // Two items about one structure naming different models means VEO cannot
    // say which model to open, so it offers neither rather than guessing.
    if (index.get(item.semanticId) !== item.modelRef) index.set(item.semanticId, null);
  }

  return index;
}

function toView(
  entry: StructureMastery,
  modelRef: string | null,
): StructureMasteryView {
  return {
    semanticId: entry.semanticId,
    mastery: entry.mastery,
    band: entry.band as MasteryBand,
    itemCount: entry.itemCount,
    reviewCount: entry.reviewCount,
    lapses: entry.lapses,
    dueNow: entry.dueNow,
    lastReviewedAt: entry.lastReviewedAt,
    modelRef,
  };
}

/**
 * Structure mastery, as analytics sees it.
 *
 * Exported because weak-area detection, the recommendation engine and the
 * knowledge map all need it, and computing it three times would be three
 * chances for them to disagree about the same structure.
 */
export function structureViews(
  snapshot: CleanSnapshot,
  now: Date,
): StructureMasteryView[] {
  const models = modelIndex(snapshot);
  return structureMastery(snapshot.items.map(toLearningItem), now).map((entry) =>
    toView(entry, models.get(entry.semanticId) ?? null),
  );
}

/** Structures at or above Gate 12's strong threshold. */
export function strongStructures(views: readonly StructureMasteryView[]): Set<SemanticId> {
  return new Set(
    views.filter((view) => view.band === 'strong').map((view) => view.semanticId),
  );
}

export function computeMastery(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
): MasteryMetrics {
  const views = structureViews(snapshot, now);

  const distribution: Record<MasteryBand, number> = {
    untouched: 0,
    struggling: 0,
    developing: 0,
    strong: 0,
  };
  for (const view of views) distribution[view.band] += 1;

  // Item-count weighted, matching how Gate 12 rolls mastery up a hierarchy: a
  // structure carrying twenty items should not count the same as one carrying
  // a single card.
  let weighted = 0;
  let weight = 0;
  for (const view of views) {
    if (view.band === 'untouched') continue;
    weighted += view.mastery * view.itemCount;
    weight += view.itemCount;
  }

  // ---- period-scoped movement --------------------------------------------
  //
  // Mastery itself is a property of an item's CURRENT state and has no "last
  // 7 days" version. What IS period-scoped is movement: which structures
  // crossed a threshold because of a review inside the window.
  //
  // Crossing is inferred from the review history rather than from stored
  // snapshots of past mastery, because VEO does not keep those — and
  // inventing them retroactively would be fabricating a measurement.

  const reviewedInWindow = new Set<SemanticId>();
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));

  for (const event of snapshot.events) {
    const at = usableInstant(event.reviewedAt, now);
    if (at === null || !within(window, at)) continue;
    const semanticId = itemsById.get(event.itemId)?.semanticId;
    if (semanticId) reviewedInWindow.add(semanticId);
  }

  const newlyMastered = views.filter(
    (view) =>
      view.band === 'strong' &&
      reviewedInWindow.has(view.semanticId) &&
      // Reaching strong requires the evidence Gate 12 demands. A structure
      // whose items have barely been seen cannot have become strong this week.
      view.reviewCount >= MASTERY.fullConfidenceReps,
  );

  // Declining: previously carried enough successful reviews to be strong, and
  // is no longer strong. Lapses are the evidence that it slipped.
  const declining = views.filter(
    (view) =>
      view.band !== 'strong' &&
      view.band !== 'untouched' &&
      view.lapses > 0 &&
      view.reviewCount >= MASTERY.fullConfidenceReps &&
      reviewedInWindow.has(view.semanticId),
  );

  return {
    window,
    overall: weight === 0 ? null : weighted / weight,
    structuresTracked: views.length,
    distribution,
    mastered: distribution.strong,
    inProgress: distribution.developing,
    needsAttention: distribution.struggling,
    untouched: distribution.untouched,
    newlyMastered,
    declining,
    structures: views,
  };
}

/** Retention per structure across ALL history, for detection thresholds. */
export function lifetimeStructureRetention(
  snapshot: CleanSnapshot,
): Map<SemanticId, { retention: number; reviews: number }> {
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  const tally = new Map<SemanticId, { recalled: number; total: number }>();

  for (const event of snapshot.events) {
    const semanticId = itemsById.get(event.itemId)?.semanticId;
    if (!semanticId) continue;

    const entry = tally.get(semanticId) ?? { recalled: 0, total: 0 };
    entry.total += 1;
    if (isRecalled(event.rating)) entry.recalled += 1;
    tally.set(semanticId, entry);
  }

  const out = new Map<SemanticId, { retention: number; reviews: number }>();
  for (const [semanticId, entry] of tally) {
    out.set(semanticId, { retention: entry.recalled / entry.total, reviews: entry.total });
  }
  return out;
}

export type { StructureMasteryView, ISODateString };
