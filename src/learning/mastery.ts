import type { SemanticId } from '@/lib/semantic-id';
import { semanticIdAncestors } from '@/lib/semantic-id';
import type { ISODateString } from '@/types/domain/primitives';
import { recallProbability, type ReviewRating, type ReviewState } from './scheduler';
import type { LearningItem } from './queue';

/**
 * Mastery, from real review data.
 *
 * ## What mastery is NOT
 *
 * It is not "cards completed". A learner who has answered a card forty times
 * and got it wrong on thirty of them has completed a great deal and mastered
 * nothing. Counting activity as achievement is the single most common way a
 * learning product lies to its users — the number goes up, it feels like
 * progress, and it measures attendance.
 *
 * ## What it is here
 *
 * Estimated probability that the learner could recall the item RIGHT NOW,
 * discounted by how much evidence supports that estimate.
 *
 *     mastery = retrievability × confidence
 *
 * `retrievability` comes from the same forgetting curve the scheduler uses, so
 * mastery decays on its own between reviews. That is the point: knowledge
 * fades, and a dashboard that shows 94% for something last seen in March is
 * reporting history, not knowledge.
 *
 * `confidence` grows with successful repetitions and is cut by lapses, so one
 * lucky answer cannot read as mastery.
 *
 * Both parts are deterministic and explainable: given a state and an instant,
 * the number can be derived by hand.
 */

export const MASTERY = {
  /**
   * Repetitions at which evidence is considered complete.
   *
   * Three successful reviews spread over increasing intervals is the point at
   * which the schedule itself starts to trust an item. Below that, mastery is
   * held down however good the recall estimate looks.
   */
  fullConfidenceReps: 3,

  /** Floor on confidence, so a single good answer still registers. */
  minConfidence: 0.25,

  /** How much each lapse reduces confidence, before the floor. */
  lapsePenalty: 0.15,

  /** Mastery at or above this counts as "strong". */
  strongThreshold: 0.8,
  /** Mastery at or below this counts as "struggling". */
  strugglingThreshold: 0.5,

  /**
   * Lapses PER ITEM at or above which a structure counts as difficult,
   * whatever it scores.
   *
   * Per item, not in total. A structure's lapse count is the sum across its
   * items, so a total-based threshold would scale with how much content exists
   * about a structure: twenty well-known items that each lapsed once years ago
   * sum to twenty, and the structure would be branded "struggling" forever for
   * the offence of being well covered.
   */
  difficultLapses: 3,
} as const;

/**
 * Mastery of one item, 0..1.
 *
 * A `new` item is 0 — not because the learner knows nothing about the subject,
 * but because VEO has no evidence either way, and 0 is the honest number for
 * "no evidence".
 */
export function itemMastery(state: ReviewState, now: Date): number {
  if (state.phase === 'new' || state.stability <= 0) return 0;

  const lastReviewed = state.lastReviewedAt ? Date.parse(state.lastReviewedAt) : null;
  const elapsedDays =
    lastReviewed !== null && Number.isFinite(lastReviewed)
      ? Math.max(0, (now.getTime() - lastReviewed) / 86_400_000)
      : 0;

  const retrievability = recallProbability(elapsedDays, state.stability);

  const reps = Math.min(state.repetitions, MASTERY.fullConfidenceReps);
  const fromReps = reps / MASTERY.fullConfidenceReps;
  const confidence = Math.max(
    MASTERY.minConfidence,
    fromReps - state.lapses * MASTERY.lapsePenalty,
  );

  return clamp01(retrievability * Math.min(1, confidence));
}

// ---------------------------------------------------------------------------
// Structure-level
// ---------------------------------------------------------------------------

export interface StructureMastery {
  readonly semanticId: SemanticId;
  /** 0..1. */
  readonly mastery: number;
  readonly itemCount: number;
  readonly reviewCount: number;
  readonly lapses: number;
  readonly dueNow: number;
  readonly lastReviewedAt: ISODateString | null;
  readonly band: 'untouched' | 'struggling' | 'developing' | 'strong';
}

/**
 * Mastery per structure.
 *
 * Averaged across the items about that structure, because a structure with one
 * well-known flashcard and one forgotten question is not mastered — and taking
 * the best item would let a learner reach 100% by never reviewing the hard one.
 */
export function structureMastery(
  items: readonly LearningItem[],
  now: Date,
): readonly StructureMastery[] {
  const groups = new Map<SemanticId, LearningItem[]>();

  for (const item of items) {
    if (!item.semanticId) continue;
    const existing = groups.get(item.semanticId);
    if (existing) existing.push(item);
    else groups.set(item.semanticId, [item]);
  }

  const out: StructureMastery[] = [];

  for (const [semanticId, group] of groups) {
    let total = 0;
    let reviewCount = 0;
    let lapses = 0;
    let dueNow = 0;
    let lastReviewed: number | null = null;

    for (const item of group) {
      total += itemMastery(item.state, now);
      reviewCount += item.state.repetitions;
      lapses += item.state.lapses;

      const due = Date.parse(item.state.dueAt);
      if (
        item.state.phase !== 'suspended' &&
        Number.isFinite(due) &&
        due <= now.getTime()
      ) {
        dueNow += 1;
      }

      const reviewed = item.state.lastReviewedAt
        ? Date.parse(item.state.lastReviewedAt)
        : null;
      if (reviewed !== null && Number.isFinite(reviewed)) {
        if (lastReviewed === null || reviewed > lastReviewed) lastReviewed = reviewed;
      }
    }

    const mastery = group.length > 0 ? total / group.length : 0;

    out.push({
      semanticId,
      mastery,
      itemCount: group.length,
      reviewCount,
      lapses,
      dueNow,
      lastReviewedAt: lastReviewed === null ? null : new Date(lastReviewed).toISOString(),
      band: band(mastery, reviewCount, lapses, group.length),
    });
  }

  // Deterministic: weakest first, then by id.
  return out.sort(
    (a, b) => a.mastery - b.mastery || a.semanticId.localeCompare(b.semanticId),
  );
}

function band(
  mastery: number,
  reviewCount: number,
  lapses: number,
  itemCount: number,
): StructureMastery['band'] {
  if (reviewCount === 0) return 'untouched';

  // Per item. See the note on MASTERY.difficultLapses: comparing the summed
  // lapse count against a per-item threshold makes the band a function of how
  // much content a structure has rather than of how well it is known.
  const lapsesPerItem = itemCount > 0 ? lapses / itemCount : 0;
  if (lapsesPerItem >= MASTERY.difficultLapses) return 'struggling';

  if (mastery >= MASTERY.strongThreshold) return 'strong';
  if (mastery <= MASTERY.strugglingThreshold) return 'struggling';
  return 'developing';
}

// ---------------------------------------------------------------------------
// Aggregation up the hierarchy
// ---------------------------------------------------------------------------

export interface MasteryNode {
  readonly semanticId: SemanticId;
  readonly label: string;
  readonly mastery: number;
  readonly itemCount: number;
  readonly children: readonly MasteryNode[];
}

/**
 * Roll structure mastery up a hierarchy.
 *
 * The hierarchy comes from the semantic ids themselves — `veo.x.y.z` is inside
 * `veo.x.y` — so nothing anatomical is hard-coded and the same aggregation
 * serves a chemistry or engineering model unchanged.
 *
 * A parent's mastery is the item-count-weighted mean of its descendants, not a
 * mean of means: a system with one well-known structure and one barely-touched
 * structure carrying twenty items should read closer to the twenty.
 *
 * `labelFor` is injected because names belong to the loaded model, and this
 * module must not reach into a scene to find them.
 */
export function aggregateMastery(
  structures: readonly StructureMastery[],
  labelFor: (semanticId: SemanticId) => string,
  options: { readonly maxDepth?: number } = {},
): readonly MasteryNode[] {
  if (structures.length === 0) return [];

  // Weighted totals per ancestor path.
  const totals = new Map<SemanticId, { sum: number; items: number }>();

  const add = (id: SemanticId, mastery: number, items: number) => {
    const existing = totals.get(id);
    if (existing) {
      existing.sum += mastery * items;
      existing.items += items;
    } else {
      totals.set(id, { sum: mastery * items, items });
    }
  };

  for (const structure of structures) {
    add(structure.semanticId, structure.mastery, structure.itemCount);
    for (const ancestor of semanticIdAncestors(structure.semanticId)) {
      add(ancestor, structure.mastery, structure.itemCount);
    }
  }

  // Build the tree from the shallowest ids that appear.
  const depth = (id: SemanticId) => id.split('.').length;
  const known = [...totals.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const minDepth = known.length > 0 ? depth(known[0] as SemanticId) : 0;
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;

  const build = (id: SemanticId, level: number): MasteryNode => {
    const entry = totals.get(id);
    const children =
      level >= maxDepth
        ? []
        : known
            .filter((candidate) => isDirectChild(candidate, id))
            .map((child) => build(child, level + 1));

    return {
      semanticId: id,
      label: labelFor(id),
      mastery: entry && entry.items > 0 ? entry.sum / entry.items : 0,
      itemCount: entry?.items ?? 0,
      children,
    };
  };

  return known
    .filter((id) => depth(id) === minDepth)
    .map((id) => build(id, 1));
}

function isDirectChild(candidate: SemanticId, parent: SemanticId): boolean {
  if (!candidate.startsWith(`${parent}.`)) return false;
  return candidate.slice(parent.length + 1).includes('.') === false;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionSummary {
  /** Share of reviews where the learner recalled the item. Null with no data. */
  readonly overall: number | null;
  /** The same over the most recent reviews only. */
  readonly recent: number | null;
  readonly totalReviews: number;
  readonly recentReviews: number;
}

/** One recorded review. The raw evidence everything else is derived from. */
export interface ReviewRecord {
  readonly itemId: string;
  readonly rating: ReviewRating;
  readonly reviewedAt: ISODateString;
}

/**
 * Retention: how often the learner actually recalled what they were shown.
 *
 * Null rather than 0 or 100 when there is nothing to measure. A brand-new
 * account showing "0% retention" is a lie in the discouraging direction, and
 * "100%" is a lie in the other.
 */
export function retention(
  records: readonly ReviewRecord[],
  recentWindow = 50,
): RetentionSummary {
  if (records.length === 0) {
    return { overall: null, recent: null, totalReviews: 0, recentReviews: 0 };
  }

  const sorted = [...records].sort(
    (a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt),
  );

  const recalled = (subset: readonly ReviewRecord[]) =>
    subset.filter((record) => record.rating !== 'again').length / subset.length;

  const recentSlice = sorted.slice(-recentWindow);

  return {
    overall: recalled(sorted),
    recent: recalled(recentSlice),
    totalReviews: sorted.length,
    recentReviews: recentSlice.length,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
