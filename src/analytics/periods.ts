import type { ISODateString } from '@/types/domain/primitives';
import { localDate, previousDate } from '@/learning/streaks';
import {
  ANALYTICS_PERIODS,
  PERIOD_DAYS,
  PERIOD_LABELS,
  type AnalyticsPeriod,
  type PeriodWindow,
  type TrendGranularity,
  type TrendPoint,
} from './contract';

/**
 * Period resolution and time bucketing.
 *
 * Every date here is a LOCAL calendar date in the learner's timezone, derived
 * with `localDate` from Gate 12 — the same function the streak uses. Two
 * different notions of "day" in one product is how a dashboard ends up saying
 * a learner studied today while their streak says they did not.
 */

export function isAnalyticsPeriod(value: unknown): value is AnalyticsPeriod {
  return typeof value === 'string' && (ANALYTICS_PERIODS as readonly string[]).includes(value);
}

/**
 * Resolve a period into a concrete window.
 *
 * The lower bound is the START of the local day `days - 1` ago, not `now`
 * minus N×24h. "Last 7 days" means seven calendar days including today, which
 * is what a learner means by it; a rolling 168-hour window would show six and
 * a bit days and disagree with the activity strip beside it.
 */
export function resolveWindow(
  period: AnalyticsPeriod,
  now: Date,
  timeZone: string,
): PeriodWindow {
  const days = PERIOD_DAYS[period];

  if (days === null) {
    return {
      period,
      label: PERIOD_LABELS[period],
      from: null,
      to: now.toISOString() as ISODateString,
      days: null,
    };
  }

  let cursor = localDate(now, timeZone);
  for (let i = 1; i < days; i += 1) cursor = previousDate(cursor);

  return {
    period,
    label: PERIOD_LABELS[period],
    from: startOfLocalDay(cursor, timeZone).toISOString() as ISODateString,
    to: now.toISOString() as ISODateString,
    days,
  };
}

/**
 * The instant a local calendar date begins, in a given timezone.
 *
 * Found by search rather than by offset arithmetic. An offset is not a
 * constant — it changes at a DST boundary, and on the day it changes, naive
 * arithmetic lands an hour into the previous day and silently shifts a whole
 * window. Two candidate instants are tested and the earliest whose local date
 * matches is taken, which is correct on both sides of any transition.
 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnightUtc)) return new Date(0);

  // Offsets run from UTC-12 to UTC+14, so the true local midnight lies within
  // a day either side of UTC midnight.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 12 * 60; offsetMinutes += 15) {
    const candidate = new Date(midnightUtc + offsetMinutes * 60_000);
    if (localDate(candidate, timeZone) !== date) continue;

    // The first candidate whose local date matches, minus one step, is still
    // the previous day — so this one is the first instant of `date`.
    const before = new Date(candidate.getTime() - 15 * 60_000);
    if (localDate(before, timeZone) !== date) return candidate;
  }

  return new Date(midnightUtc);
}

/** Whether an instant falls inside a resolved window. */
export function within(window: PeriodWindow, instantMs: number): boolean {
  if (window.from === null) return true;
  return instantMs >= Date.parse(window.from);
}

/**
 * Which granularity suits a window.
 *
 * Ninety daily points on a phone is a smear. Weeks beyond a month keep the
 * shape readable without inventing smoothing that would hide real variation.
 */
export function granularityFor(window: PeriodWindow): TrendGranularity {
  if (window.days === null) return 'week';
  return window.days <= 30 ? 'day' : 'week';
}

/** The Monday of the ISO week containing a local date. */
export function weekStart(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;

  const utc = new Date(parsed);
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const shift = (utc.getUTCDay() + 6) % 7;
  return new Date(parsed - shift * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every bucket in a window, oldest first, including empty ones.
 *
 * Empty buckets are present on purpose. A chart drawn only from days that have
 * data compresses a gap into a straight line and shows continuous study where
 * there was a fortnight off.
 */
export function buckets(
  window: PeriodWindow,
  granularity: TrendGranularity,
  now: Date,
  timeZone: string,
  earliest: string | null,
): string[] {
  const today = localDate(now, timeZone);

  let firstDay: string;
  if (window.from !== null) {
    firstDay = localDate(new Date(Date.parse(window.from)), timeZone);
  } else if (earliest !== null) {
    firstDay = earliest;
  } else {
    firstDay = today;
  }

  const out: string[] = [];
  let cursor = today;

  // Walking backwards from today bounds the loop by the window rather than by
  // whatever the earliest event claims — a single bad timestamp cannot spin
  // this into a million iterations.
  const limit = window.days ?? 3650;
  for (let i = 0; i < limit && cursor >= firstDay; i += 1) {
    out.push(cursor);
    cursor = previousDate(cursor);
  }

  out.reverse();

  if (granularity === 'day') return out;

  const weeks: string[] = [];
  for (const day of out) {
    const start = weekStart(day);
    if (weeks[weeks.length - 1] !== start) weeks.push(start);
  }
  return weeks;
}

/** The bucket a local date belongs to. */
export function bucketOf(date: string, granularity: TrendGranularity): string {
  return granularity === 'day' ? date : weekStart(date);
}

/**
 * Build a trend from per-bucket samples.
 *
 * A bucket with no samples gets `value: null`, never 0. The distinction is the
 * whole point: 0% retention means the learner got everything wrong, and no
 * data means they did not study. Drawing the second as the first invents a
 * catastrophe.
 */
export function toTrend(
  orderedBuckets: readonly string[],
  samples: ReadonlyMap<string, readonly number[]>,
): TrendPoint[] {
  return orderedBuckets.map((date) => {
    const values = samples.get(date) ?? [];
    if (values.length === 0) return { date, value: null, sampleSize: 0 };

    const total = values.reduce((sum, value) => sum + value, 0);
    return { date, value: total / values.length, sampleSize: values.length };
  });
}

/** The same, for counts rather than averages. A bucket with no events is 0. */
export function toCountTrend(
  orderedBuckets: readonly string[],
  counts: ReadonlyMap<string, number>,
): TrendPoint[] {
  return orderedBuckets.map((date) => {
    const value = counts.get(date) ?? 0;
    return { date, value, sampleSize: value };
  });
}
