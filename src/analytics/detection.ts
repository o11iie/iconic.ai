import type { SemanticId } from '@/lib/semantic-id';
import { isRecalled } from '@/learning/scheduler';
import type {
  AttentionEvidence,
  AttentionItem,
  AttentionReason,
  DecaySignal,
  PeriodWindow,
  StrengthItem,
  StructureMasteryView,
} from './contract';
import type { CleanSnapshot } from './integrity';
import { usableInstant } from './integrity';
import { within } from './periods';

/**
 * Weak areas, strengths and decline — all deterministic, all explainable.
 *
 * ## Why thresholds are constants in one object
 *
 * Every classification here is a claim VEO makes about a learner: "you are
 * struggling with this". A claim like that has to be defensible, which means
 * the rule that produced it has to be readable, in one place, and the same
 * every time. Thresholds scattered through conditionals cannot be reviewed,
 * cannot be tuned coherently, and cannot be explained to the person they are
 * being made about.
 *
 * ## Why one bad answer is never enough
 *
 * Everybody has a bad review. Classifying from a single failure would tell a
 * learner they are weak at something they know perfectly well, and the label
 * would be wrong in the way most likely to discourage them. Every rule below
 * demands a minimum sample AND corroborating evidence.
 *
 * ## What these functions do NOT do
 *
 * They make no claim about memory, attention, ability or effort. VEO reports
 * what its own data shows — "recent recall has declined" — and stops there.
 * A learning tool is not in a position to explain why, and language that
 * implies it is would be dressing up a ratio as a diagnosis.
 */

export const DETECTION = {
  /** Minimum reviews before a structure may be classified at all. */
  minReviewsForClassification: 4,

  // ---- weak ------------------------------------------------------------

  /** Retention at or below this counts as repeated failure. */
  weakRetention: 0.6,
  /** Lapses per item at or above this counts as a high lapse rate. */
  weakLapsesPerItem: 1.5,
  /** Mastery at or below this counts as low. Matches Gate 12's band. */
  weakMastery: 0.5,
  /** A drop in recent retention this large counts as declining. */
  weakDecline: 0.15,
  /** Days past due at which an item counts as long overdue. */
  longOverdueDays: 7,
  /** A structure needs at least this many reasons to be flagged. */
  minReasonsToFlag: 1,

  // ---- strong ----------------------------------------------------------

  /** Mastery at or above this is required for a strength. */
  strongMastery: 0.8,
  /** Retention at or above this is required for a strength. */
  strongRetention: 0.85,
  /** Lapses per item at or below this is required for a strength. */
  strongLapsesPerItem: 0.5,
  /** Minimum reviews before a strength may be claimed. */
  minReviewsForStrength: 5,

  // ---- decay -----------------------------------------------------------

  /** Minimum reviews in EACH half before a direction is reported. */
  minSamplePerHalf: 3,
  /** Change smaller than this is called stable, not a direction. */
  stableBand: 0.1,
} as const;

interface StructureEvidence {
  readonly semanticId: SemanticId;
  readonly modelRef: string | null;
  readonly itemCount: number;
  readonly reviews: number;
  readonly lapses: number;
  readonly retention: number | null;
  readonly recentRetention: number | null;
  readonly earlierRetention: number | null;
  readonly recentSample: number;
  readonly earlierSample: number;
  readonly mastery: number;
  readonly overdueDays: number | null;
  readonly consecutiveSuccesses: number;
  readonly lastReviewedAt: string | null;
}

/**
 * Gather the evidence for every structure, once.
 *
 * Weak detection, strong detection and decay all need the same numbers, and
 * three separate passes would be three chances to compute "retention" three
 * subtly different ways.
 */
export function gatherEvidence(
  snapshot: CleanSnapshot,
  views: readonly StructureMasteryView[],
  window: PeriodWindow,
  now: Date,
): Map<SemanticId, StructureEvidence> {
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));

  const eventsByStructure = new Map<SemanticId, { recalled: boolean; at: number }[]>();
  for (const event of snapshot.events) {
    const item = itemsById.get(event.itemId);
    if (!item?.semanticId) continue;

    const at = usableInstant(event.reviewedAt, now);
    if (at === null || !within(window, at)) continue;

    const list = eventsByStructure.get(item.semanticId) ?? [];
    list.push({ recalled: isRecalled(event.rating), at });
    eventsByStructure.set(item.semanticId, list);
  }

  // How far past due a structure's most overdue item is.
  const overdueByStructure = new Map<SemanticId, number>();
  for (const item of snapshot.items) {
    if (!item.semanticId || item.phase === 'suspended' || item.phase === 'new') continue;
    const due = Date.parse(item.dueAt);
    if (!Number.isFinite(due)) continue;

    const days = (now.getTime() - due) / 86_400_000;
    if (days <= 0) continue;
    overdueByStructure.set(
      item.semanticId,
      Math.max(overdueByStructure.get(item.semanticId) ?? 0, days),
    );
  }

  const out = new Map<SemanticId, StructureEvidence>();

  for (const view of views) {
    const events = (eventsByStructure.get(view.semanticId) ?? []).sort((a, b) => a.at - b.at);

    const half = Math.floor(events.length / 2);
    const recent = events.slice(events.length - half);
    const earlier = events.slice(0, events.length - half);

    const share = (list: readonly { recalled: boolean }[]) =>
      list.length === 0 ? null : list.filter((entry) => entry.recalled).length / list.length;

    // Successes since the last failure — the run that a strength rests on.
    let consecutive = 0;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (!events[i]!.recalled) break;
      consecutive += 1;
    }

    out.set(view.semanticId, {
      semanticId: view.semanticId,
      modelRef: view.modelRef,
      itemCount: view.itemCount,
      reviews: events.length,
      lapses: view.lapses,
      retention: share(events),
      recentRetention: share(recent),
      earlierRetention: share(earlier),
      recentSample: recent.length,
      earlierSample: earlier.length,
      mastery: view.mastery,
      overdueDays: overdueByStructure.get(view.semanticId) ?? null,
      consecutiveSuccesses: consecutive,
      lastReviewedAt: view.lastReviewedAt,
    });
  }

  return out;
}

function toAttentionEvidence(evidence: StructureEvidence): AttentionEvidence {
  return {
    reviews: evidence.reviews,
    lapses: evidence.lapses,
    retention: evidence.retention,
    recentRetention: evidence.recentRetention,
    mastery: evidence.mastery,
    overdueDays: evidence.overdueDays,
    itemCount: evidence.itemCount,
  };
}

/**
 * Structures the evidence says need work.
 *
 * Each carries the reasons that flagged it and the numbers behind them, so a
 * learner can always see why. "VEO thinks you're weak here" is not a finding;
 * five reviews, two lapses, 58% recent recall and 61% mastery is.
 */
export function detectWeakAreas(
  evidenceByStructure: ReadonlyMap<SemanticId, StructureEvidence>,
  limit = 10,
): AttentionItem[] {
  const out: AttentionItem[] = [];

  for (const evidence of evidenceByStructure.values()) {
    // A long-overdue structure is worth surfacing even with little review
    // history — that IS the finding, and it needs no performance evidence.
    const longOverdue =
      evidence.overdueDays !== null && evidence.overdueDays >= DETECTION.longOverdueDays;

    if (evidence.reviews < DETECTION.minReviewsForClassification && !longOverdue) continue;

    const reasons: AttentionReason[] = [];

    if (
      evidence.reviews >= DETECTION.minReviewsForClassification &&
      evidence.retention !== null &&
      evidence.retention <= DETECTION.weakRetention
    ) {
      reasons.push('repeated_failures');
    }

    if (
      evidence.itemCount > 0 &&
      evidence.lapses / evidence.itemCount >= DETECTION.weakLapsesPerItem
    ) {
      reasons.push('high_lapse_rate');
    }

    if (
      evidence.reviews >= DETECTION.minReviewsForClassification &&
      evidence.mastery <= DETECTION.weakMastery
    ) {
      reasons.push('low_mastery');
    }

    if (
      evidence.recentRetention !== null &&
      evidence.earlierRetention !== null &&
      evidence.recentSample >= DETECTION.minSamplePerHalf &&
      evidence.earlierSample >= DETECTION.minSamplePerHalf &&
      evidence.earlierRetention - evidence.recentRetention >= DETECTION.weakDecline
    ) {
      reasons.push('declining_recall');
    }

    if (longOverdue) reasons.push('long_overdue');

    if (reasons.length < DETECTION.minReasonsToFlag) continue;

    // Severity orders the list; it is never shown as a score. Built from how
    // far each signal is past its own threshold, so a structure failing three
    // rules badly outranks one failing one rule marginally.
    const shortfalls = [
      evidence.retention === null ? 0 : Math.max(0, DETECTION.weakRetention - evidence.retention),
      Math.max(0, DETECTION.weakMastery - evidence.mastery),
      evidence.itemCount === 0
        ? 0
        : Math.min(1, evidence.lapses / evidence.itemCount / (DETECTION.weakLapsesPerItem * 2)),
      longOverdue ? Math.min(1, (evidence.overdueDays ?? 0) / 30) : 0,
    ];
    const severity = Math.min(
      1,
      shortfalls.reduce((sum, value) => sum + value, 0) / shortfalls.length +
        (reasons.length - 1) * 0.1,
    );

    out.push({
      semanticId: evidence.semanticId,
      modelRef: evidence.modelRef,
      reasons,
      severity,
      evidence: toAttentionEvidence(evidence),
    });
  }

  return out
    .sort((a, b) => b.severity - a.severity || a.semanticId.localeCompare(b.semanticId))
    .slice(0, limit);
}

/**
 * Structures the evidence says are going well.
 *
 * Same discipline inverted: sustained performance over a real sample, not one
 * good answer. Every condition must hold — a structure with high mastery and
 * a string of lapses is not a strength.
 */
export function detectStrengths(
  evidenceByStructure: ReadonlyMap<SemanticId, StructureEvidence>,
  limit = 10,
): StrengthItem[] {
  const out: StrengthItem[] = [];

  for (const evidence of evidenceByStructure.values()) {
    if (evidence.reviews < DETECTION.minReviewsForStrength) continue;
    if (evidence.retention === null) continue;
    if (evidence.mastery < DETECTION.strongMastery) continue;
    if (evidence.retention < DETECTION.strongRetention) continue;
    if (evidence.itemCount === 0) continue;
    if (evidence.lapses / evidence.itemCount > DETECTION.strongLapsesPerItem) continue;

    out.push({
      semanticId: evidence.semanticId,
      modelRef: evidence.modelRef,
      mastery: evidence.mastery,
      retention: evidence.retention,
      reviews: evidence.reviews,
      lapses: evidence.lapses,
      consecutiveSuccesses: evidence.consecutiveSuccesses,
      lastReviewedAt: (evidence.lastReviewedAt ?? null) as StrengthItem['lastReviewedAt'],
    });
  }

  return out
    .sort((a, b) => b.mastery - a.mastery || a.semanticId.localeCompare(b.semanticId))
    .slice(0, limit);
}

/**
 * Measured change in recent performance against the learner's own earlier
 * performance, per structure.
 *
 * Reports the two figures and their difference. It does not interpret them:
 * "recent recall has declined from 91% to 67%" is what the data says, and any
 * sentence about why belongs to the learner, not to VEO.
 */
export function detectDecay(
  evidenceByStructure: ReadonlyMap<SemanticId, StructureEvidence>,
  limit = 10,
): DecaySignal[] {
  const out: DecaySignal[] = [];

  for (const evidence of evidenceByStructure.values()) {
    if (evidence.recentRetention === null || evidence.earlierRetention === null) continue;
    if (evidence.recentSample < DETECTION.minSamplePerHalf) continue;
    if (evidence.earlierSample < DETECTION.minSamplePerHalf) continue;

    const change = evidence.recentRetention - evidence.earlierRetention;

    out.push({
      semanticId: evidence.semanticId,
      earlierRetention: evidence.earlierRetention,
      recentRetention: evidence.recentRetention,
      change,
      earlierSampleSize: evidence.earlierSample,
      recentSampleSize: evidence.recentSample,
      direction:
        Math.abs(change) < DETECTION.stableBand
          ? 'stable'
          : change < 0
            ? 'declining'
            : 'improving',
    });
  }

  // Steepest decline first: that is what a learner needs to see.
  return out
    .sort((a, b) => a.change - b.change || a.semanticId.localeCompare(b.semanticId))
    .slice(0, limit);
}

export type { StructureEvidence };
