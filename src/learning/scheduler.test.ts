import { describe, expect, it } from 'vitest';
import {
  REVIEW_PHASES,
  REVIEW_RATINGS,
  SCHEDULER,
  addDays,
  daysBetween,
  isRecalled,
  newReviewState,
  recallProbability,
  resume,
  sanitise,
  schedule,
  suspend,
  type ReviewRating,
  type ReviewState,
} from './scheduler';

/**
 * The scheduler is pure, so these are real assertions about the algorithm
 * rather than smoke tests. Every one drives `schedule` and checks what came
 * back — a learner's whole schedule descends from this function, and a
 * plausible-looking interval that is quietly wrong is invisible in a UI.
 */

const T0 = new Date('2026-03-01T09:00:00.000Z');

/** Drive an item through a sequence of ratings, one review per given instant. */
function driveThrough(
  start: ReviewState,
  steps: readonly { rating: ReviewRating; at: Date }[],
): ReviewState {
  let state = start;
  for (const step of steps) state = schedule(state, step.rating, step.at).next;
  return state;
}

/** Review an item at exactly its due date, repeatedly. */
function reviewOnSchedule(
  start: ReviewState,
  rating: ReviewRating,
  times: number,
): ReviewState {
  let state = start;
  for (let i = 0; i < times; i += 1) {
    state = schedule(state, rating, new Date(state.dueAt)).next;
  }
  return state;
}

describe('vocabulary', () => {
  it('has no duplicate phases or ratings', () => {
    expect(new Set(REVIEW_PHASES).size).toBe(REVIEW_PHASES.length);
    expect(new Set(REVIEW_RATINGS).size).toBe(REVIEW_RATINGS.length);
  });

  it('counts every rating but `again` as recall', () => {
    expect(REVIEW_RATINGS.filter(isRecalled)).toEqual(['hard', 'good', 'easy']);
  });
});

describe('a new item', () => {
  it('starts due immediately, with no history', () => {
    const state = newReviewState(T0);
    expect(state.phase).toBe('new');
    expect(state.repetitions).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.lastReviewedAt).toBeNull();
    expect(state.dueAt).toBe(T0.toISOString());
  });

  it('reports no retrievability, because there is nothing to forget yet', () => {
    // An unseen item must not be described as "0% recalled" — that is a
    // measurement, and none has been taken.
    const result = schedule(newReviewState(T0), 'good', T0);
    expect(result.retrievability).toBeNull();
    expect(result.elapsedDays).toBeNull();
  });

  it('enters the learning ladder on `good`, due in the first step', () => {
    const { next } = schedule(newReviewState(T0), 'good', T0);
    expect(next.phase).toBe('learning');
    expect(next.step).toBe(1);
    const minutes = daysBetween(T0, new Date(next.dueAt)) * 1440;
    expect(minutes).toBeCloseTo(SCHEDULER.learningStepsMinutes[1], 6);
  });

  it('graduates straight to review on `easy`', () => {
    const { next } = schedule(newReviewState(T0), 'easy', T0);
    expect(next.phase).toBe('review');
    expect(next.intervalDays).toBe(SCHEDULER.easyGraduatingIntervalDays);
    expect(next.repetitions).toBe(1);
  });
});

describe('the learning ladder', () => {
  it('advances one step per `good` and then graduates', () => {
    const first = schedule(newReviewState(T0), 'good', T0).next;
    expect(first.phase).toBe('learning');

    const second = schedule(first, 'good', new Date(first.dueAt)).next;
    expect(second.phase).toBe('review');
    expect(second.intervalDays).toBe(SCHEDULER.graduatingIntervalDays);
  });

  it('repeats the current step on `hard` rather than advancing', () => {
    const first = schedule(newReviewState(T0), 'good', T0).next;
    const held = schedule(first, 'hard', new Date(first.dueAt)).next;

    expect(held.phase).toBe('learning');
    expect(held.step).toBe(first.step);
    expect(held.intervalDays).toBeCloseTo(first.intervalDays, 9);
  });

  it('returns to the first step on `again`, without recording a lapse', () => {
    // A lapse means forgetting something you had learned. Failing an item you
    // are still learning for the first time is not that, and counting it as
    // one would make every new item look like a problem card.
    const first = schedule(newReviewState(T0), 'good', T0).next;
    const failed = schedule(first, 'again', new Date(first.dueAt)).next;

    expect(failed.phase).toBe('learning');
    expect(failed.step).toBe(0);
    expect(failed.lapses).toBe(0);
  });

  it('never leaves an item stuck below the first interval', () => {
    // Twenty consecutive failures must still produce a real due date.
    let state = newReviewState(T0);
    let at = T0;
    for (let i = 0; i < 20; i += 1) {
      state = schedule(state, 'again', at).next;
      at = new Date(state.dueAt);
    }
    expect(Number.isFinite(Date.parse(state.dueAt))).toBe(true);
    expect(state.intervalDays).toBeGreaterThan(0);
  });
});

describe('the review interval model', () => {
  const graduated = schedule(newReviewState(T0), 'easy', T0).next;

  it('grows the interval on repeated `good` ratings', () => {
    let state = graduated;
    const intervals: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      state = schedule(state, 'good', new Date(state.dueAt)).next;
      intervals.push(state.intervalDays);
    }
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
    }
  });

  it('orders the ratings: again < hard < good < easy', () => {
    const at = new Date(graduated.dueAt);
    const byRating = Object.fromEntries(
      REVIEW_RATINGS.map((r) => [r, schedule(graduated, r, at).next.intervalDays]),
    ) as Record<ReviewRating, number>;

    expect(byRating.again).toBeLessThan(byRating.hard);
    expect(byRating.hard).toBeLessThan(byRating.good);
    expect(byRating.good).toBeLessThan(byRating.easy);
  });

  it('still grows the interval on `hard`, just more slowly', () => {
    // An item answered correctly-but-uncomfortably for years should not come
    // back every single day forever.
    const mature = reviewOnSchedule(graduated, 'good', 5);
    const harder = schedule(mature, 'hard', new Date(mature.dueAt)).next;
    expect(harder.intervalDays).toBeGreaterThan(mature.intervalDays);
  });

  it('sets the interval to the fraction of stability that targets retention', () => {
    // The relationship, asserted directly rather than by eyeballing a number:
    // with R = exp(-t/S), recall hits the target at t = -ln(target) * S.
    const state = reviewOnSchedule(graduated, 'good', 3);
    const expected = state.stability * -Math.log(SCHEDULER.targetRetention);
    expect(state.intervalDays).toBeCloseTo(expected, 9);
  });

  it('predicts the target retention at the moment an item comes due', () => {
    const state = reviewOnSchedule(graduated, 'good', 3);
    const atDue = recallProbability(state.intervalDays, state.stability);
    expect(atDue).toBeCloseTo(SCHEDULER.targetRetention, 6);
  });

  it('rewards a late-but-correct review, within the cap', () => {
    const mature = reviewOnSchedule(graduated, 'good', 3);
    const onTime = schedule(mature, 'good', new Date(mature.dueAt)).next;

    const veryLate = addDays(new Date(mature.dueAt), mature.intervalDays * 10);
    const late = schedule(mature, 'good', veryLate).next;

    expect(late.stability).toBeGreaterThan(onTime.stability);
    // Capped: a card forgotten for a year and then guessed is not proof of a
    // year-long memory.
    expect(late.stability).toBeLessThanOrEqual(
      onTime.stability * SCHEDULER.maxLatenessBonus + 1e-9,
    );
  });

  it('measures retrievability as decaying with the gap since the last review', () => {
    const mature = reviewOnSchedule(graduated, 'good', 3);
    const soon = schedule(mature, 'good', addDays(new Date(mature.lastReviewedAt!), 1));
    const later = schedule(mature, 'good', addDays(new Date(mature.lastReviewedAt!), 30));

    expect(soon.retrievability!).toBeGreaterThan(later.retrievability!);
    expect(soon.retrievability!).toBeLessThanOrEqual(1);
    expect(later.retrievability!).toBeGreaterThanOrEqual(0);
  });
});

describe('difficulty', () => {
  const graduated = schedule(newReviewState(T0), 'easy', T0).next;

  it('rises with failure and falls with ease', () => {
    const at = new Date(graduated.dueAt);
    expect(schedule(graduated, 'again', at).next.difficulty).toBeGreaterThan(
      graduated.difficulty,
    );
    expect(schedule(graduated, 'easy', at).next.difficulty).toBeLessThan(
      graduated.difficulty,
    );
  });

  it('stays inside its bounds however the item is rated', () => {
    for (const rating of REVIEW_RATINGS) {
      const hammered = reviewOnSchedule(graduated, rating, 60);
      expect(hammered.difficulty).toBeGreaterThanOrEqual(SCHEDULER.minDifficulty);
      expect(hammered.difficulty).toBeLessThanOrEqual(SCHEDULER.maxDifficulty);
    }
  });

  it('damps interval growth for a harder item', () => {
    // Two items with identical stability, different difficulty. The harder one
    // must earn a shorter next interval for the same rating.
    const base = reviewOnSchedule(graduated, 'good', 3);
    const easyItem: ReviewState = { ...base, difficulty: 0 };
    const hardItem: ReviewState = { ...base, difficulty: 1 };
    const at = new Date(base.dueAt);

    expect(schedule(hardItem, 'good', at).next.intervalDays).toBeLessThan(
      schedule(easyItem, 'good', at).next.intervalDays,
    );
  });
});

describe('lapses and relearning', () => {
  const mature = reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'good', 4);

  it('records a lapse and drops into relearning on `again`', () => {
    const lapsed = schedule(mature, 'again', new Date(mature.dueAt)).next;

    expect(lapsed.phase).toBe('relearning');
    expect(lapsed.lapses).toBe(mature.lapses + 1);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.intervalDays).toBeLessThan(mature.intervalDays);
  });

  it('keeps some stability rather than resetting the item to brand new', () => {
    // The learner has seen this before. Throwing away everything they retained
    // makes a single bad day undo months of work.
    const lapsed = schedule(mature, 'again', new Date(mature.dueAt)).next;
    expect(lapsed.stability).toBeGreaterThan(0);
    expect(lapsed.stability).toBeLessThan(mature.stability);
    expect(lapsed.stability).toBeCloseTo(
      mature.stability * SCHEDULER.stabilityFactor.again,
      6,
    );
  });

  it('returns to review after working back up the relearning ladder', () => {
    const lapsed = schedule(mature, 'again', new Date(mature.dueAt)).next;
    const recovered = schedule(lapsed, 'good', new Date(lapsed.dueAt)).next;

    expect(recovered.phase).toBe('review');
    // The lapse is remembered even after recovery — it is history, not state.
    expect(recovered.lapses).toBe(lapsed.lapses);
  });

  it('carries the lapse count across many cycles', () => {
    let state = mature;
    for (let i = 0; i < 5; i += 1) {
      state = schedule(state, 'again', new Date(state.dueAt)).next;
      state = schedule(state, 'good', new Date(state.dueAt)).next;
    }
    expect(state.lapses).toBe(mature.lapses + 5);
  });

  it('shortens the interval of a repeatedly-forgotten item', () => {
    // Compare two items reviewed the same number of times, one of which keeps
    // lapsing. The struggling one must come back sooner.
    const steady = reviewOnSchedule(mature, 'good', 6);

    let struggling = mature;
    for (let i = 0; i < 3; i += 1) {
      struggling = schedule(struggling, 'again', new Date(struggling.dueAt)).next;
      struggling = schedule(struggling, 'good', new Date(struggling.dueAt)).next;
    }

    expect(struggling.intervalDays).toBeLessThan(steady.intervalDays);
  });
});

describe('suspension', () => {
  it('stops a suspended item from moving, whatever it is rated', () => {
    const suspended = suspend(reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'good', 2));

    for (const rating of REVIEW_RATINGS) {
      const result = schedule(suspended, rating, addDays(T0, 400));
      expect(result.next).toEqual(suspended);
      expect(result.retrievability).toBeNull();
    }
  });

  it('brings a seen item back as a review, due now', () => {
    const seen = reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'good', 2);
    const at = addDays(T0, 90);
    const resumed = resume(suspend(seen), at);

    expect(resumed.phase).toBe('review');
    expect(resumed.dueAt).toBe(at.toISOString());
    expect(resumed.stability).toBeCloseTo(seen.stability, 9);
  });

  it('brings an unseen item back as new', () => {
    const resumed = resume(suspend(newReviewState(T0)), addDays(T0, 5));
    expect(resumed.phase).toBe('new');
  });

  it('leaves a non-suspended item alone', () => {
    const live = schedule(newReviewState(T0), 'good', T0).next;
    expect(resume(live, addDays(T0, 5))).toEqual(sanitise(live));
  });
});

describe('boundaries', () => {
  it('never schedules beyond the maximum, over a decade of `easy`', () => {
    const state = reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'easy', 200);
    expect(state.intervalDays).toBeLessThanOrEqual(SCHEDULER.maxIntervalDays);
    expect(state.stability).toBeLessThanOrEqual(SCHEDULER.maxStabilityDays);
    expect(Number.isFinite(Date.parse(state.dueAt))).toBe(true);
  });

  it('never schedules below one minute, however badly an item goes', () => {
    const state = reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'again', 200);
    expect(state.intervalDays).toBeGreaterThanOrEqual(SCHEDULER.minIntervalDays);
    expect(new Date(state.dueAt).getTime()).toBeGreaterThan(0);
  });

  it('keeps every field finite across a long mixed history', () => {
    // Deterministic pseudo-random walk: a real learner's history is not all
    // one rating, and arithmetic faults hide in the mixtures.
    let state = newReviewState(T0);
    let seed = 7;
    for (let i = 0; i < 500; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const rating = REVIEW_RATINGS[seed % 4]!;
      state = schedule(state, rating, new Date(state.dueAt)).next;

      expect(Number.isFinite(state.stability)).toBe(true);
      expect(Number.isFinite(state.difficulty)).toBe(true);
      expect(Number.isFinite(state.intervalDays)).toBe(true);
      expect(Number.isFinite(Date.parse(state.dueAt))).toBe(true);
    }
  });
});

describe('date transitions', () => {
  it('schedules across a month end without drifting', () => {
    const endOfMonth = new Date('2026-01-31T23:30:00.000Z');
    const state = schedule(newReviewState(endOfMonth), 'easy', endOfMonth).next;
    const due = new Date(state.dueAt);

    expect(due.getTime() - endOfMonth.getTime()).toBe(
      SCHEDULER.easyGraduatingIntervalDays * 86_400_000,
    );
    expect(due.toISOString()).toBe('2026-02-04T23:30:00.000Z');
  });

  it('schedules across a leap day', () => {
    const before = new Date('2028-02-28T12:00:00.000Z');
    const state = schedule(newReviewState(before), 'easy', before).next;
    expect(state.dueAt).toBe('2028-03-03T12:00:00.000Z');
  });

  it('stores instants, not local dates, so a DST shift cannot move a due time', () => {
    // The scheduler works entirely in UTC instants. The learner's timezone
    // belongs to the streak calendar, not to when an item is next due —
    // otherwise an hour of clock change would silently reschedule everything.
    const beforeDst = new Date('2026-03-07T12:00:00.000Z');
    const state = schedule(newReviewState(beforeDst), 'easy', beforeDst).next;
    const elapsedMs = new Date(state.dueAt).getTime() - beforeDst.getTime();
    expect(elapsedMs).toBe(SCHEDULER.easyGraduatingIntervalDays * 86_400_000);
  });
});

describe('sanitise, the defence against corrupt stored state', () => {
  const broken = {
    phase: 'nonsense',
    stability: Number.NaN,
    difficulty: 99,
    repetitions: -4.7,
    lapses: Number.POSITIVE_INFINITY,
    step: -1,
    intervalDays: Number.NEGATIVE_INFINITY,
    dueAt: 'not a date',
    lastReviewedAt: 'also not a date',
  } as unknown as ReviewState;

  it('repairs every field of an impossible state', () => {
    const fixed = sanitise(broken);

    expect(fixed.phase).toBe('new');
    expect(fixed.stability).toBe(0);
    expect(fixed.difficulty).toBe(SCHEDULER.maxDifficulty);
    expect(fixed.repetitions).toBe(0);
    expect(fixed.lapses).toBe(0);
    expect(fixed.step).toBe(0);
    expect(fixed.intervalDays).toBe(0);
    expect(Number.isFinite(Date.parse(fixed.dueAt))).toBe(true);
    expect(fixed.lastReviewedAt).toBeNull();
  });

  it('produces a usable schedule from a corrupt state rather than a NaN', () => {
    // This is the point of it: one non-finite value entering the arithmetic
    // produces an Invalid Date that persists and poisons every later review.
    const { next } = schedule(broken, 'good', T0);
    expect(Number.isFinite(Date.parse(next.dueAt))).toBe(true);
    expect(Number.isFinite(next.stability)).toBe(true);
  });

  it('leaves an already-valid state untouched', () => {
    const valid = schedule(newReviewState(T0), 'good', T0).next;
    expect(sanitise(valid)).toEqual(valid);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const before = reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'good', 3);
    const snapshot = structuredClone(before);

    for (const rating of REVIEW_RATINGS) schedule(before, rating, addDays(T0, 30));

    expect(before).toEqual(snapshot);
  });

  it('never repairs its caller\'s object in place', () => {
    // A clean state cannot detect this: sanitising it changes nothing, so an
    // in-place repair is invisible. Only a state sanitise WOULD alter shows
    // whether the fix was written back into the caller's object — which would
    // silently launder corrupt data into whatever the caller persists next.
    const corrupt = {
      ...reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'good', 3),
      difficulty: 99,
      repetitions: -4.7,
    } as ReviewState;
    const snapshot = structuredClone(corrupt);

    const { next } = schedule(corrupt, 'good', addDays(T0, 30));

    expect(corrupt).toEqual(snapshot);
    expect(corrupt.difficulty).toBe(99);
    // The returned state is repaired, which is where the repair belongs.
    expect(next.difficulty).toBeLessThanOrEqual(SCHEDULER.maxDifficulty);
  });

  it('returns the same answer for the same inputs', () => {
    const state = reviewOnSchedule(schedule(newReviewState(T0), 'easy', T0).next, 'good', 3);
    const at = addDays(T0, 12);
    expect(schedule(state, 'good', at)).toEqual(schedule(state, 'good', at));
  });

  it('reaches the same place by the same path, twice', () => {
    const path = REVIEW_RATINGS.flatMap((rating) => [
      { rating, at: addDays(T0, 1) },
      { rating: 'good' as const, at: addDays(T0, 3) },
    ]);
    expect(driveThrough(newReviewState(T0), path)).toEqual(
      driveThrough(newReviewState(T0), path),
    );
  });
});
