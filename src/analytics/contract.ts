import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import type { ReviewPhase, ReviewRating } from '@/learning/scheduler';
import type { QueueBucket } from '@/learning/queue';

/**
 * The analytics contract.
 *
 * Gate 12 answers "when should this learner review this?". Gate 13 answers
 * "what does VEO know about how this learner is learning?" — and the second
 * question is far easier to answer dishonestly, because every plausible number
 * looks like insight.
 *
 * So every field below carries its definition. A metric whose calculation is
 * not written down is a metric nobody can check, and "progress: 0.62" with no
 * stated meaning is indistinguishable from a number that was made up. There is
 * deliberately no field called `score`, `performance` or `progress` on its own.
 *
 * ## The one rule everything here obeys
 *
 * Every value is derived from persisted review events, review states, sessions
 * and daily activity rows. Nothing is estimated, smoothed, or filled in. Where
 * there is no evidence the value is `null` — never 0, which reads as a
 * measurement, and never a default that reads as a fact.
 */

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * The windows analytics may be scoped to.
 *
 * A closed set, because an arbitrary date range from a client is both a
 * validation surface and a way to ask for an unbounded scan.
 */
export const ANALYTICS_PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const PERIOD_DAYS: Record<AnalyticsPeriod, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

export const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

/**
 * The resolved window a figure was computed over.
 *
 * Carried on every metric block rather than assumed, because the dashboard
 * mixes period-scoped figures (activity, recent retention) with lifetime ones
 * (mastery, which is a property of the item's current state and has no
 * meaningful "last 7 days" version). Labelling which is which is the
 * difference between an informative dashboard and a misleading one.
 */
export interface PeriodWindow {
  readonly period: AnalyticsPeriod;
  readonly label: string;
  /** Inclusive lower bound, or null for all time. */
  readonly from: ISODateString | null;
  /** The instant the analytics were computed. Server time. */
  readonly to: ISODateString;
  /** Days in the window, or null for all time. */
  readonly days: number | null;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export const TREND_GRANULARITIES = ['day', 'week'] as const;
export type TrendGranularity = (typeof TREND_GRANULARITIES)[number];

/**
 * One point on a time series.
 *
 * `value` is null when the bucket contains no events. That is not the same as
 * zero: a day with no reviews has no retention, and drawing it at 0% would
 * show a catastrophic dip where the learner simply did not study.
 */
export interface TrendPoint {
  /** `YYYY-MM-DD`, in the learner's timezone. Week buckets use their Monday. */
  readonly date: string;
  readonly value: number | null;
  /** How many events the value was computed from. 0 means no evidence. */
  readonly sampleSize: number;
}

// ---------------------------------------------------------------------------
// Retention — did the learner recall what they were shown?
// ---------------------------------------------------------------------------

/**
 * Retention is the share of reviews the learner recalled: every rating other
 * than `again` counts as recall, matching Gate 12's `isRecalled`.
 *
 * It is a property of REVIEWS, so it is period-scoped and its sample size is
 * stated. A 100% retention built from two reviews is not the same claim as one
 * built from two hundred, and the UI needs to be able to say so.
 */
export interface RetentionMetrics {
  readonly window: PeriodWindow;
  /** Share recalled across the whole window. Null with no reviews in it. */
  readonly overall: number | null;
  /** The same over the most recent `recentSampleSize` reviews. */
  readonly recent: number | null;
  readonly totalReviews: number;
  readonly recentSampleSize: number;
  /**
   * How the recent half of the window compares with the earlier half.
   *
   * The window's reviews are split by COUNT into two equal halves, so the two
   * sides are the same size by construction. Null unless BOTH halves carry at
   * least `MIN_SAMPLE_FOR_CHANGE` reviews: a direction computed from three
   * reviews against two is noise presented as a finding.
   *
   * Note this is not `recent - (overall - recent)`. `recent` above is a
   * separate display figure over the last few reviews, and mixing the two
   * would compare overlapping samples.
   */
  readonly change: number | null;
  readonly trend: readonly TrendPoint[];
  readonly granularity: TrendGranularity;
  /** Per structure, weakest first. Only structures with reviews in window. */
  readonly byStructure: readonly StructureRetention[];
  /** Rolled up the semantic hierarchy — domain, system, region. */
  readonly byGroup: readonly GroupRetention[];
}

export interface StructureRetention {
  readonly semanticId: SemanticId;
  readonly retention: number;
  readonly reviews: number;
  readonly lapses: number;
}

export interface GroupRetention {
  readonly semanticId: SemanticId;
  /** How deep in the hierarchy: `veo.anatomy.heart` is depth 1. */
  readonly depth: number;
  readonly retention: number;
  readonly reviews: number;
  readonly structures: number;
}

// ---------------------------------------------------------------------------
// Recall — how the learner rated themselves, and how hard it was
// ---------------------------------------------------------------------------

/**
 * Recall describes the QUALITY of retrieval, where retention describes whether
 * it happened at all. The distinction matters: a learner passing everything on
 * `hard` is retaining perfectly and struggling badly, and one number cannot
 * say both.
 */
export interface RecallMetrics {
  readonly window: PeriodWindow;
  /**
   * Share of reviews where VEO could check the answer AND it matched.
   *
   * Null when nothing in the window was checkable. Self-rated flashcards have
   * no right answer, so they are excluded rather than counted as correct.
   */
  readonly accuracy: number | null;
  readonly checkableReviews: number;
  /** How many reviews carried each rating. */
  readonly distribution: Record<ReviewRating, number>;
  /**
   * Mean rating on a 0..1 scale: again 0, hard 1/3, good 2/3, easy 1.
   *
   * An ordinal scale treated as interval, which is an approximation — stated
   * here so nobody mistakes it for a measurement of anything finer.
   */
  readonly averageQuality: number | null;
  /** Median milliseconds to answer. Median, not mean: one interruption skews a mean. */
  readonly medianResponseMs: number | null;
  readonly totalReviews: number;
  /** Items that keep going wrong, worst first. */
  readonly difficultItems: readonly DifficultItem[];
}

export interface DifficultItem {
  readonly itemId: UUID;
  readonly semanticId: SemanticId | null;
  readonly contentType: 'question' | 'flashcard';
  readonly reviews: number;
  readonly failures: number;
  readonly lapses: number;
  readonly retention: number;
}

// ---------------------------------------------------------------------------
// Mastery — what the learner can currently recall
// ---------------------------------------------------------------------------

/**
 * Mastery reuses Gate 12's definition exactly: retrievability × confidence, so
 * it decays between reviews and one lucky answer cannot read as mastery. This
 * module introduces NO second formula — it aggregates and bands what
 * `src/learning/mastery.ts` computes.
 *
 * Mastery is a property of an item's CURRENT state, so it is not period
 * scoped. `newlyMastered` and `declining` are the period-scoped parts, and
 * they say so.
 */
export interface MasteryMetrics {
  readonly window: PeriodWindow;
  /** Item-count-weighted mean across every structure. Null with no items. */
  readonly overall: number | null;
  readonly structuresTracked: number;
  /** Counts by band, using Gate 12's thresholds. */
  readonly distribution: Record<MasteryBand, number>;
  /** Structures at or above the strong threshold. */
  readonly mastered: number;
  readonly inProgress: number;
  readonly needsAttention: number;
  /** Untouched items are NOT failures — they are simply unmeasured. */
  readonly untouched: number;
  /** Reached the strong band on a review inside the window. */
  readonly newlyMastered: readonly StructureMasteryView[];
  /** Left the strong band inside the window. */
  readonly declining: readonly StructureMasteryView[];
  /** Every tracked structure, weakest first. */
  readonly structures: readonly StructureMasteryView[];
}

export const MASTERY_BANDS = ['untouched', 'struggling', 'developing', 'strong'] as const;
export type MasteryBand = (typeof MASTERY_BANDS)[number];

export interface StructureMasteryView {
  readonly semanticId: SemanticId;
  readonly mastery: number;
  readonly band: MasteryBand;
  readonly itemCount: number;
  readonly reviewCount: number;
  readonly lapses: number;
  readonly dueNow: number;
  readonly lastReviewedAt: ISODateString | null;
  /** The model this structure belongs to, when the items name one. */
  readonly modelRef: string | null;
}

// ---------------------------------------------------------------------------
// Activity — what the learner actually did
// ---------------------------------------------------------------------------

/**
 * Activity is effort, never achievement. A hundred flashcards completed is a
 * hundred flashcards completed; it is not a hundred structures mastered, and
 * nothing in this block may be read as progress.
 */
export interface ActivityMetrics {
  readonly window: PeriodWindow;
  readonly reviews: number;
  readonly questionsAnswered: number;
  readonly flashcardsReviewed: number;
  /**
   * Seconds spent answering, summed from persisted per-review durations.
   *
   * NOT wall-clock time with the tab open: a page left open overnight is not
   * eight hours of study, and counting it would be the single easiest way to
   * flatter a learner with a number they did not earn. Bounded per review, so
   * one stuck timer cannot dominate a week.
   */
  readonly studySeconds: number;
  readonly sessions: number;
  readonly completedSessions: number;
  readonly abandonedSessions: number;
  /** Median session length in seconds. Null with no completed sessions. */
  readonly medianSessionSeconds: number | null;
  /** Days with at least one completed review. */
  readonly activeDays: number;
  /** Active days as a share of days in the window. Null for all time. */
  readonly consistency: number | null;
  readonly reviewsPerDay: readonly TrendPoint[];
  readonly studySecondsPerDay: readonly TrendPoint[];
  readonly granularity: TrendGranularity;
}

/**
 * Velocity: how fast the learner is moving through material.
 *
 * Deliberately separate from mastery, and every field names what it counts.
 * `structuresEncountered` is first-contact, not comprehension.
 */
export interface VelocityMetrics {
  readonly window: PeriodWindow;
  readonly itemsStarted: number;
  readonly structuresEncountered: number;
  readonly structuresReachingStrong: number;
  /** Reviews per active day — pace when studying, not pace overall. */
  readonly reviewsPerActiveDay: number | null;
  /** Median seconds per review. */
  readonly secondsPerReview: number | null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionAnalytics {
  readonly sessionId: UUID;
  readonly startedAt: ISODateString;
  readonly endedAt: ISODateString | null;
  readonly status: 'active' | 'completed' | 'abandoned';
  readonly itemsPlanned: number;
  readonly itemsAttempted: number;
  /** Null when the session is still open or its timestamps are unusable. */
  readonly durationSeconds: number | null;
  /** Share recalled within the session. Null with no reviews. */
  readonly retention: number | null;
  /** Share correct among checkable answers. Null when none were checkable. */
  readonly accuracy: number | null;
  readonly averageQuality: number | null;
  readonly structuresCovered: number;
  readonly difficultItems: number;
}

// ---------------------------------------------------------------------------
// Attention — what needs work, and why
// ---------------------------------------------------------------------------

/**
 * Why a structure is being flagged.
 *
 * A closed set, so the UI can render each without string-matching prose, and
 * so a reason can never be invented at the call site.
 */
export const ATTENTION_REASONS = [
  'repeated_failures',
  'high_lapse_rate',
  'low_mastery',
  'declining_recall',
  'long_overdue',
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/**
 * One flagged structure, with the evidence that flagged it.
 *
 * `evidence` is the point. "AI thinks you're weak here" is not a finding; five
 * reviews, two lapses, 58% recent recall and 61% mastery is. Every number in
 * `evidence` is reproducible from the learner's persisted events.
 */
export interface AttentionItem {
  readonly semanticId: SemanticId;
  readonly modelRef: string | null;
  readonly reasons: readonly AttentionReason[];
  /** 0..1, for ordering only. Never shown as a score. */
  readonly severity: number;
  readonly evidence: AttentionEvidence;
}

export interface AttentionEvidence {
  readonly reviews: number;
  readonly lapses: number;
  readonly retention: number | null;
  readonly recentRetention: number | null;
  readonly mastery: number;
  readonly overdueDays: number | null;
  readonly itemCount: number;
}

/** A structure the evidence says is going well. Same discipline, inverted. */
export interface StrengthItem {
  readonly semanticId: SemanticId;
  readonly modelRef: string | null;
  readonly mastery: number;
  readonly retention: number;
  readonly reviews: number;
  readonly lapses: number;
  readonly consecutiveSuccesses: number;
  readonly lastReviewedAt: ISODateString | null;
}

/**
 * A measured change in recent performance against the learner's own history.
 *
 * Reported in neutral educational language. VEO states what its data shows —
 * "recent recall has declined" — and makes no claim about memory, attention or
 * anything else happening inside a person.
 */
export interface DecaySignal {
  readonly semanticId: SemanticId;
  readonly earlierRetention: number;
  readonly recentRetention: number;
  /** recent - earlier. Negative means decline. */
  readonly change: number;
  readonly earlierSampleSize: number;
  readonly recentSampleSize: number;
  readonly direction: 'declining' | 'improving' | 'stable';
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export const RECOMMENDATION_KINDS = [
  'overdue_review',
  'due_review',
  'continue_learning',
  'shore_up_weak_area',
  'start_new_material',
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

/**
 * One ranked suggestion of what to study next.
 *
 * This is an internal prioritisation of a learner's own material against their
 * own review history. It ranks study items, not people or choices.
 *
 * Every recommendation carries `reason` (prose the learner reads) and
 * `evidence` (the numbers that produced it), so a learner can always ask "why
 * this?" and get an answer that is checkable rather than asserted.
 */
export interface LearningRecommendation {
  readonly id: string;
  readonly kind: RecommendationKind;
  readonly title: string;
  readonly reason: string;
  readonly semanticId: SemanticId | null;
  readonly modelRef: string | null;
  readonly contentType: 'question' | 'flashcard' | 'mixed';
  readonly itemIds: readonly UUID[];
  readonly itemCount: number;
  readonly reviewStatus: QueueBucket | null;
  /** 0..1, for ordering only. */
  readonly priority: number;
  /**
   * Whether the structure can be opened in 3D right now.
   *
   * False when the model is not loadable in this deployment. A recommendation
   * must never offer an action VEO cannot perform — with Gate 9 RED that is
   * the normal case, not an edge case.
   */
  readonly canViewInModel: boolean;
  readonly evidence: RecommendationEvidence;
}

export interface RecommendationEvidence {
  readonly overdueDays: number | null;
  readonly mastery: number | null;
  readonly retention: number | null;
  readonly lapses: number;
  readonly reviews: number;
}

/**
 * The recommendation result.
 *
 * `sufficientData` is false when the learner has too little history for the
 * engine to say anything useful. The UI shows a call to action rather than a
 * guess, and `recommendations` is empty — not padded with plausible filler.
 */
export interface RecommendationSet {
  readonly window: PeriodWindow;
  readonly sufficientData: boolean;
  readonly recommendations: readonly LearningRecommendation[];
}

// ---------------------------------------------------------------------------
// Knowledge map
// ---------------------------------------------------------------------------

/**
 * A node in the learner's knowledge map.
 *
 * The hierarchy comes from semantic ids alone, so the same structure serves
 * anatomy, chemistry, engineering, physics and astrophysics without a line of
 * domain-specific code.
 *
 * `label` is the id's own final segment, humanised. VEO does not invent a
 * display name for a structure: the name belongs to the loaded model, and the
 * UI substitutes the real one when a model is loaded.
 */
export interface KnowledgeMapNode {
  readonly semanticId: SemanticId;
  readonly label: string;
  readonly depth: number;
  /** Item-count-weighted mastery across this node's descendants. */
  readonly mastery: number;
  /** Retention across reviews of this node's descendants. Null with none. */
  readonly retention: number | null;
  readonly itemCount: number;
  readonly reviewCount: number;
  readonly dueNow: number;
  readonly band: MasteryBand;
  readonly modelRef: string | null;
  /**
   * Whether this node can be opened in the 3D workspace.
   *
   * Requires a model reference AND that model being available. Stale ids and
   * unavailable models resolve to false, and the UI omits the action.
   */
  readonly canViewInModel: boolean;
  readonly children: readonly KnowledgeMapNode[];
}

export interface KnowledgeMap {
  readonly roots: readonly KnowledgeMapNode[];
  readonly totalStructures: number;
  readonly totalItems: number;
  /**
   * Items VEO could not place in the map.
   *
   * Content with no semantic id, or one that no longer parses. Surfaced as a
   * count rather than dropped, so the map's totals can be reconciled against
   * the schedule instead of quietly disagreeing with it.
   */
  readonly unplacedItems: number;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** Today, from persisted activity. Never from anything the browser reports. */
export interface TodayMetrics {
  readonly dueNow: number;
  readonly overdue: number;
  readonly reviewsCompleted: number;
  readonly goalTarget: number;
  readonly goalMet: boolean;
  readonly streakCurrent: number;
  readonly streakLongest: number;
  readonly studiedToday: boolean;
  readonly nextDueAt: ISODateString | null;
}

/**
 * Everything the dashboard needs, in one response.
 *
 * `hasData` gates the entire surface: false means this learner has completed
 * no reviews, and every figure below is a structural zero rather than a
 * measurement. The UI shows calls to action instead of statistics.
 */
export interface AnalyticsOverview {
  readonly window: PeriodWindow;
  readonly hasData: boolean;
  readonly today: TodayMetrics;
  readonly retention: RetentionMetrics;
  readonly mastery: MasteryMetrics;
  readonly activity: ActivityMetrics;
  readonly velocity: VelocityMetrics;
  readonly attention: readonly AttentionItem[];
  readonly strengths: readonly StrengthItem[];
  readonly decay: readonly DecaySignal[];
  readonly recommendations: RecommendationSet;
  /** Records excluded as unusable. See `integrity.ts`. */
  readonly integrity: IntegrityReport;
}

/**
 * What analytics refused to count.
 *
 * Invalid records are excluded, never coerced into statistics — a review with
 * an impossible timestamp is not evidence of anything and must not become a
 * data point. The counts are surfaced so a real data problem is visible rather
 * than silently absorbed.
 */
export interface IntegrityReport {
  readonly reviewsExcluded: number;
  readonly itemsExcluded: number;
  readonly sessionsExcluded: number;
  readonly reasons: Readonly<Partial<Record<IntegrityReason, number>>>;
}

export const INTEGRITY_REASONS = [
  'invalid_timestamp',
  'future_timestamp',
  'unknown_item',
  'invalid_rating',
  'invalid_semantic_id',
  'invalid_state',
  'invalid_duration',
  'duplicate_event',
] as const;
export type IntegrityReason = (typeof INTEGRITY_REASONS)[number];

// ---------------------------------------------------------------------------
// The raw inputs the engine works from
// ---------------------------------------------------------------------------

/** One persisted review, as analytics consumes it. */
export interface AnalyticsReviewEvent {
  readonly id: UUID;
  readonly itemId: UUID;
  readonly rating: ReviewRating;
  readonly correct: boolean | null;
  readonly responseMs: number;
  readonly reviewedAt: ISODateString;
  readonly sessionId: UUID | null;
}

/** One persisted session. */
export interface AnalyticsSessionRecord {
  readonly id: UUID;
  readonly status: 'active' | 'completed' | 'abandoned';
  readonly startedAt: ISODateString;
  readonly endedAt: ISODateString | null;
  readonly itemsPlanned: number;
  readonly itemsCompleted: number;
}

/** One schedulable item and its current state. */
export interface AnalyticsItemRecord {
  readonly id: UUID;
  readonly contentType: 'question' | 'flashcard';
  readonly semanticId: SemanticId | null;
  readonly modelRef: string | null;
  readonly createdAt: ISODateString | null;
  readonly phase: ReviewPhase;
  readonly stability: number;
  readonly difficulty: number;
  readonly repetitions: number;
  readonly lapses: number;
  readonly intervalDays: number;
  readonly dueAt: ISODateString;
  readonly lastReviewedAt: ISODateString | null;
}

/**
 * Everything the engine needs, fetched once.
 *
 * Bounded by the store, not by the engine: an unbounded lifetime scan is a
 * query that gets slower every day a learner uses VEO. The store states what
 * it applied so the engine can say when a figure is computed from a truncated
 * history rather than presenting it as complete.
 */
export interface AnalyticsSnapshot {
  readonly items: readonly AnalyticsItemRecord[];
  readonly events: readonly AnalyticsReviewEvent[];
  readonly sessions: readonly AnalyticsSessionRecord[];
  readonly days: readonly { readonly date: string; readonly reviewsCompleted: number; readonly secondsStudied: number }[];
  readonly dailyTarget: number;
  readonly timeZone: string;
  /** True when the event history hit the store's cap and was truncated. */
  readonly eventsTruncated: boolean;
}
