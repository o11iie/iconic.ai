import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import type { ReviewRating, ReviewState } from './scheduler';
import type { LearningItem } from './queue';
import type { StudyDay } from './streaks';

/**
 * The persistence seam.
 *
 * Everything above this interface — scheduler, queue, mastery, streaks — is
 * pure. Everything below it is a database. Keeping the boundary explicit means
 * the entire learning engine can be exercised end to end without one, and the
 * Supabase implementation contains no logic worth testing: it moves rows.
 *
 * ## Why the store owns submission rather than the caller
 *
 * `submitReview` takes a rating and returns the outcome, rather than exposing
 * read-state / write-state for a caller to orchestrate. Scheduling has to be
 * atomic: read the current state, advance it, append the event and bump the
 * counters, with nothing interleaving. Split across three calls, two taps on a
 * phone produce two reads of the same state and two writes of the same
 * interval — the item advances once and is recorded twice, or advances twice
 * from one answer. Neither is recoverable afterwards, because the history that
 * would let you tell is the thing that got corrupted.
 *
 * So the transaction boundary is the interface.
 */

export interface SubmitReviewInput {
  readonly userId: UUID;
  readonly itemId: UUID;
  readonly rating: ReviewRating;
  /** Whether the learner's answer matched, where that is knowable. */
  readonly correct: boolean | null;
  readonly responseMs: number;
  readonly sessionId: UUID | null;
  /**
   * Minted by the client, once per answer.
   *
   * The same answer retried after a dropped connection carries the same key
   * and must produce the same result — not a second event.
   */
  readonly idempotencyKey: string;
  /** SERVER time. Never the browser's clock. */
  readonly now: Date;
  /** The learner's timezone, for the local activity date. */
  readonly timeZone: string;
}

export interface SubmitReviewOutcome {
  readonly state: ReviewState;
  readonly eventId: UUID;
  /**
   * True when this submission matched an earlier one and nothing advanced.
   *
   * Surfaced rather than hidden: a UI that knows the answer was already
   * recorded can move on instead of showing an error for a request that in
   * fact succeeded the first time.
   */
  readonly deduplicated: boolean;
}

export interface SessionSummary {
  readonly id: UUID;
  readonly status: 'active' | 'completed' | 'abandoned';
  readonly startedAt: ISODateString;
  readonly endedAt: ISODateString | null;
  readonly plannedItemIds: readonly UUID[];
  readonly answeredItemIds: readonly UUID[];
  readonly completedCount: number;
  readonly correctCount: number;
}

export interface LearningSnapshot {
  readonly items: readonly LearningItem[];
  readonly days: readonly StudyDay[];
  readonly dailyTarget: number;
  readonly timeZone: string;
  /** Recent ratings, for retention. Bounded by the implementation. */
  readonly recentReviews: readonly {
    readonly itemId: UUID;
    readonly rating: ReviewRating;
    readonly reviewedAt: ISODateString;
  }[];
}

export interface EnrolInput {
  readonly userId: UUID;
  readonly contentRef: string;
  readonly contentType: 'question' | 'flashcard';
  readonly semanticId: SemanticId | null;
  readonly modelRef: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly objective: string | null;
  readonly difficulty: 'easy' | 'medium' | 'hard' | null;
  readonly now: Date;
}

export interface LearningStore {
  /** Everything the dashboard needs, in one round trip. */
  snapshot(userId: UUID): Promise<LearningSnapshot>;

  /** Add generated content to the learner's schedule. Idempotent per ref. */
  enrol(input: EnrolInput): Promise<LearningItem>;

  getItem(userId: UUID, itemId: UUID): Promise<LearningItem | null>;

  /**
   * What the learner actually sees for an item.
   *
   * Separate from `getItem` on purpose. Generated content is not reproducible
   * — the same prompt yields different text — so the item must carry its own
   * copy, but that copy is rendering data. Putting it on `LearningItem` would
   * push a question's whole body through the scheduler, the queue and every
   * mastery calculation, none of which have any use for it.
   */
  getPayloads(
    userId: UUID,
    itemIds: readonly UUID[],
  ): Promise<ReadonlyMap<UUID, Readonly<Record<string, unknown>>>>;

  /** Atomic: read, advance, append, count. See the note above. */
  submitReview(input: SubmitReviewInput): Promise<SubmitReviewOutcome>;

  /** The learner's in-flight session, if any. A refresh rejoins it. */
  activeSession(userId: UUID): Promise<SessionSummary | null>;

  startSession(
    userId: UUID,
    itemIds: readonly UUID[],
    now: Date,
  ): Promise<SessionSummary>;

  endSession(
    userId: UUID,
    sessionId: UUID,
    status: 'completed' | 'abandoned',
    now: Date,
  ): Promise<SessionSummary | null>;

  setDailyTarget(userId: UUID, target: number, timeZone: string): Promise<number>;
}

/** Why a store operation could not be performed. Expected, not exceptional. */
export const STORE_ERRORS = [
  'not_configured',
  'unknown_item',
  'unknown_session',
  'conflict',
  'unavailable',
] as const;
export type StoreErrorCode = (typeof STORE_ERRORS)[number];

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}
