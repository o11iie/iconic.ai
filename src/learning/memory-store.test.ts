import { beforeEach, describe, expect, it } from 'vitest';
import { buildSemanticId } from '@/lib/semantic-id';
import type { UUID } from '@/types/domain/primitives';
import { InMemoryLearningStore } from './memory-store';
import { StoreError, type EnrolInput, type LearningStore } from './store';
import { buildQueue, countQueue } from './queue';
import { computeStreak, dailyGoalProgress } from './streaks';
import { addDays } from './scheduler';

/**
 * Store-level guarantees.
 *
 * The scheduler is proved pure elsewhere. What is proved here is what the
 * store adds around it: that one answer advances an item exactly once, that a
 * retry is not a second answer, and that nothing a caller does — including
 * firing two submissions at once — can leave a learner's schedule in a state
 * their history cannot explain.
 *
 * The same contract is verified against real PostgreSQL, with real Row Level
 * Security, by `scripts/verify-rls.sh`. This suite covers the logic; that one
 * covers the database. Neither substitutes for the other.
 */

const ALICE = 'user-alice' as UUID;
const BOB = 'user-bob' as UUID;
const T0 = new Date('2026-03-15T09:00:00.000Z');

let store: InMemoryLearningStore;

beforeEach(() => {
  store = new InMemoryLearningStore();
});

function enrolment(overrides: Partial<EnrolInput> = {}): EnrolInput {
  return {
    userId: ALICE,
    contentRef: 'question-1',
    contentType: 'question',
    semanticId: buildSemanticId('anatomy', 'heart', 'left_ventricle'),
    modelRef: 'model-1',
    payload: { prompt: 'Which chamber pumps blood into the aorta?' },
    objective: 'IDENTIFY',
    difficulty: 'medium',
    now: T0,
    ...overrides,
  };
}

async function enrolMany(count: number, userId: UUID = ALICE): Promise<UUID[]> {
  const ids: UUID[] = [];
  for (let i = 0; i < count; i += 1) {
    const item = await store.enrol(
      enrolment({ userId, contentRef: `question-${String(i).padStart(3, '0')}` }),
    );
    ids.push(item.id);
  }
  return ids;
}

describe('enrolment', () => {
  it('adds generated content to the schedule as a new item', async () => {
    const item = await store.enrol(enrolment());

    expect(item.state.phase).toBe('new');
    expect(item.state.repetitions).toBe(0);
    expect(item.contentType).toBe('question');
    expect(item.semanticId).toBe(buildSemanticId('anatomy', 'heart', 'left_ventricle'));
  });

  it('is idempotent per content ref, so a re-render cannot double-schedule', async () => {
    const first = await store.enrol(enrolment());
    const second = await store.enrol(enrolment());

    expect(second.id).toBe(first.id);
    expect((await store.snapshot(ALICE)).items).toHaveLength(1);
  });

  it('keeps each learner\'s copy of the same content separate', async () => {
    const forAlice = await store.enrol(enrolment({ userId: ALICE }));
    const forBob = await store.enrol(enrolment({ userId: BOB }));

    expect(forBob.id).not.toBe(forAlice.id);
    expect((await store.snapshot(ALICE)).items).toHaveLength(1);
    expect((await store.snapshot(BOB)).items).toHaveLength(1);
  });

  it('carries the payload separately from the scheduling state', async () => {
    // Generated content is not reproducible, so the item owns its copy — but
    // that copy must not travel through the scheduler or the queue.
    const item = await store.enrol(enrolment());
    const payloads = await store.getPayloads(ALICE, [item.id]);

    expect(payloads.get(item.id)).toEqual({
      prompt: 'Which chamber pumps blood into the aorta?',
    });
    expect(item).not.toHaveProperty('payload');
  });

  it('returns no payloads for another learner\'s item', async () => {
    const item = await store.enrol(enrolment({ userId: ALICE }));
    expect((await store.getPayloads(BOB, [item.id])).size).toBe(0);
  });
});

describe('isolation between learners', () => {
  it('shows a learner only their own items', async () => {
    await enrolMany(3, ALICE);
    await enrolMany(1, BOB);

    expect((await store.snapshot(ALICE)).items).toHaveLength(3);
    expect((await store.snapshot(BOB)).items).toHaveLength(1);
  });

  it('will not return another learner\'s item by id', async () => {
    const [aliceItem] = await enrolMany(1, ALICE);
    expect(await store.getItem(BOB, aliceItem!)).toBeNull();
    expect(await store.getItem(ALICE, aliceItem!)).not.toBeNull();
  });

  it('refuses to schedule an item the learner does not own', async () => {
    // Identity is the caller's to establish; the store's job is to never act
    // outside it. Guessing an id must not be enough.
    const [aliceItem] = await enrolMany(1, ALICE);

    await expect(
      store.submitReview({
        userId: BOB, itemId: aliceItem!, rating: 'easy', correct: true,
        responseMs: 10, sessionId: null, idempotencyKey: 'bob-1',
        now: T0, timeZone: 'UTC',
      }),
    ).rejects.toThrow(StoreError);

    const untouched = await store.getItem(ALICE, aliceItem!);
    expect(untouched!.state.phase).toBe('new');
    expect(untouched!.state.repetitions).toBe(0);
  });

  it('gives an unknown item a typed error rather than a crash', async () => {
    await expect(
      store.submitReview({
        userId: ALICE, itemId: 'no-such-item' as UUID, rating: 'good', correct: true,
        responseMs: 10, sessionId: null, idempotencyKey: 'k', now: T0, timeZone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'unknown_item' });
  });
});

describe('review submission', () => {
  it('advances the item and records the event', async () => {
    const [itemId] = await enrolMany(1);

    const outcome = await store.submitReview({
      userId: ALICE, itemId: itemId!, rating: 'good', correct: true,
      responseMs: 4200, sessionId: null, idempotencyKey: 'answer-1',
      now: T0, timeZone: 'UTC',
    });

    expect(outcome.deduplicated).toBe(false);
    expect(outcome.state.phase).toBe('learning');

    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.recentReviews).toHaveLength(1);
    expect(snapshot.recentReviews[0]).toMatchObject({ itemId, rating: 'good' });
  });

  it('uses the server\'s instant, not anything the caller reports elapsed', async () => {
    // The browser's clock is not evidence. `now` is the only time input, and
    // it comes from the server.
    const [itemId] = await enrolMany(1);
    const serverNow = new Date('2026-06-01T08:00:00.000Z');

    const outcome = await store.submitReview({
      userId: ALICE, itemId: itemId!, rating: 'easy', correct: true,
      responseMs: 1, sessionId: null, idempotencyKey: 'answer-1',
      now: serverNow, timeZone: 'UTC',
    });

    expect(outcome.state.lastReviewedAt).toBe(serverNow.toISOString());
    expect((await store.snapshot(ALICE)).recentReviews[0]!.reviewedAt).toBe(
      serverNow.toISOString(),
    );
  });
});

describe('idempotency', () => {
  const submit = (idempotencyKey: string, itemId: UUID, at = T0) =>
    store.submitReview({
      userId: ALICE, itemId, rating: 'good', correct: true, responseMs: 3000,
      sessionId: null, idempotencyKey, now: at, timeZone: 'UTC',
    });

  it('treats a retried submission as the same answer, not a second one', async () => {
    // Network retry, double tap, mobile reconnect, browser refresh — all
    // arrive as the same key and must not advance the item twice.
    const [itemId] = await enrolMany(1);

    const first = await submit('answer-1', itemId!);
    const retry = await submit('answer-1', itemId!, addDays(T0, 0.5));

    expect(retry.deduplicated).toBe(true);
    expect(retry.eventId).toBe(first.eventId);
    expect(retry.state).toEqual(first.state);

    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.recentReviews).toHaveLength(1);
    expect(snapshot.items[0]!.state).toEqual(first.state);
  });

  it('returns what the FIRST submission produced, not a fresh calculation', async () => {
    // A retry half a day later must not report a schedule computed from the
    // retry's clock — the answer happened once, at one moment.
    const [itemId] = await enrolMany(1);

    const first = await submit('answer-1', itemId!);
    const retry = await submit('answer-1', itemId!, addDays(T0, 30));

    expect(retry.state.dueAt).toBe(first.state.dueAt);
    expect(retry.state.lastReviewedAt).toBe(T0.toISOString());
  });

  it('counts a deduplicated retry once toward the daily goal', async () => {
    const [itemId] = await enrolMany(1);
    await submit('answer-1', itemId!);
    await submit('answer-1', itemId!);
    await submit('answer-1', itemId!);

    const { days } = await store.snapshot(ALICE);
    expect(dailyGoalProgress(days, T0, 'UTC', 20).completed).toBe(1);
  });

  it('lets a different key advance the item again', async () => {
    // Dedup must not wedge an item: the next genuine answer is a new key.
    const [itemId] = await enrolMany(1);

    const first = await submit('answer-1', itemId!);
    const second = await submit('answer-2', itemId!, new Date(first.state.dueAt));

    expect(second.deduplicated).toBe(false);
    expect(second.eventId).not.toBe(first.eventId);
    expect((await store.snapshot(ALICE)).recentReviews).toHaveLength(2);
  });

  it('scopes keys per learner, so two people cannot collide', async () => {
    const [aliceItem] = await enrolMany(1, ALICE);
    const [bobItem] = await enrolMany(1, BOB);

    await submit('shared-key', aliceItem!);
    const bobOutcome = await store.submitReview({
      userId: BOB, itemId: bobItem!, rating: 'good', correct: true, responseMs: 1,
      sessionId: null, idempotencyKey: 'shared-key', now: T0, timeZone: 'UTC',
    });

    expect(bobOutcome.deduplicated).toBe(false);
    expect((await store.snapshot(BOB)).recentReviews).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('advances an item once when the same answer arrives twice at once', async () => {
    // The double-tap. Both requests are in flight before either has written.
    const [itemId] = await enrolMany(1);

    const both = await Promise.all([
      store.submitReview({
        userId: ALICE, itemId: itemId!, rating: 'good', correct: true, responseMs: 2000,
        sessionId: null, idempotencyKey: 'answer-1', now: T0, timeZone: 'UTC',
      }),
      store.submitReview({
        userId: ALICE, itemId: itemId!, rating: 'good', correct: true, responseMs: 2000,
        sessionId: null, idempotencyKey: 'answer-1', now: T0, timeZone: 'UTC',
      }),
    ]);

    expect(both.filter((o) => o.deduplicated)).toHaveLength(1);
    expect(both[0]!.state).toEqual(both[1]!.state);

    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.recentReviews).toHaveLength(1);
    expect(snapshot.items[0]!.state.repetitions).toBe(both[0]!.state.repetitions);
  });

  it('keeps history and state consistent under a burst of distinct answers', async () => {
    // Twenty genuinely different answers fired together. Each must be recorded
    // exactly once, and the item's counters must match the history — the
    // corruption this guards against is unrecoverable, because the record that
    // would let you detect it is the thing that gets damaged.
    const [itemId] = await enrolMany(1);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.submitReview({
          userId: ALICE, itemId: itemId!, rating: 'good', correct: true, responseMs: 1000,
          sessionId: null, idempotencyKey: `answer-${i}`, now: addDays(T0, i),
          timeZone: 'UTC',
        }),
      ),
    );

    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.recentReviews).toHaveLength(20);
    expect(new Set(snapshot.recentReviews.map((r) => r.reviewedAt)).size).toBe(20);

    const state = snapshot.items[0]!.state;
    expect(Number.isFinite(state.stability)).toBe(true);
    expect(Number.isFinite(Date.parse(state.dueAt))).toBe(true);
    expect(state.repetitions + state.lapses).toBeGreaterThan(0);
  });

  it('records every concurrent answer across many items exactly once', async () => {
    const ids = await enrolMany(30);

    await Promise.all(
      ids.map((itemId, i) =>
        store.submitReview({
          userId: ALICE, itemId, rating: 'good', correct: true, responseMs: 500,
          sessionId: null, idempotencyKey: `k-${i}`, now: T0, timeZone: 'UTC',
        }),
      ),
    );

    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.recentReviews).toHaveLength(30);
    expect(new Set(snapshot.recentReviews.map((r) => r.itemId)).size).toBe(30);
    expect(snapshot.items.every((item) => item.state.phase !== 'new')).toBe(true);
  });
});

describe('sessions', () => {
  it('starts a session over the items it was given', async () => {
    const ids = await enrolMany(5);
    const session = await store.startSession(ALICE, ids, T0);

    expect(session.status).toBe('active');
    expect(session.plannedItemIds).toHaveLength(5);
    expect(session.completedCount).toBe(0);
  });

  it('rejoins the existing session instead of forking a second one', async () => {
    // A refresh mid-session must not start a parallel session; the database
    // enforces one active session per learner with a partial unique index.
    const ids = await enrolMany(3);
    const first = await store.startSession(ALICE, ids, T0);
    const second = await store.startSession(ALICE, ids, addDays(T0, 0.01));

    expect(second.id).toBe(first.id);
    expect(await store.activeSession(ALICE)).toMatchObject({ id: first.id });
  });

  it('ignores items the learner does not own when planning', async () => {
    const [bobItem] = await enrolMany(1, BOB);
    const aliceItems = await enrolMany(2, ALICE);

    const session = await store.startSession(ALICE, [...aliceItems, bobItem!], T0);
    expect(session.plannedItemIds).toEqual(aliceItems);
  });

  it('tracks progress from reviews rather than from anything the client claims', async () => {
    const ids = await enrolMany(3);
    const session = await store.startSession(ALICE, ids, T0);

    await store.submitReview({
      userId: ALICE, itemId: ids[0]!, rating: 'good', correct: true, responseMs: 1000,
      sessionId: session.id, idempotencyKey: 'a', now: T0, timeZone: 'UTC',
    });
    await store.submitReview({
      userId: ALICE, itemId: ids[1]!, rating: 'again', correct: false, responseMs: 1000,
      sessionId: session.id, idempotencyKey: 'b', now: T0, timeZone: 'UTC',
    });

    const active = await store.activeSession(ALICE);
    expect(active!.completedCount).toBe(2);
    expect(active!.correctCount).toBe(1);
  });

  it('does not double-count a deduplicated answer in session progress', async () => {
    const ids = await enrolMany(2);
    const session = await store.startSession(ALICE, ids, T0);

    for (let i = 0; i < 3; i += 1) {
      await store.submitReview({
        userId: ALICE, itemId: ids[0]!, rating: 'good', correct: true, responseMs: 1000,
        sessionId: session.id, idempotencyKey: 'same-answer', now: T0, timeZone: 'UTC',
      });
    }

    const active = await store.activeSession(ALICE);
    expect(active!.completedCount).toBe(1);
    expect(active!.correctCount).toBe(1);
  });

  it('counts an item once per session even when it comes up twice', async () => {
    // A learning-phase item is due again minutes later, so within one session
    // the same item can legitimately be answered twice under two different
    // keys — this is NOT a retry, and dedup does not apply. Session progress
    // is "how many of the planned items have you got through", so the second
    // answer must not push completion past the number of items planned.
    const ids = await enrolMany(2);
    const session = await store.startSession(ALICE, ids, T0);

    await store.submitReview({
      userId: ALICE, itemId: ids[0]!, rating: 'good', correct: true, responseMs: 1000,
      sessionId: session.id, idempotencyKey: 'first-look', now: T0, timeZone: 'UTC',
    });
    await store.submitReview({
      userId: ALICE, itemId: ids[0]!, rating: 'good', correct: true, responseMs: 1000,
      sessionId: session.id, idempotencyKey: 'second-look', now: addDays(T0, 0.01),
      timeZone: 'UTC',
    });

    const active = await store.activeSession(ALICE);
    expect(active!.completedCount).toBe(1);
    expect(active!.completedCount).toBeLessThanOrEqual(active!.plannedItemIds.length);

    // Both answers are still real reviews: history and the daily count keep
    // them, because the learner did the work twice.
    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.recentReviews).toHaveLength(2);
    expect(dailyGoalProgress(snapshot.days, T0, 'UTC', 20).completed).toBe(2);
  });

  it('ends a session and frees the learner to start another', async () => {
    const ids = await enrolMany(2);
    const session = await store.startSession(ALICE, ids, T0);

    const ended = await store.endSession(ALICE, session.id, 'completed', addDays(T0, 0.02));
    expect(ended!.status).toBe('completed');
    expect(ended!.endedAt).not.toBeNull();
    expect(await store.activeSession(ALICE)).toBeNull();

    const next = await store.startSession(ALICE, ids, addDays(T0, 1));
    expect(next.id).not.toBe(session.id);
  });

  it('treats a late "complete" after an "abandon" as a no-op, not a crash', async () => {
    const ids = await enrolMany(1);
    const session = await store.startSession(ALICE, ids, T0);

    await store.endSession(ALICE, session.id, 'abandoned', addDays(T0, 0.01));
    const late = await store.endSession(ALICE, session.id, 'completed', addDays(T0, 0.02));

    expect(late!.status).toBe('abandoned');
  });

  it('will not end another learner\'s session', async () => {
    const ids = await enrolMany(1, ALICE);
    const session = await store.startSession(ALICE, ids, T0);

    expect(await store.endSession(BOB, session.id, 'abandoned', T0)).toBeNull();
    expect(await store.activeSession(ALICE)).toMatchObject({ status: 'active' });
  });

  it('ignores a session id that is not the learner\'s in-flight one', async () => {
    const ids = await enrolMany(1);
    await store.startSession(ALICE, ids, T0);

    await store.submitReview({
      userId: ALICE, itemId: ids[0]!, rating: 'good', correct: true, responseMs: 1,
      sessionId: 'fabricated-session' as UUID, idempotencyKey: 'x', now: T0, timeZone: 'UTC',
    });

    const active = await store.activeSession(ALICE);
    expect(active!.completedCount).toBe(0);
  });
});

describe('the daily target', () => {
  it('clamps whatever it is given and reports what was stored', async () => {
    expect(await store.setDailyTarget(ALICE, 10_000, 'UTC')).toBe(500);
    expect(await store.setDailyTarget(ALICE, 0, 'UTC')).toBe(1);
    expect(await store.setDailyTarget(ALICE, 35, 'UTC')).toBe(35);
    expect((await store.snapshot(ALICE)).dailyTarget).toBe(35);
  });

  it('remembers the learner\'s timezone for the activity calendar', async () => {
    await store.setDailyTarget(ALICE, 20, 'Pacific/Auckland');
    expect((await store.snapshot(ALICE)).timeZone).toBe('Pacific/Auckland');
  });
});

describe('a new account', () => {
  it('has an honestly empty snapshot rather than invented encouragement', async () => {
    const snapshot = await store.snapshot('brand-new-user' as UUID);

    expect(snapshot.items).toEqual([]);
    expect(snapshot.days).toEqual([]);
    expect(snapshot.recentReviews).toEqual([]);
    expect(countQueue(snapshot.items, T0).actionable).toBe(0);
    expect(computeStreak(snapshot.days, T0, 'UTC')).toMatchObject({
      current: 0, longest: 0, totalStudyDays: 0, lastStudyDate: null,
    });
  });
});

describe('end to end: enrol, queue, session, review, streak', () => {
  it('drives a learner through four days and reports only what they did', async () => {
    // Driven through the INTERFACE, not the class: whatever the route layer
    // is handed must be enough to run a session end to end.
    const contract: LearningStore = store;
    await enrolMany(6);

    let day = T0;
    for (let d = 0; d < 4; d += 1) {
      const snapshot = await contract.snapshot(ALICE);
      const queue = buildQueue(snapshot.items, day, {
        maxNewPerSession: 2, maxReviewsPerSession: 10, maxSessionSize: 10,
      });
      expect(queue.length).toBeGreaterThan(0);

      const session = await contract.startSession(
        ALICE,
        queue.map((q) => q.item.id),
        day,
      );

      for (const [index, queued] of queue.entries()) {
        await contract.submitReview({
          userId: ALICE, itemId: queued.item.id, rating: 'good', correct: true,
          responseMs: 2500, sessionId: session.id,
          idempotencyKey: `d${d}-${index}`, now: day, timeZone: 'UTC',
        });
      }

      await contract.endSession(ALICE, session.id, 'completed', day);
      day = addDays(day, 1);
    }

    const snapshot = await contract.snapshot(ALICE);
    const streak = computeStreak(snapshot.days, addDays(T0, 3), 'UTC');

    expect(streak.current).toBe(4);
    expect(streak.longest).toBe(4);
    expect(streak.totalStudyDays).toBe(4);
    expect(snapshot.items).toHaveLength(6);

    // Every recorded review corresponds to a day the learner actually studied.
    const totalReviews = snapshot.days.reduce((sum, d) => sum + d.reviewsCompleted, 0);
    expect(totalReviews).toBe(snapshot.recentReviews.length);
    expect(await contract.activeSession(ALICE)).toBeNull();
  });

  it('does not grant a streak day for opening the app or enrolling content', async () => {
    // Generating flashcards is not studying. A streak that counted it would
    // reward pressing a button.
    await enrolMany(10);
    await store.startSession(ALICE, await enrolMany(0), T0);
    await store.setDailyTarget(ALICE, 20, 'UTC');
    await store.snapshot(ALICE);

    const { days } = await store.snapshot(ALICE);
    expect(computeStreak(days, T0, 'UTC').current).toBe(0);
    expect(dailyGoalProgress(days, T0, 'UTC').completed).toBe(0);
  });
});
