import type { SemanticId } from '@/lib/semantic-id';
import { semanticIdToLabel } from '@/lib/semantic-id';
import type { UUID } from '@/types/domain/primitives';
import { classify, type QueueBucket } from '@/learning/queue';
import type { LearningItem } from '@/learning/queue';
import type {
  AttentionItem,
  LearningRecommendation,
  PeriodWindow,
  RecommendationKind,
  RecommendationSet,
  StructureMasteryView,
} from './contract';
import type { CleanSnapshot } from './integrity';
import type { StructureEvidence } from './detection';

/**
 * "What should I study next?"
 *
 * Deterministic. Same data, same instant, same answer — a recommender that
 * shuffled would make "why am I being shown this?" unanswerable, and a learner
 * who refreshed would lose their place.
 *
 * ## What this ranks
 *
 * A learner's own study material against their own review history. It is an
 * internal prioritisation of flashcards and questions: which card to turn over
 * next. It ranks nothing else.
 *
 * ## The rules it cannot break
 *
 * 1. Every recommendation names real items the learner actually has. Nothing
 *    is generated, invented or suggested in the abstract.
 * 2. Every recommendation carries a reason AND the evidence behind it, so
 *    "why this?" is always answerable from data the learner could check.
 * 3. No recommendation offers an action VEO cannot perform. With Gate 9 RED
 *    no anatomy model loads, so `canViewInModel` is false and the UI omits the
 *    3D action rather than offering a button that fails.
 * 4. Too little history returns nothing, flagged as insufficient. A padded
 *    list of plausible suggestions is worse than an empty one, because it
 *    looks like the system knows something.
 */

export const RECOMMENDATION = {
  /** Below this many reviews VEO will not claim to know what to study next. */
  minReviewsForGuidance: 3,
  /** How many recommendations to return. */
  limit: 5,
  /** Items named per recommendation. */
  maxItemsPerRecommendation: 20,

  /** Base priority per kind, before evidence adjusts it. */
  basePriority: {
    overdue_review: 0.8,
    shore_up_weak_area: 0.7,
    due_review: 0.6,
    continue_learning: 0.4,
    start_new_material: 0.25,
  } as const satisfies Record<RecommendationKind, number>,
} as const;

/** What a structure is called, until a loaded model supplies its real name. */
function labelFor(semanticId: SemanticId): string {
  return semanticIdToLabel(semanticId);
}

function bridge(item: CleanSnapshot['items'][number]): LearningItem {
  return {
    id: item.id,
    contentId: item.id,
    contentType: item.contentType,
    semanticId: item.semanticId,
    modelRef: item.modelRef,
    state: {
      phase: item.phase,
      stability: item.stability,
      difficulty: item.difficulty,
      repetitions: item.repetitions,
      lapses: item.lapses,
      step: 0,
      intervalDays: item.intervalDays,
      dueAt: item.dueAt,
      lastReviewedAt: item.lastReviewedAt,
    },
  };
}

interface Options {
  /**
   * Which models can actually be opened right now.
   *
   * Passed in rather than assumed. The analytics engine has no business
   * knowing whether an asset host is configured, and with Gate 9 RED the
   * honest answer for anatomy is "none" — so a recommendation must not
   * advertise a 3D action it cannot perform.
   */
  readonly availableModels: ReadonlySet<string>;
  readonly limit?: number;
}

export function buildRecommendations(
  snapshot: CleanSnapshot,
  views: readonly StructureMasteryView[],
  attention: readonly AttentionItem[],
  evidenceByStructure: ReadonlyMap<SemanticId, StructureEvidence>,
  window: PeriodWindow,
  now: Date,
  options: Options,
): RecommendationSet {
  const limit = options.limit ?? RECOMMENDATION.limit;

  // ---- is there enough to go on? -----------------------------------------
  //
  // Checked against the learner's whole history, not the window: somebody who
  // studied hard last month and nothing this week still has a schedule worth
  // recommending from.
  if (snapshot.events.length < RECOMMENDATION.minReviewsForGuidance) {
    // One exception: a learner with material they have never touched does not
    // need review history to be told to start it. That is not a guess.
    const untouched = snapshot.items.filter((item) => item.phase === 'new');
    if (untouched.length === 0) {
      return { window, sufficientData: false, recommendations: [] };
    }

    return {
      window,
      sufficientData: false,
      recommendations: [
        startNewMaterial(untouched, options.availableModels),
      ],
    };
  }

  const queued = snapshot.items.map((item) => ({ item, queued: classify(bridge(item), now) }));
  const byStructure = new Map<SemanticId, StructureMasteryView>(
    views.map((view) => [view.semanticId, view]),
  );

  const recommendations: LearningRecommendation[] = [];
  const claimed = new Set<UUID>();

  const canView = (modelRef: string | null) =>
    modelRef !== null && options.availableModels.has(modelRef);

  // ---- 1. overdue work, worst first --------------------------------------

  const overdue = queued
    .filter((entry) => entry.queued.bucket === 'overdue')
    .sort((a, b) => b.queued.overdueDays - a.queued.overdueDays);

  if (overdue.length > 0) {
    const items = overdue.slice(0, RECOMMENDATION.maxItemsPerRecommendation);
    const worst = items[0]!;
    const days = Math.round(worst.queued.overdueDays);

    recommendations.push({
      id: 'overdue',
      kind: 'overdue_review',
      title:
        overdue.length === 1
          ? `Review ${labelOrContent(worst.item)}`
          : `Clear ${overdue.length} overdue ${plural(overdue.length, 'review')}`,
      reason:
        days >= 1
          ? `The oldest has been waiting ${days} ${plural(days, 'day')}. Recall decays fastest just after something falls due.`
          : 'These are past their scheduled review.',
      semanticId: worst.item.semanticId,
      modelRef: worst.item.modelRef,
      contentType: contentTypeOf(items.map((entry) => entry.item)),
      itemIds: items.map((entry) => entry.item.id),
      itemCount: overdue.length,
      reviewStatus: 'overdue',
      priority: Math.min(
        1,
        RECOMMENDATION.basePriority.overdue_review + Math.min(0.2, overdue.length / 50),
      ),
      canViewInModel: canView(worst.item.modelRef),
      evidence: {
        overdueDays: worst.queued.overdueDays,
        mastery: byStructure.get(worst.item.semanticId as SemanticId)?.mastery ?? null,
        retention: retentionFor(worst.item.semanticId, evidenceByStructure),
        lapses: worst.item.lapses,
        reviews: worst.item.repetitions + worst.item.lapses,
      },
    });

    for (const entry of items) claimed.add(entry.item.id);
  }

  // ---- 2. weak areas, with the evidence that flagged them ----------------

  for (const flagged of attention.slice(0, 2)) {
    const items = snapshot.items.filter(
      (item) => item.semanticId === flagged.semanticId && !claimed.has(item.id),
    );
    if (items.length === 0) continue;

    recommendations.push({
      id: `weak:${flagged.semanticId}`,
      kind: 'shore_up_weak_area',
      title: `Work on ${labelFor(flagged.semanticId)}`,
      reason: explainAttention(flagged),
      semanticId: flagged.semanticId,
      modelRef: flagged.modelRef,
      contentType: contentTypeOf(items),
      itemIds: items.slice(0, RECOMMENDATION.maxItemsPerRecommendation).map((item) => item.id),
      itemCount: items.length,
      reviewStatus: bucketFor(items, now),
      priority: Math.min(
        1,
        RECOMMENDATION.basePriority.shore_up_weak_area + flagged.severity * 0.2,
      ),
      canViewInModel: canView(flagged.modelRef),
      evidence: {
        overdueDays: flagged.evidence.overdueDays,
        mastery: flagged.evidence.mastery,
        retention: flagged.evidence.retention,
        lapses: flagged.evidence.lapses,
        reviews: flagged.evidence.reviews,
      },
    });

    for (const item of items) claimed.add(item.id);
  }

  // ---- 3. what is due today ----------------------------------------------

  const due = queued.filter(
    (entry) => entry.queued.bucket === 'due' && !claimed.has(entry.item.id),
  );

  if (due.length > 0) {
    const items = due.slice(0, RECOMMENDATION.maxItemsPerRecommendation);
    recommendations.push({
      id: 'due',
      kind: 'due_review',
      title: `${due.length} ${plural(due.length, 'review')} due today`,
      reason: 'Scheduled for today, while recall is still strong enough to reinforce.',
      semanticId: items[0]!.item.semanticId,
      modelRef: items[0]!.item.modelRef,
      contentType: contentTypeOf(items.map((entry) => entry.item)),
      itemIds: items.map((entry) => entry.item.id),
      itemCount: due.length,
      reviewStatus: 'due',
      priority: RECOMMENDATION.basePriority.due_review,
      canViewInModel: canView(items[0]!.item.modelRef),
      evidence: {
        overdueDays: null,
        mastery: byStructure.get(items[0]!.item.semanticId as SemanticId)?.mastery ?? null,
        retention: retentionFor(items[0]!.item.semanticId, evidenceByStructure),
        lapses: 0,
        reviews: 0,
      },
    });

    for (const entry of items) claimed.add(entry.item.id);
  }

  // ---- 4. items mid-learning ---------------------------------------------

  const learning = queued.filter(
    (entry) => entry.queued.bucket === 'learning' && !claimed.has(entry.item.id),
  );

  if (learning.length > 0) {
    const items = learning.slice(0, RECOMMENDATION.maxItemsPerRecommendation);
    recommendations.push({
      id: 'learning',
      kind: 'continue_learning',
      title: `Finish learning ${learning.length} ${plural(learning.length, 'item')}`,
      reason: 'Part-way through their first few repetitions, where short gaps matter most.',
      semanticId: items[0]!.item.semanticId,
      modelRef: items[0]!.item.modelRef,
      contentType: contentTypeOf(items.map((entry) => entry.item)),
      itemIds: items.map((entry) => entry.item.id),
      itemCount: learning.length,
      reviewStatus: 'learning',
      priority: RECOMMENDATION.basePriority.continue_learning,
      canViewInModel: canView(items[0]!.item.modelRef),
      evidence: {
        overdueDays: null,
        mastery: byStructure.get(items[0]!.item.semanticId as SemanticId)?.mastery ?? null,
        retention: retentionFor(items[0]!.item.semanticId, evidenceByStructure),
        lapses: 0,
        reviews: 0,
      },
    });

    for (const entry of items) claimed.add(entry.item.id);
  }

  // ---- 5. new material ---------------------------------------------------

  const untouched = snapshot.items.filter(
    (item) => item.phase === 'new' && !claimed.has(item.id),
  );
  if (untouched.length > 0) {
    recommendations.push(startNewMaterial(untouched, options.availableModels));
  }

  return {
    window,
    sufficientData: true,
    recommendations: recommendations
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .slice(0, limit),
  };
}

// ---------------------------------------------------------------------------

function startNewMaterial(
  untouched: CleanSnapshot['items'],
  availableModels: ReadonlySet<string>,
): LearningRecommendation {
  const first = untouched[0]!;
  return {
    id: 'new',
    kind: 'start_new_material',
    title: `Start ${untouched.length} new ${plural(untouched.length, 'item')}`,
    reason: 'Added to your schedule but not yet studied.',
    semanticId: first.semanticId,
    modelRef: first.modelRef,
    contentType: contentTypeOf(untouched),
    itemIds: untouched.slice(0, RECOMMENDATION.maxItemsPerRecommendation).map((item) => item.id),
    itemCount: untouched.length,
    reviewStatus: 'new',
    priority: RECOMMENDATION.basePriority.start_new_material,
    canViewInModel: first.modelRef !== null && availableModels.has(first.modelRef),
    evidence: { overdueDays: null, mastery: null, retention: null, lapses: 0, reviews: 0 },
  };
}

/**
 * Turn flagged evidence into a sentence.
 *
 * Built from the numbers that produced the flag, so the prose and the evidence
 * can never drift apart: the sentence IS the evidence, read aloud.
 */
function explainAttention(flagged: AttentionItem): string {
  const parts: string[] = [];
  const { evidence } = flagged;

  if (flagged.reasons.includes('declining_recall') && evidence.recentRetention !== null) {
    parts.push(`recent recall is ${percent(evidence.recentRetention)}`);
  } else if (evidence.retention !== null) {
    parts.push(`recall is ${percent(evidence.retention)} across ${evidence.reviews} reviews`);
  }

  if (flagged.reasons.includes('high_lapse_rate') && evidence.lapses > 0) {
    parts.push(`${evidence.lapses} ${plural(evidence.lapses, 'lapse')}`);
  }

  if (flagged.reasons.includes('low_mastery')) {
    parts.push(`mastery is ${percent(evidence.mastery)}`);
  }

  if (flagged.reasons.includes('long_overdue') && evidence.overdueDays !== null) {
    const days = Math.round(evidence.overdueDays);
    parts.push(`overdue by ${days} ${plural(days, 'day')}`);
  }

  if (parts.length === 0) return 'Flagged for review based on your recent history.';

  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function retentionFor(
  semanticId: SemanticId | null,
  evidenceByStructure: ReadonlyMap<SemanticId, StructureEvidence>,
): number | null {
  if (!semanticId) return null;
  return evidenceByStructure.get(semanticId)?.retention ?? null;
}

function contentTypeOf(
  items: readonly CleanSnapshot['items'][number][],
): 'question' | 'flashcard' | 'mixed' {
  const kinds = new Set(items.map((item) => item.contentType));
  if (kinds.size === 1) return [...kinds][0]!;
  return 'mixed';
}

function bucketFor(items: readonly CleanSnapshot['items'][number][], now: Date): QueueBucket | null {
  const first = items[0];
  return first ? classify(bridge(first), now).bucket : null;
}

function labelOrContent(item: CleanSnapshot['items'][number]): string {
  return item.semanticId ? labelFor(item.semanticId) : `this ${item.contentType}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
