import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import { newReviewState, schedule, type ReviewRating, type ReviewState } from './scheduler';
import type { LearningItem } from './queue';
import { DEFAULT_DAILY_GOAL, clampGoal, localDate, type StudyDay } from './streaks';
import type { AnalyticsItemRecord, AnalyticsSnapshot } from '@/analytics/contract';
import {
  StoreError,
  type AnalyticsQuery,
  type EnrolInput,
  type LearningSnapshot,
  type LearningStore,
  type SessionSummary,
  type SubmitReviewInput,
  type SubmitReviewOutcome,
} from './store';

/**
 * An in-memory learning store.
 *
 * ## What it is for
 *
 * Two things, and it is honest about both.
 *
 * 1. **Tests.** The scheduler is pure and the store is an interface, so the
 *    entire engine — enrol, queue, session, review, streak, mastery — can be
 *    driven through a full year of study in a millisecond, deterministically.
 *
 * 2. **Verification without a database.** VEO's Supabase project is not
 *    configured in every environment. Rather than leave the recall engine
 *    unverifiable wherever that is true, this implements the same contract so
 *    the browser suite can exercise the real UI against a real engine.
 *
 * ## What it is NOT
 *
 * It is not persistence. Data lives in a process and dies with it. It is
 * enabled only by an explicit flag, it is never chosen when Supabase is
 * configured, and the UI says plainly when it is in use. A learner must never
 * be shown a streak that a server restart will erase without knowing.
 *
 * ## Concurrency
 *
 * JavaScript's single-threaded execution is NOT a substitute for the database
 * transaction the Supabase implementation uses. `submitReview` here is
 * synchronous end to end — it never awaits between reading state and writing
 * it — so no interleaving is possible. That mirrors the guarantee rather than
 * relying on the runtime to provide it by accident.
 */

interface StoredItem {
  readonly id: UUID;
  readonly createdAt: ISODateString;
  readonly userId: UUID;
  readonly contentRef: string;
  readonly contentType: 'question' | 'flashcard';
  readonly semanticId: SemanticId | null;
  readonly modelRef: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly objective: string | null;
  readonly difficulty: 'easy' | 'medium' | 'hard' | null;
  state: ReviewState;
}

interface StoredEvent {
  readonly id: UUID;
  readonly userId: UUID;
  readonly itemId: UUID;
  readonly rating: ReviewRating;
  /** Whether the answer matched, where that was knowable. */
  readonly correct: boolean | null;
  readonly responseMs: number;
  readonly sessionId: UUID | null;
  readonly reviewedAt: ISODateString;
  readonly idempotencyKey: string;
  readonly resultingState: ReviewState;
}

interface StoredSession {
  readonly id: UUID;
  readonly userId: UUID;
  status: 'active' | 'completed' | 'abandoned';
  readonly startedAt: ISODateString;
  endedAt: ISODateString | null;
  readonly plannedItemIds: UUID[];
  readonly answeredItemIds: UUID[];
  correctCount: number;
}

interface UserData {
  readonly items: Map<UUID, StoredItem>;
  /** Content ref → item id, so enrolment is idempotent. */
  readonly byContentRef: Map<string, UUID>;
  readonly events: StoredEvent[];
  /** Idempotency key → event, the dedup index. */
  readonly byIdempotencyKey: Map<string, StoredEvent>;
  readonly sessions: Map<UUID, StoredSession>;
  /** Local date → activity. */
  readonly days: Map<string, StudyDay>;
  dailyTarget: number;
  timeZone: string;
}

function emptyUser(): UserData {
  return {
    items: new Map(),
    byContentRef: new Map(),
    events: [],
    byIdempotencyKey: new Map(),
    sessions: new Map(),
    days: new Map(),
    dailyTarget: DEFAULT_DAILY_GOAL,
    timeZone: 'UTC',
  };
}

/** Recent-review window, matching what the Supabase implementation fetches. */
const RECENT_REVIEW_LIMIT = 200;

export class InMemoryLearningStore implements LearningStore {
  private readonly users = new Map<UUID, UserData>();
  private sequence = 0;

  /** Deterministic ids, so a test's expectations are stable across runs. */
  private nextId(prefix: string): UUID {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(8, '0')}`;
  }

  private user(userId: UUID): UserData {
    const existing = this.users.get(userId);
    if (existing) return existing;
    const created = emptyUser();
    this.users.set(userId, created);
    return created;
  }

  /** Discard everything. Used between tests and on stub reset. */
  reset(): void {
    this.users.clear();
    this.sequence = 0;
  }

  async snapshot(userId: UUID): Promise<LearningSnapshot> {
    const user = this.user(userId);

    return {
      items: [...user.items.values()].map(toLearningItem),
      days: [...user.days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      dailyTarget: user.dailyTarget,
      timeZone: user.timeZone,
      recentReviews: user.events
        .slice(-RECENT_REVIEW_LIMIT)
        .map((event) => ({
          itemId: event.itemId,
          rating: event.rating,
          reviewedAt: event.reviewedAt,
        })),
    };
  }

  async analyticsSnapshot(userId: UUID, query: AnalyticsQuery): Promise<AnalyticsSnapshot> {
    const user = this.user(userId);
    const from = query.from ? query.from.getTime() : null;

    const inWindow = (iso: string) => {
      if (from === null) return true;
      const at = Date.parse(iso);
      // An unparseable timestamp is NOT filtered out here. Integrity is the
      // engine's job, and silently dropping a broken row at the storage layer
      // would hide a real data problem behind a smaller number.
      return !Number.isFinite(at) || at >= from;
    };

    // Newest first, then capped, so a truncated history keeps the RECENT
    // events — which is what every trend and decay signal depends on.
    const events = [...user.events]
      .filter((event) => inWindow(event.reviewedAt))
      .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt));

    const sessions = [...user.sessions.values()]
      .filter((session) => inWindow(session.startedAt))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, query.maxSessions);

    return {
      items: [...user.items.values()].map(toAnalyticsItem),
      events: events.slice(0, query.maxEvents).map((event) => ({
        id: event.id,
        itemId: event.itemId,
        rating: event.rating,
        correct: event.correct,
        responseMs: event.responseMs,
        reviewedAt: event.reviewedAt,
        sessionId: event.sessionId,
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        itemsPlanned: session.plannedItemIds.length,
        itemsCompleted: session.answeredItemIds.length,
      })),
      days: [...user.days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      dailyTarget: user.dailyTarget,
      timeZone: user.timeZone,
      eventsTruncated: events.length > query.maxEvents,
    };
  }

  async enrol(input: EnrolInput): Promise<LearningItem> {
    const user = this.user(input.userId);

    // Enrolling the same content twice returns the existing item rather than
    // creating a second schedule for one question.
    const existingId = user.byContentRef.get(input.contentRef);
    if (existingId) {
      const existing = user.items.get(existingId);
      if (existing) return toLearningItem(existing);
    }

    const id = this.nextId('item');
    const stored: StoredItem = {
      id,
      createdAt: input.now.toISOString(),
      userId: input.userId,
      contentRef: input.contentRef,
      contentType: input.contentType,
      semanticId: input.semanticId,
      modelRef: input.modelRef,
      payload: input.payload,
      objective: input.objective,
      difficulty: input.difficulty,
      state: newReviewState(input.now),
    };

    user.items.set(id, stored);
    user.byContentRef.set(input.contentRef, id);
    return toLearningItem(stored);
  }

  async getItem(userId: UUID, itemId: UUID): Promise<LearningItem | null> {
    const stored = this.user(userId).items.get(itemId);
    return stored ? toLearningItem(stored) : null;
  }

  async getPayloads(
    userId: UUID,
    itemIds: readonly UUID[],
  ): Promise<ReadonlyMap<UUID, Readonly<Record<string, unknown>>>> {
    const user = this.user(userId);
    const out = new Map<UUID, Readonly<Record<string, unknown>>>();
    for (const itemId of itemIds) {
      const stored = user.items.get(itemId);
      if (stored) out.set(itemId, stored.payload);
    }
    return out;
  }

  /**
   * Submit a review.
   *
   * Synchronous from the idempotency check through to the counter update: no
   * `await` sits between reading the state and writing it, so two submissions
   * cannot interleave even when both are in flight.
   */
  async submitReview(input: SubmitReviewInput): Promise<SubmitReviewOutcome> {
    const user = this.user(input.userId);

    // ---- idempotency, first --------------------------------------------
    const seen = user.byIdempotencyKey.get(input.idempotencyKey);
    if (seen) {
      return { state: seen.resultingState, eventId: seen.id, deduplicated: true };
    }

    const item = user.items.get(input.itemId);
    if (!item) {
      throw new StoreError('unknown_item', 'That item is not in your schedule.');
    }

    const { next } = schedule(item.state, input.rating, input.now);
    item.state = next;

    const event: StoredEvent = {
      id: this.nextId('event'),
      userId: input.userId,
      itemId: input.itemId,
      rating: input.rating,
      correct: input.correct,
      responseMs: Math.max(0, Math.round(input.responseMs)),
      sessionId: input.sessionId,
      reviewedAt: input.now.toISOString(),
      idempotencyKey: input.idempotencyKey,
      resultingState: next,
    };
    user.events.push(event);
    user.byIdempotencyKey.set(input.idempotencyKey, event);

    // ---- daily activity, in the learner's local date ---------------------
    const timeZone = input.timeZone || user.timeZone;
    user.timeZone = timeZone;
    const date = localDate(input.now, timeZone);
    const day = user.days.get(date) ?? { date, reviewsCompleted: 0, secondsStudied: 0 };
    user.days.set(date, {
      date,
      reviewsCompleted: day.reviewsCompleted + 1,
      secondsStudied: day.secondsStudied + Math.max(0, Math.round(input.responseMs / 1000)),
    });

    // ---- session progress -----------------------------------------------
    if (input.sessionId) {
      const session = user.sessions.get(input.sessionId);
      if (session && session.status === 'active') {
        if (!session.answeredItemIds.includes(input.itemId)) {
          session.answeredItemIds.push(input.itemId);
        }
        if (input.correct === true) session.correctCount += 1;
      }
    }

    return { state: next, eventId: event.id, deduplicated: false };
  }

  async activeSession(userId: UUID): Promise<SessionSummary | null> {
    const user = this.user(userId);
    for (const session of user.sessions.values()) {
      if (session.status === 'active') return toSessionSummary(session);
    }
    return null;
  }

  async startSession(
    userId: UUID,
    itemIds: readonly UUID[],
    now: Date,
  ): Promise<SessionSummary> {
    const user = this.user(userId);

    // One active session per learner. A refresh rejoins rather than forking —
    // the database enforces this with a partial unique index, and this
    // mirrors it rather than assuming callers behave.
    for (const session of user.sessions.values()) {
      if (session.status === 'active') return toSessionSummary(session);
    }

    const id = this.nextId('session');
    const session: StoredSession = {
      id,
      userId,
      status: 'active',
      startedAt: now.toISOString(),
      endedAt: null,
      plannedItemIds: itemIds.filter((itemId) => user.items.has(itemId)),
      answeredItemIds: [],
      correctCount: 0,
    };
    user.sessions.set(id, session);
    return toSessionSummary(session);
  }

  async endSession(
    userId: UUID,
    sessionId: UUID,
    status: 'completed' | 'abandoned',
    now: Date,
  ): Promise<SessionSummary | null> {
    const session = this.user(userId).sessions.get(sessionId);
    if (!session) return null;

    // Ending an already-ended session is not an error: a "complete" arriving
    // after an "abandon" on a flaky connection should be a no-op, not a crash.
    if (session.status === 'active') {
      session.status = status;
      session.endedAt = now.toISOString();
    }

    return toSessionSummary(session);
  }

  async setDailyTarget(userId: UUID, target: number, timeZone: string): Promise<number> {
    const user = this.user(userId);
    user.dailyTarget = clampGoal(target);
    if (timeZone) user.timeZone = timeZone;
    return user.dailyTarget;
  }
}

function toAnalyticsItem(stored: StoredItem): AnalyticsItemRecord {
  return {
    id: stored.id,
    contentType: stored.contentType,
    semanticId: stored.semanticId,
    modelRef: stored.modelRef,
    createdAt: stored.createdAt,
    phase: stored.state.phase,
    stability: stored.state.stability,
    difficulty: stored.state.difficulty,
    repetitions: stored.state.repetitions,
    lapses: stored.state.lapses,
    intervalDays: stored.state.intervalDays,
    dueAt: stored.state.dueAt,
    lastReviewedAt: stored.state.lastReviewedAt,
  };
}

function toLearningItem(stored: StoredItem): LearningItem {
  return {
    id: stored.id,
    contentId: stored.contentRef,
    contentType: stored.contentType,
    semanticId: stored.semanticId,
    modelRef: stored.modelRef,
    state: stored.state,
  };
}

function toSessionSummary(session: StoredSession): SessionSummary {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    plannedItemIds: [...session.plannedItemIds],
    answeredItemIds: [...session.answeredItemIds],
    completedCount: session.answeredItemIds.length,
    correctCount: session.correctCount,
  };
}
