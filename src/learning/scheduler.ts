import type { ISODateString } from '@/types/domain/primitives';

/**
 * The spaced-repetition scheduler.
 *
 * PURE. No I/O, no clock of its own, no database, no AI. Everything it needs
 * arrives as arguments and everything it decides comes back as a value.
 *
 * That constraint is what makes a learner's schedule trustworthy. A scheduler
 * that read the clock itself could not be tested across a year of reviews; one
 * that touched storage could not be reasoned about without a database; and one
 * that consulted a language model would produce a different answer for the
 * same history on two different days, which is indistinguishable from a bug.
 *
 * ## The algorithm
 *
 * A half-life model in the SM-2 / FSRS family, deliberately the simpler end of
 * it. Each item carries:
 *
 *   stability   — roughly the half-life of the memory, in days
 *   difficulty  — 0..1, how hard THIS learner finds THIS item
 *   repetitions — successful reviews since the last lapse
 *   lapses      — how many times it has been forgotten
 *
 * Reviewing multiplies stability by a factor derived from the rating and the
 * item's difficulty, and the next interval is a fixed fraction of the new
 * stability — the fraction that targets roughly 90% recall at review time.
 *
 * VEO does not invent intervals. Every constant below is named, bounded and in
 * one place, so the model can be replaced wholesale without touching a single
 * component. Scattering this arithmetic through the UI is how a product ends
 * up with two schedulers that disagree.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Where an item sits in its learning lifecycle.
 *
 * `learning` and `relearning` are separate on purpose: both use short
 * step-based intervals, but one is a first encounter and the other is a
 * recovery from a lapse, and conflating them loses the distinction between
 * "never knew this" and "knew it and lost it" — which is exactly what the
 * difficulty adjustment needs.
 */
export const REVIEW_PHASES = ['new', 'learning', 'review', 'relearning', 'suspended'] as const;
export type ReviewPhase = (typeof REVIEW_PHASES)[number];

/** What the learner reported. The only input the scheduler takes from them. */
export const REVIEW_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/** A rating counts as recall unless it was a failure. */
export function isRecalled(rating: ReviewRating): boolean {
  return rating !== 'again';
}

// ---------------------------------------------------------------------------
// Constants — ALL of them, in one place
// ---------------------------------------------------------------------------

export const SCHEDULER = {
  /**
   * Target recall probability at the moment of review.
   *
   * 0.9 is the conventional choice: high enough that reviews usually succeed,
   * low enough that intervals grow. It appears here once and is the only place
   * the retention target is expressed.
   */
  targetRetention: 0.9,

  /** Minutes between steps while an item is being learned for the first time. */
  learningStepsMinutes: [1, 10] as const,

  /** Minutes between steps while recovering from a lapse. */
  relearningStepsMinutes: [10] as const,

  /** Days for the first scheduled review after graduating from learning. */
  graduatingIntervalDays: 1,
  /** Days for the first review when the learner graduates with `easy`. */
  easyGraduatingIntervalDays: 4,

  /** Stability multipliers per rating, before difficulty is applied. */
  stabilityFactor: {
    again: 0.2,
    hard: 1.2,
    good: 2.0,
    easy: 2.8,
  } as const,

  /** How much difficulty damps growth. At difficulty 1, growth is halved. */
  difficultyDamping: 0.5,

  /** Difficulty moves toward these targets after each rating. */
  difficultyDelta: {
    again: 0.15,
    hard: 0.05,
    good: -0.02,
    easy: -0.1,
  } as const,

  /** Bounds. An item can never be scheduled outside these. */
  minStabilityDays: 0.02, // ~30 minutes
  maxStabilityDays: 3650, // 10 years
  minIntervalDays: 1 / 1440, // one minute
  maxIntervalDays: 3650,
  minDifficulty: 0,
  maxDifficulty: 1,

  /**
   * How much credit an item gets for being reviewed late and still recalled.
   *
   * Surviving a longer-than-scheduled gap is evidence the memory was stronger
   * than the model believed, so stability is nudged up. Capped, because a card
   * forgotten about for a year and then guessed correctly is not proof of a
   * year-long memory.
   */
  maxLatenessBonus: 1.5,
} as const;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Everything the scheduler needs to know about an item's history.
 *
 * Stores the scheduler's INPUTS rather than only a due date, so the algorithm
 * can be improved later without discarding what a learner has done. A row
 * holding only "due next Tuesday" is unusable by any other model.
 */
export interface ReviewState {
  readonly phase: ReviewPhase;
  /** Approximate memory half-life in days. */
  readonly stability: number;
  /** 0..1, how hard this learner finds this item. */
  readonly difficulty: number;
  /** Successful reviews since the last lapse. */
  readonly repetitions: number;
  /** How many times this item has been forgotten after being learned. */
  readonly lapses: number;
  /** Index into the learning/relearning step ladder. */
  readonly step: number;
  readonly intervalDays: number;
  readonly dueAt: ISODateString;
  readonly lastReviewedAt: ISODateString | null;
}

/** A brand-new item, never seen. */
export function newReviewState(now: Date): ReviewState {
  return {
    phase: 'new',
    stability: 0,
    difficulty: 0.3,
    repetitions: 0,
    lapses: 0,
    step: 0,
    intervalDays: 0,
    dueAt: now.toISOString(),
    lastReviewedAt: null,
  };
}

export interface ScheduleResult {
  readonly next: ReviewState;
  /** Days between the previous review and this one, when there was one. */
  readonly elapsedDays: number | null;
  /** Estimated recall probability at the moment of review, 0..1. */
  readonly retrievability: number | null;
}

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

/**
 * Advance an item's schedule.
 *
 * Deterministic: the same state, rating and instant always produce the same
 * result. `now` is passed in rather than read, so a test can review an item a
 * hundred times across two years in a millisecond.
 *
 * Defensive about its inputs, because a `ReviewState` may have come from a
 * database that a previous version of this code wrote — or from a request
 * body. Every numeric field is clamped before use, so an impossible stored
 * value produces a sane schedule rather than a NaN that silently poisons every
 * future review of that item.
 */
export function schedule(
  previous: ReviewState,
  rating: ReviewRating,
  now: Date,
): ScheduleResult {
  const state = sanitise(previous);

  // A suspended item does not move. Resuming is an explicit action, not
  // something a stray rating should do.
  if (state.phase === 'suspended') {
    return { next: state, elapsedDays: null, retrievability: null };
  }

  const elapsedDays = state.lastReviewedAt
    ? daysBetween(new Date(state.lastReviewedAt), now)
    : null;

  const retrievability =
    state.stability > 0 && elapsedDays !== null
      ? recallProbability(elapsedDays, state.stability)
      : null;

  const difficulty = nextDifficulty(state.difficulty, rating);

  // ---- learning and relearning: fixed short steps -------------------------

  if (state.phase === 'new' || state.phase === 'learning') {
    return {
      elapsedDays,
      retrievability,
      next: stepThrough(state, rating, now, difficulty, 'learning'),
    };
  }

  if (state.phase === 'relearning') {
    return {
      elapsedDays,
      retrievability,
      next: stepThrough(state, rating, now, difficulty, 'relearning'),
    };
  }

  // ---- review: the interval model -----------------------------------------

  if (rating === 'again') {
    // A lapse. Stability collapses but is not reset to zero — the learner has
    // seen this before, and treating a forgotten item as brand new throws away
    // everything they did retain.
    const stability = clamp(
      state.stability * SCHEDULER.stabilityFactor.again,
      SCHEDULER.minStabilityDays,
      SCHEDULER.maxStabilityDays,
    );
    const steps = SCHEDULER.relearningStepsMinutes;
    const intervalDays = minutesToDays(steps[0] ?? 10);

    return {
      elapsedDays,
      retrievability,
      next: {
        phase: 'relearning',
        stability,
        difficulty,
        repetitions: 0,
        lapses: state.lapses + 1,
        step: 0,
        intervalDays,
        dueAt: addDays(now, intervalDays).toISOString(),
        lastReviewedAt: now.toISOString(),
      },
    };
  }

  const stability = grownStability(state, rating, difficulty, elapsedDays);
  const intervalDays = intervalFor(stability);

  return {
    elapsedDays,
    retrievability,
    next: {
      phase: 'review',
      stability,
      difficulty,
      repetitions: state.repetitions + 1,
      lapses: state.lapses,
      step: 0,
      intervalDays,
      dueAt: addDays(now, intervalDays).toISOString(),
      lastReviewedAt: now.toISOString(),
    },
  };
}

/** Suspend an item. It stops appearing in the queue until resumed. */
export function suspend(state: ReviewState): ReviewState {
  return { ...sanitise(state), phase: 'suspended' };
}

/**
 * Resume a suspended item.
 *
 * It comes back due immediately, as a review rather than as new: the learner
 * has seen it, and its stability and difficulty are still the best estimates
 * available.
 */
export function resume(state: ReviewState, now: Date): ReviewState {
  const clean = sanitise(state);
  if (clean.phase !== 'suspended') return clean;

  return {
    ...clean,
    phase: clean.repetitions > 0 || clean.lapses > 0 ? 'review' : 'new',
    dueAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Walk the short-step ladder used while learning or relearning. */
function stepThrough(
  state: ReviewState,
  rating: ReviewRating,
  now: Date,
  difficulty: number,
  ladder: 'learning' | 'relearning',
): ReviewState {
  const steps =
    ladder === 'learning' ? SCHEDULER.learningStepsMinutes : SCHEDULER.relearningStepsMinutes;

  // `again` returns to the first step rather than failing out entirely.
  if (rating === 'again') {
    const intervalDays = minutesToDays(steps[0] ?? 1);
    return {
      phase: ladder,
      stability: Math.max(state.stability, SCHEDULER.minStabilityDays),
      difficulty,
      repetitions: 0,
      lapses: state.lapses,
      step: 0,
      intervalDays,
      dueAt: addDays(now, intervalDays).toISOString(),
      lastReviewedAt: now.toISOString(),
    };
  }

  // `easy` graduates immediately, whatever step it was on. A learner who finds
  // it easy on first sight should not be shown it again in ten minutes.
  if (rating === 'easy') {
    return graduate(state, difficulty, now, SCHEDULER.easyGraduatingIntervalDays);
  }

  // `hard` repeats the current step rather than advancing.
  const nextStep = rating === 'hard' ? state.step : state.step + 1;

  if (nextStep >= steps.length) {
    return graduate(state, difficulty, now, SCHEDULER.graduatingIntervalDays);
  }

  const intervalDays = minutesToDays(steps[nextStep] ?? 10);
  return {
    phase: ladder,
    stability: Math.max(state.stability, intervalDays),
    difficulty,
    repetitions: state.repetitions,
    lapses: state.lapses,
    step: nextStep,
    intervalDays,
    dueAt: addDays(now, intervalDays).toISOString(),
    lastReviewedAt: now.toISOString(),
  };
}

/** Leave the step ladder and enter the interval model. */
function graduate(
  state: ReviewState,
  difficulty: number,
  now: Date,
  intervalDays: number,
): ReviewState {
  const stability = clamp(
    intervalDays / intervalFraction(),
    SCHEDULER.minStabilityDays,
    SCHEDULER.maxStabilityDays,
  );

  return {
    phase: 'review',
    stability,
    difficulty,
    repetitions: state.repetitions + 1,
    lapses: state.lapses,
    step: 0,
    intervalDays,
    dueAt: addDays(now, intervalDays).toISOString(),
    lastReviewedAt: now.toISOString(),
  };
}

/**
 * Grow stability after a successful review.
 *
 * Three influences, in order of size: the rating, the item's difficulty, and
 * how late the review was. A hard-but-correct answer still grows the interval,
 * just less — an item the learner keeps getting right should not keep coming
 * back daily merely because they find it uncomfortable.
 */
function grownStability(
  state: ReviewState,
  rating: ReviewRating,
  difficulty: number,
  elapsedDays: number | null,
): number {
  const base = SCHEDULER.stabilityFactor[rating];

  // Difficulty damps growth: at difficulty 0 the factor is untouched, at 1 the
  // growth above 1.0 is halved.
  const damped = 1 + (base - 1) * (1 - difficulty * SCHEDULER.difficultyDamping);

  // Lateness bonus: recalling something overdue is evidence of real strength.
  const lateness =
    elapsedDays !== null && state.intervalDays > 0
      ? clamp(elapsedDays / state.intervalDays, 1, SCHEDULER.maxLatenessBonus)
      : 1;

  const grown = Math.max(state.stability, SCHEDULER.minStabilityDays) * damped * lateness;
  return clamp(grown, SCHEDULER.minStabilityDays, SCHEDULER.maxStabilityDays);
}

/** Move difficulty toward what this rating implies, and clamp. */
function nextDifficulty(current: number, rating: ReviewRating): number {
  return clamp(
    current + SCHEDULER.difficultyDelta[rating],
    SCHEDULER.minDifficulty,
    SCHEDULER.maxDifficulty,
  );
}

/**
 * The fraction of stability at which recall drops to the target.
 *
 * With an exponential forgetting curve `R = exp(-t / S)`, recall hits the
 * target at `t = -ln(target) * S`. For 0.9 that is about 0.105 · S.
 */
function intervalFraction(): number {
  return -Math.log(SCHEDULER.targetRetention);
}

function intervalFor(stability: number): number {
  return clamp(
    stability * intervalFraction(),
    SCHEDULER.minIntervalDays,
    SCHEDULER.maxIntervalDays,
  );
}

/** Estimated probability of recall after `elapsedDays` at this stability. */
export function recallProbability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return clamp(Math.exp(-Math.max(0, elapsedDays) / stability), 0, 1);
}

/**
 * Repair a state that may have come from storage or a request.
 *
 * Nothing downstream should have to wonder whether `stability` is NaN. A
 * single non-finite value entering the arithmetic produces a due date of
 * `Invalid Date`, which persists, and every subsequent review of that item
 * inherits it — a corruption that spreads silently and is very hard to trace
 * back to its origin.
 */
export function sanitise(state: ReviewState): ReviewState {
  const phase: ReviewPhase = REVIEW_PHASES.includes(state.phase) ? state.phase : 'new';

  return {
    phase,
    stability: clamp(finite(state.stability, 0), 0, SCHEDULER.maxStabilityDays),
    difficulty: clamp(finite(state.difficulty, 0.3), SCHEDULER.minDifficulty, SCHEDULER.maxDifficulty),
    repetitions: Math.max(0, Math.floor(finite(state.repetitions, 0))),
    lapses: Math.max(0, Math.floor(finite(state.lapses, 0))),
    step: Math.max(0, Math.floor(finite(state.step, 0))),
    intervalDays: clamp(finite(state.intervalDays, 0), 0, SCHEDULER.maxIntervalDays),
    dueAt: validDate(state.dueAt) ?? new Date(0).toISOString(),
    lastReviewedAt: validDate(state.lastReviewedAt),
  };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function validDate(value: string | null): ISODateString | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function minutesToDays(minutes: number): number {
  return minutes / 1440;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}
