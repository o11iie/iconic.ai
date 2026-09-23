import type { ISODateString } from '@/types/domain/primitives';

/**
 * Streaks and the daily goal.
 *
 * PURE, and deliberately strict about what counts.
 *
 * ## What a study day is
 *
 * A day on which the learner COMPLETED qualifying review activity. Opening the
 * app is not a study day. Viewing the dashboard is not a study day. Generating
 * a flashcard is not a study day — generating is not studying, and a streak
 * that rewarded it would reward pressing a button.
 *
 * This matters because a streak is a promise. A learner who sees "17 days"
 * believes they studied on seventeen days, and a product that counts logins
 * has quietly redefined the word to flatter them.
 *
 * ## Timezones
 *
 * A day boundary is a local concept. Someone reviewing at 23:50 in Auckland
 * and again at 00:10 has studied on two days; the same two instants in UTC
 * land on one. So every function here takes an IANA timezone and derives the
 * local calendar date from it. There is no `new Date()` anywhere in this file.
 */

/** A day on which qualifying activity happened, as a local calendar date. */
export interface StudyDay {
  /** `YYYY-MM-DD` in the learner's timezone. */
  readonly date: string;
  readonly reviewsCompleted: number;
  readonly secondsStudied: number;
}

export interface StreakSummary {
  readonly current: number;
  readonly longest: number;
  readonly totalStudyDays: number;
  /** The most recent study day, or null if there has never been one. */
  readonly lastStudyDate: string | null;
  /**
   * True when today has qualifying activity.
   *
   * Separate from `current` because a streak survives until the end of
   * tomorrow — a learner at breakfast on day 18 has a current streak of 17 and
   * has not yet studied today, and telling them the streak is broken would be
   * wrong.
   */
  readonly studiedToday: boolean;
}

/**
 * The local calendar date for an instant, in a given timezone.
 *
 * Uses `Intl` rather than offset arithmetic, so it is correct across daylight
 * saving transitions — the case where hand-rolled offset maths silently
 * produces a duplicated or missing day, breaking exactly one streak per year
 * per learner in a way nobody can reproduce.
 */
export function localDate(instant: Date, timeZone: string): string {
  try {
    // en-CA gives YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    // An invalid timezone must not lose the learner's history.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }
}

/** Days between two `YYYY-MM-DD` dates. Calendar days, not elapsed hours. */
export function calendarDaysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** The day before a `YYYY-MM-DD` date. */
export function previousDate(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whether a day's activity qualifies.
 *
 * One completed review. Low deliberately — the bar is "did some studying
 * happen", not "was it a good session" — but not zero, because a row can exist
 * for a day with no completed reviews, and counting that would be counting
 * attendance again.
 */
export const MIN_REVIEWS_FOR_STUDY_DAY = 1;

export function qualifies(day: StudyDay): boolean {
  return day.reviewsCompleted >= MIN_REVIEWS_FOR_STUDY_DAY;
}

/**
 * Compute the streak.
 *
 * A streak is unbroken if each qualifying day is the calendar day before the
 * next. The CURRENT streak counts back from today, or from yesterday when
 * today has no activity yet — the grace period described above.
 */
export function computeStreak(
  days: readonly StudyDay[],
  now: Date,
  timeZone: string,
): StreakSummary {
  const qualifying = [...new Set(days.filter(qualifies).map((day) => day.date))].sort();

  if (qualifying.length === 0) {
    return {
      current: 0,
      longest: 0,
      totalStudyDays: 0,
      lastStudyDate: null,
      studiedToday: false,
    };
  }

  const today = localDate(now, timeZone);
  const yesterday = previousDate(today);
  const lastStudyDate = qualifying[qualifying.length - 1] ?? null;
  const studiedToday = qualifying.includes(today);

  // ---- longest run anywhere in the history -------------------------------

  let longest = 1;
  let run = 1;
  for (let i = 1; i < qualifying.length; i += 1) {
    const previous = qualifying[i - 1];
    const current = qualifying[i];
    if (previous === undefined || current === undefined) continue;

    if (calendarDaysBetween(previous, current) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // ---- current run, counting back from today or yesterday -----------------

  let current = 0;
  let cursor = studiedToday ? today : qualifying.includes(yesterday) ? yesterday : null;

  if (cursor !== null) {
    const set = new Set(qualifying);
    while (set.has(cursor)) {
      current += 1;
      cursor = previousDate(cursor);
    }
  }

  return {
    current,
    longest: Math.max(longest, current),
    totalStudyDays: qualifying.length,
    lastStudyDate,
    studiedToday,
  };
}

// ---------------------------------------------------------------------------
// Daily goal
// ---------------------------------------------------------------------------

export interface DailyGoal {
  /** Reviews the learner aims to complete each day. */
  readonly target: number;
  readonly completed: number;
  readonly remaining: number;
  /** 0..1. Capped, so overshooting reads as done rather than as 140%. */
  readonly progress: number;
  readonly met: boolean;
}

/** A sane default: about ten minutes of reviewing for most learners. */
export const DEFAULT_DAILY_GOAL = 20;

export const GOAL_BOUNDS = { min: 1, max: 500 } as const;

export function clampGoal(target: number): number {
  if (!Number.isFinite(target)) return DEFAULT_DAILY_GOAL;
  return Math.min(GOAL_BOUNDS.max, Math.max(GOAL_BOUNDS.min, Math.floor(target)));
}

/**
 * Today's progress against the goal.
 *
 * `completed` comes from persisted activity rows, never from the client — a
 * browser that could report its own completion could report anything.
 */
export function dailyGoalProgress(
  days: readonly StudyDay[],
  now: Date,
  timeZone: string,
  target: number = DEFAULT_DAILY_GOAL,
): DailyGoal {
  const today = localDate(now, timeZone);
  const goal = clampGoal(target);

  const completed = days
    .filter((day) => day.date === today)
    .reduce((sum, day) => sum + Math.max(0, day.reviewsCompleted), 0);

  return {
    target: goal,
    completed,
    remaining: Math.max(0, goal - completed),
    progress: goal > 0 ? Math.min(1, completed / goal) : 0,
    met: completed >= goal,
  };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressSummary {
  readonly reviewsCompleted: number;
  readonly secondsStudied: number;
  readonly studyDays: number;
  readonly firstStudyDate: string | null;
}

/** Lifetime totals, from persisted daily activity. */
export function summariseProgress(days: readonly StudyDay[]): ProgressSummary {
  const qualifying = days.filter(qualifies);
  const dates = [...new Set(qualifying.map((day) => day.date))].sort();

  return {
    reviewsCompleted: days.reduce((sum, day) => sum + Math.max(0, day.reviewsCompleted), 0),
    secondsStudied: days.reduce((sum, day) => sum + Math.max(0, day.secondsStudied), 0),
    studyDays: dates.length,
    firstStudyDate: dates[0] ?? null,
  };
}

/** A calendar of the last `count` days, for a heat strip. Oldest first. */
export function recentActivity(
  days: readonly StudyDay[],
  now: Date,
  timeZone: string,
  count = 28,
): readonly { readonly date: string; readonly reviews: number }[] {
  const byDate = new Map<string, number>();
  for (const day of days) {
    byDate.set(day.date, (byDate.get(day.date) ?? 0) + Math.max(0, day.reviewsCompleted));
  }

  const out: { date: string; reviews: number }[] = [];
  let cursor = localDate(now, timeZone);

  for (let i = 0; i < count; i += 1) {
    out.push({ date: cursor, reviews: byDate.get(cursor) ?? 0 });
    cursor = previousDate(cursor);
  }

  return out.reverse();
}

/** An ISO instant's local date, for recording activity. */
export function activityDateFor(instant: ISODateString, timeZone: string): string {
  const parsed = Date.parse(instant);
  return localDate(Number.isFinite(parsed) ? new Date(parsed) : new Date(0), timeZone);
}
