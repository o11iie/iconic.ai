import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import {
  newReviewState,
  schedule,
  type ReviewPhase,
  type ReviewRating,
  type ReviewState,
} from './scheduler';
import type { LearningItem } from './queue';
import { clampGoal, DEFAULT_DAILY_GOAL, localDate, type StudyDay } from './streaks';
import {
  StoreError,
  type EnrolInput,
  type LearningSnapshot,
  type LearningStore,
  type SessionSummary,
  type SubmitReviewInput,
  type SubmitReviewOutcome,
} from './store';

/**
 * The Supabase learning store.
 *
 * Moves rows. It contains no scheduling arithmetic — that lives in
 * `scheduler.ts`, is pure, and is tested without a database — so the surface
 * here is narrow enough to reason about: what it reads, what it writes, and in
 * what order.
 *
 * ## The user id is never a parameter the caller chooses
 *
 * Every method takes `userId`, but the CALLER derives it from the session, and
 * RLS enforces it independently. Both halves matter. If a route ever passed a
 * body-supplied id, the policies would still refuse — `with check (user_id =
 * auth.uid())` makes a forged row impossible to insert regardless of what the
 * application believes. The migration's RLS verification proves that by
 * execution.
 *
 * ## Idempotency and concurrency
 *
 * Both are enforced by the DATABASE, not by this class:
 *
 *   - a unique index on `(user_id, idempotency_key)` means a retried
 *     submission collides rather than advancing the item twice;
 *   - `submit_review` runs as a single Postgres function so the read of the
 *     current state and the write of the next one cannot interleave.
 *
 * Client-side locking would not survive two tabs, two devices, or a retry
 * after the connection dropped mid-write — which is exactly when duplicate
 * submissions actually happen.
 */

interface ItemRow {
  id: string;
  content_ref: string;
  content_type: string;
  semantic_id: string | null;
  model_ref: string | null;
  payload: Record<string, unknown> | null;
  review_states: StateRow | StateRow[] | null;
}

interface StateRow {
  phase: string;
  stability: number;
  difficulty: number;
  repetitions: number;
  lapses: number;
  step: number;
  interval_days: number;
  due_at: string;
  last_reviewed_at: string | null;
}

export class SupabaseLearningStore implements LearningStore {
  constructor(private readonly client: SupabaseClient) {}

  async snapshot(userId: UUID): Promise<LearningSnapshot> {
    const [items, days, goal, reviews] = await Promise.all([
      this.client
        .from('learning_items')
        .select(
          'id, content_ref, content_type, semantic_id, model_ref, payload, review_states(*)',
        )
        .is('archived_at', null),
      this.client
        .from('learning_daily_activity')
        .select('activity_date, reviews_completed, seconds_studied')
        .order('activity_date', { ascending: true }),
      this.client
        .from('learning_goals')
        .select('daily_review_target, time_zone')
        .maybeSingle(),
      this.client
        .from('review_events')
        .select('item_id, rating, reviewed_at')
        .order('reviewed_at', { ascending: false })
        .limit(200),
    ]);

    if (items.error) throw unavailable(items.error.message);

    void userId; // RLS scopes every query; the id is not a filter.

    return {
      items: (items.data ?? []).map(toLearningItem),
      days: (days.data ?? []).map(
        (row): StudyDay => ({
          date: String(row.activity_date),
          reviewsCompleted: Number(row.reviews_completed) || 0,
          secondsStudied: Number(row.seconds_studied) || 0,
        }),
      ),
      dailyTarget: goal.data?.daily_review_target ?? DEFAULT_DAILY_GOAL,
      timeZone: goal.data?.time_zone ?? 'UTC',
      recentReviews: (reviews.data ?? [])
        .map((row) => ({
          itemId: String(row.item_id),
          rating: row.rating as ReviewRating,
          reviewedAt: String(row.reviewed_at) as ISODateString,
        }))
        .reverse(),
    };
  }

  async enrol(input: EnrolInput): Promise<LearningItem> {
    // Upsert on (user_id, content_ref): enrolling the same content twice must
    // not create two schedules for one question.
    const { data, error } = await this.client
      .from('learning_items')
      .upsert(
        {
          user_id: input.userId,
          content_ref: input.contentRef,
          content_type: input.contentType,
          semantic_id: input.semanticId,
          model_ref: input.modelRef,
          payload: input.payload,
          objective: input.objective,
          difficulty: input.difficulty,
        },
        { onConflict: 'user_id,content_ref', ignoreDuplicates: false },
      )
      .select('id, content_ref, content_type, semantic_id, model_ref, payload')
      .single();

    if (error || !data) throw unavailable(error?.message ?? 'Could not enrol that item.');

    // A fresh item needs a review state. `ignoreDuplicates` leaves an existing
    // one untouched, so re-enrolling never resets a learner's progress.
    const { error: stateError } = await this.client.from('review_states').upsert(
      {
        item_id: data.id,
        user_id: input.userId,
        phase: 'new',
        due_at: input.now.toISOString(),
      },
      { onConflict: 'item_id', ignoreDuplicates: true },
    );
    if (stateError) throw unavailable(stateError.message);

    const fresh = await this.getItem(input.userId, data.id as UUID);
    if (fresh) return fresh;

    return {
      id: data.id as UUID,
      contentId: String(data.content_ref),
      contentType: data.content_type === 'flashcard' ? 'flashcard' : 'question',
      semanticId: (data.semantic_id as SemanticId | null) ?? null,
      modelRef: data.model_ref === null ? null : String(data.model_ref),
      state: newReviewState(input.now),
    };
  }

  async getItem(userId: UUID, itemId: UUID): Promise<LearningItem | null> {
    void userId;
    const { data, error } = await this.client
      .from('learning_items')
      .select('id, content_ref, content_type, semantic_id, model_ref, payload, review_states(*)')
      .eq('id', itemId)
      .maybeSingle();

    if (error) throw unavailable(error.message);
    return data ? toLearningItem(data as ItemRow) : null;
  }

  async getPayloads(
    userId: UUID,
    itemIds: readonly UUID[],
  ): Promise<ReadonlyMap<UUID, Readonly<Record<string, unknown>>>> {
    void userId;
    if (itemIds.length === 0) return new Map();

    const { data, error } = await this.client
      .from('learning_items')
      .select('id, payload')
      .in('id', [...itemIds]);

    if (error) throw unavailable(error.message);

    const out = new Map<UUID, Readonly<Record<string, unknown>>>();
    for (const row of data ?? []) out.set(row.id as UUID, row.payload ?? {});
    return out;
  }

  /**
   * Submit a review.
   *
   * Delegates to a Postgres function so the whole advance is one transaction.
   * Doing it here in three round trips would leave a window in which a second
   * submission reads the pre-advance state — and two taps on a phone is the
   * common case, not the exotic one.
   *
   * The scheduler still runs in TypeScript: the function is handed the NEXT
   * state and appends it. One implementation of the algorithm, not two.
   */
  async submitReview(input: SubmitReviewInput): Promise<SubmitReviewOutcome> {
    const item = await this.getItem(input.userId, input.itemId);
    if (!item) throw new StoreError('unknown_item', 'That item is not in your schedule.');

    const { next, elapsedDays, retrievability } = schedule(
      item.state,
      input.rating,
      input.now,
    );

    const { data, error } = await this.client.rpc('submit_review', {
      p_item_id: input.itemId,
      p_session_id: input.sessionId,
      p_rating: input.rating,
      p_correct: input.correct,
      p_response_ms: Math.max(0, Math.round(input.responseMs)),
      p_idempotency_key: input.idempotencyKey,
      p_previous_phase: item.state.phase,
      p_previous_interval: item.state.intervalDays,
      p_previous_due_at: item.state.dueAt,
      p_next_phase: next.phase,
      p_next_stability: next.stability,
      p_next_difficulty: next.difficulty,
      p_next_repetitions: next.repetitions,
      p_next_lapses: next.lapses,
      p_next_step: next.step,
      p_next_interval: next.intervalDays,
      p_next_due_at: next.dueAt,
      p_elapsed_days: elapsedDays,
      p_retrievability: retrievability,
      p_time_zone: input.timeZone,
      p_activity_date: localDate(input.now, input.timeZone),
    });

    if (error) throw unavailable(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw unavailable('The review could not be recorded.');

    return {
      // When the submission was deduplicated the function returns the state
      // the FIRST one produced, not the one just computed — a retry must not
      // report a different schedule from the answer it duplicates.
      state: row.deduplicated ? rowToState(row.state as StateRow) : next,
      eventId: String(row.event_id) as UUID,
      deduplicated: Boolean(row.deduplicated),
    };
  }

  async activeSession(userId: UUID): Promise<SessionSummary | null> {
    void userId;
    const { data, error } = await this.client
      .from('review_sessions')
      .select('*, review_session_items(item_id, position, answered_at)')
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw unavailable(error.message);
    return data ? toSessionSummary(data) : null;
  }

  async startSession(
    userId: UUID,
    itemIds: readonly UUID[],
    now: Date,
  ): Promise<SessionSummary> {
    // A partial unique index allows one active session per learner, so a
    // refresh rejoins rather than forking.
    const existing = await this.activeSession(userId);
    if (existing) return existing;

    const { data, error } = await this.client
      .from('review_sessions')
      .insert({
        user_id: userId,
        status: 'active',
        started_at: now.toISOString(),
        planned_count: itemIds.length,
      })
      .select('*')
      .single();

    if (error || !data) throw unavailable(error?.message ?? 'Could not start a session.');

    if (itemIds.length > 0) {
      const { error: itemsError } = await this.client.from('review_session_items').insert(
        itemIds.map((itemId, position) => ({
          session_id: data.id,
          item_id: itemId,
          user_id: userId,
          position,
        })),
      );
      if (itemsError) throw unavailable(itemsError.message);
    }

    return {
      id: data.id as UUID,
      status: 'active',
      startedAt: String(data.started_at) as ISODateString,
      endedAt: null,
      plannedItemIds: [...itemIds],
      answeredItemIds: [],
      completedCount: 0,
      correctCount: 0,
    };
  }

  async endSession(
    userId: UUID,
    sessionId: UUID,
    status: 'completed' | 'abandoned',
    now: Date,
  ): Promise<SessionSummary | null> {
    void userId;
    const { data, error } = await this.client
      .from('review_sessions')
      .update({ status, ended_at: now.toISOString() })
      .eq('id', sessionId)
      .eq('status', 'active')
      .select('*, review_session_items(item_id, position, answered_at)')
      .maybeSingle();

    if (error) throw unavailable(error.message);
    // Null means it was already ended. Not an error: a "complete" arriving
    // after an "abandon" on a flaky connection is a no-op.
    return data ? toSessionSummary(data) : this.findSession(sessionId);
  }

  private async findSession(sessionId: UUID): Promise<SessionSummary | null> {
    const { data } = await this.client
      .from('review_sessions')
      .select('*, review_session_items(item_id, position, answered_at)')
      .eq('id', sessionId)
      .maybeSingle();
    return data ? toSessionSummary(data) : null;
  }

  async setDailyTarget(userId: UUID, target: number, timeZone: string): Promise<number> {
    const clamped = clampGoal(target);
    const { error } = await this.client.from('learning_goals').upsert(
      {
        user_id: userId,
        daily_review_target: clamped,
        time_zone: timeZone || 'UTC',
      },
      { onConflict: 'user_id' },
    );
    if (error) throw unavailable(error.message);
    return clamped;
  }
}

// ---------------------------------------------------------------------------

function toLearningItem(row: ItemRow): LearningItem {
  // PostgREST returns an embedded one-to-one as an object or a one-element
  // array depending on how the relationship is inferred. Handling both is
  // cheaper than depending on which.
  const stateRow = Array.isArray(row.review_states)
    ? row.review_states[0]
    : row.review_states;

  return {
    id: row.id as UUID,
    contentId: row.content_ref,
    contentType: row.content_type === 'flashcard' ? 'flashcard' : 'question',
    semanticId: (row.semantic_id as SemanticId | null) ?? null,
    modelRef: row.model_ref,
    state: stateRow ? rowToState(stateRow) : newReviewState(new Date(0)),
  };
}

function rowToState(row: StateRow): ReviewState {
  return {
    phase: row.phase as ReviewPhase,
    stability: Number(row.stability) || 0,
    difficulty: Number(row.difficulty) || 0.3,
    repetitions: Number(row.repetitions) || 0,
    lapses: Number(row.lapses) || 0,
    step: Number(row.step) || 0,
    intervalDays: Number(row.interval_days) || 0,
    dueAt: String(row.due_at) as ISODateString,
    lastReviewedAt: row.last_reviewed_at === null ? null : String(row.last_reviewed_at),
  };
}

interface SessionRow {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  correct_count: number | null;
  review_session_items?: {
    item_id: string;
    position: number;
    answered_at: string | null;
  }[];
}

function toSessionSummary(row: SessionRow): SessionSummary {
  const items = [...(row.review_session_items ?? [])].sort(
    (a, b) => a.position - b.position,
  );

  return {
    id: row.id as UUID,
    status:
      row.status === 'completed' || row.status === 'abandoned' ? row.status : 'active',
    startedAt: String(row.started_at) as ISODateString,
    endedAt: row.ended_at === null ? null : String(row.ended_at),
    plannedItemIds: items.map((item) => item.item_id as UUID),
    answeredItemIds: items
      .filter((item) => item.answered_at !== null)
      .map((item) => item.item_id as UUID),
    completedCount: items.filter((item) => item.answered_at !== null).length,
    correctCount: Number(row.correct_count) || 0,
  };
}

/** Upstream text stays on the server; the learner gets one honest sentence. */
function unavailable(detail: string): StoreError {
  void detail;
  return new StoreError('unavailable', 'VEO could not reach your learning record.');
}
