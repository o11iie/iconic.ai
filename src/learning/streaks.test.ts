import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_GOAL,
  GOAL_BOUNDS,
  MIN_REVIEWS_FOR_STUDY_DAY,
  activityDateFor,
  calendarDaysBetween,
  clampGoal,
  computeStreak,
  dailyGoalProgress,
  localDate,
  previousDate,
  qualifies,
  recentActivity,
  summariseProgress,
  type StudyDay,
} from './streaks';
import type { ISODateString } from '@/types/domain/primitives';

function day(date: string, reviewsCompleted = 5, secondsStudied = 300): StudyDay {
  return { date, reviewsCompleted, secondsStudied };
}

/** A run of consecutive days ending on `last`. */
function run(last: string, length: number, reviews = 5): StudyDay[] {
  const out: StudyDay[] = [];
  let cursor = last;
  for (let i = 0; i < length; i += 1) {
    out.push(day(cursor, reviews));
    cursor = previousDate(cursor);
  }
  return out.reverse();
}

describe('local dates', () => {
  it('derives the calendar date in the learner\'s timezone, not the server\'s', () => {
    // The same instant, three places, three different dates.
    const instant = new Date('2026-03-15T11:30:00.000Z');
    expect(localDate(instant, 'UTC')).toBe('2026-03-15');
    expect(localDate(instant, 'Pacific/Auckland')).toBe('2026-03-16');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-03-15');
  });

  it('splits two instants 20 minutes apart across a local midnight', () => {
    // 23:50 and 00:10 in Auckland is two study days. In UTC it is one.
    const before = new Date('2026-03-15T10:50:00.000Z');
    const after = new Date('2026-03-15T11:10:00.000Z');

    expect(localDate(before, 'Pacific/Auckland')).toBe('2026-03-15');
    expect(localDate(after, 'Pacific/Auckland')).toBe('2026-03-16');
    expect(localDate(before, 'UTC')).toBe(localDate(after, 'UTC'));
  });

  it('is correct across a daylight-saving spring forward', () => {
    // US DST begins 2026-03-08. Offset arithmetic silently duplicates or
    // skips a day here; Intl does not.
    const beforeShift = new Date('2026-03-08T09:00:00.000Z'); // 01:00 PST
    const afterShift = new Date('2026-03-08T11:00:00.000Z'); // 04:00 PDT
    expect(localDate(beforeShift, 'America/New_York')).toBe('2026-03-08');
    expect(localDate(afterShift, 'America/New_York')).toBe('2026-03-08');
  });

  it('is correct across a daylight-saving fall back', () => {
    // US DST ends 2026-11-01; 01:00–02:00 local happens twice.
    const firstOne = new Date('2026-11-01T05:30:00.000Z'); // 01:30 EDT
    const secondOne = new Date('2026-11-01T06:30:00.000Z'); // 01:30 EST
    expect(localDate(firstOne, 'America/New_York')).toBe('2026-11-01');
    expect(localDate(secondOne, 'America/New_York')).toBe('2026-11-01');
  });

  it('handles a half-hour offset zone', () => {
    const instant = new Date('2026-03-15T18:45:00.000Z');
    expect(localDate(instant, 'Asia/Kolkata')).toBe('2026-03-16'); // +05:30
  });

  it('caches formatters without letting one timezone answer for another', () => {
    // `localDate` memoises its Intl formatters — constructing one per call
    // measured 60x slower, which was invisible while only the streak used it
    // and became the dominant cost once analytics derived a local date per
    // review event. The cache must be keyed correctly: a shared formatter
    // would silently report every learner's day in the first timezone seen.
    const instant = new Date('2026-03-15T11:30:00.000Z');

    const zones = [
      ['UTC', '2026-03-15'],
      ['Pacific/Auckland', '2026-03-16'],
      ['America/Los_Angeles', '2026-03-15'],
      ['Asia/Kolkata', '2026-03-15'], // +05:30 puts this at 17:00 the same day
      ['Australia/Sydney', '2026-03-15'],
    ] as const;

    // Twice through, so the second pass reads from the cache.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const [zone, expected] of zones) {
        expect(localDate(instant, zone), `${zone} on pass ${pass}`).toBe(expected);
      }
    }
  });

  it('keeps DST correctness after caching', () => {
    // The cached formatter must still resolve offsets per instant, not freeze
    // the offset in force when it was built.
    const beforeDst = new Date('2026-03-08T04:30:00.000Z'); // 23:30 EST, Mar 7
    const afterDst = new Date('2026-03-08T17:00:00.000Z'); // 13:00 EDT, Mar 8

    expect(localDate(beforeDst, 'America/New_York')).toBe('2026-03-07');
    expect(localDate(afterDst, 'America/New_York')).toBe('2026-03-08');
    // And again from the cache.
    expect(localDate(beforeDst, 'America/New_York')).toBe('2026-03-07');
  });

  it('falls back to UTC rather than losing history on a bad timezone', () => {
    const instant = new Date('2026-03-15T11:30:00.000Z');
    expect(localDate(instant, 'Not/AZone')).toBe('2026-03-15');
    expect(localDate(instant, '')).toBe('2026-03-15');
  });

  it('counts calendar days, not elapsed hours', () => {
    expect(calendarDaysBetween('2026-03-14', '2026-03-15')).toBe(1);
    expect(calendarDaysBetween('2026-02-28', '2026-03-01')).toBe(1); // 2026 is not a leap year
    expect(calendarDaysBetween('2028-02-28', '2028-03-01')).toBe(2); // 2028 is
    expect(calendarDaysBetween('2026-03-15', '2026-03-15')).toBe(0);
  });

  it('steps back a day across month, year and leap boundaries', () => {
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
    expect(previousDate('2028-03-01')).toBe('2028-02-29');
  });

  it('records activity against the instant\'s local date', () => {
    const instant = '2026-03-15T11:10:00.000Z' as ISODateString;
    expect(activityDateFor(instant, 'Pacific/Auckland')).toBe('2026-03-16');
    expect(activityDateFor(instant, 'UTC')).toBe('2026-03-15');
  });
});

describe('what counts as a study day', () => {
  it('requires completed reviews, not attendance', () => {
    // A row can exist for a day the learner opened the app and reviewed
    // nothing. Counting it would be counting logins.
    expect(qualifies(day('2026-03-15', 0, 600))).toBe(false);
    expect(qualifies(day('2026-03-15', MIN_REVIEWS_FOR_STUDY_DAY, 0))).toBe(true);
  });

  it('does not count a day of app time with no reviews toward a streak', () => {
    const now = new Date('2026-03-15T12:00:00.000Z');
    const summary = computeStreak(
      [day('2026-03-13', 5), day('2026-03-14', 0, 3600), day('2026-03-15', 5)],
      now,
      'UTC',
    );
    // 14th does not qualify, so the run is broken and only today counts.
    expect(summary.current).toBe(1);
    expect(summary.totalStudyDays).toBe(2);
  });
});

describe('streaks', () => {
  const now = new Date('2026-03-15T12:00:00.000Z');

  it('is all zeroes and nulls for a learner who has never studied', () => {
    // An empty account must show honest zeroes, never invented encouragement.
    expect(computeStreak([], now, 'UTC')).toEqual({
      current: 0, longest: 0, totalStudyDays: 0, lastStudyDate: null, studiedToday: false,
    });
  });

  it('counts an unbroken run ending today', () => {
    const summary = computeStreak(run('2026-03-15', 7), now, 'UTC');
    expect(summary.current).toBe(7);
    expect(summary.longest).toBe(7);
    expect(summary.studiedToday).toBe(true);
    expect(summary.lastStudyDate).toBe('2026-03-15');
  });

  it('keeps the streak alive before today\'s session', () => {
    // At breakfast on day 18 the learner has a 17-day streak and has not yet
    // studied. Telling them it is broken would be wrong.
    const summary = computeStreak(run('2026-03-14', 17), now, 'UTC');
    expect(summary.current).toBe(17);
    expect(summary.studiedToday).toBe(false);
  });

  it('breaks the streak once a whole day has been missed', () => {
    const summary = computeStreak(run('2026-03-13', 17), now, 'UTC');
    expect(summary.current).toBe(0);
    expect(summary.longest).toBe(17);
    expect(summary.totalStudyDays).toBe(17);
  });

  it('remembers the longest run after the current one breaks', () => {
    const days = [...run('2026-02-20', 30), ...run('2026-03-15', 3)];
    const summary = computeStreak(days, now, 'UTC');
    expect(summary.current).toBe(3);
    expect(summary.longest).toBe(30);
  });

  it('reports the current run as longest when it is', () => {
    const summary = computeStreak([...run('2026-02-20', 2), ...run('2026-03-15', 9)], now, 'UTC');
    expect(summary.longest).toBe(9);
  });

  it('is not inflated by several sessions on one day', () => {
    const summary = computeStreak(
      [day('2026-03-15', 3), day('2026-03-15', 4), day('2026-03-14', 2)],
      now,
      'UTC',
    );
    expect(summary.current).toBe(2);
    expect(summary.totalStudyDays).toBe(2);
  });

  it('does not depend on the order rows arrive in', () => {
    const days = run('2026-03-15', 6);
    const shuffled = [days[3]!, days[0]!, days[5]!, days[1]!, days[4]!, days[2]!];
    expect(computeStreak(shuffled, now, 'UTC')).toEqual(computeStreak(days, now, 'UTC'));
  });

  it('evaluates "today" in the learner\'s timezone', () => {
    // 2026-03-15T12:00Z is already the 16th in Auckland. A run ending on the
    // 15th is therefore yesterday's — alive, but not studied today.
    const days = run('2026-03-15', 4);
    expect(computeStreak(days, now, 'UTC').studiedToday).toBe(true);
    const auckland = computeStreak(days, now, 'Pacific/Auckland');
    expect(auckland.studiedToday).toBe(false);
    expect(auckland.current).toBe(4);
  });

  it('counts a streak that spans a DST transition as unbroken', () => {
    // US DST begins 2026-03-08. A 6-day run across it is still 6 days.
    const summary = computeStreak(
      run('2026-03-10', 6),
      new Date('2026-03-10T18:00:00.000Z'),
      'America/New_York',
    );
    expect(summary.current).toBe(6);
    expect(summary.longest).toBe(6);
  });

  it('counts a streak that spans a year boundary', () => {
    const summary = computeStreak(
      run('2026-01-02', 10),
      new Date('2026-01-02T18:00:00.000Z'),
      'UTC',
    );
    expect(summary.current).toBe(10);
    expect(summary.lastStudyDate).toBe('2026-01-02');
  });
});

describe('the daily goal', () => {
  const now = new Date('2026-03-15T12:00:00.000Z');

  it('counts only today\'s persisted reviews', () => {
    const goal = dailyGoalProgress(
      [day('2026-03-14', 100), day('2026-03-15', 8)],
      now,
      'UTC',
      20,
    );
    expect(goal.completed).toBe(8);
    expect(goal.remaining).toBe(12);
    expect(goal.progress).toBeCloseTo(0.4, 9);
    expect(goal.met).toBe(false);
  });

  it('caps progress at complete rather than reporting 140%', () => {
    const goal = dailyGoalProgress([day('2026-03-15', 28)], now, 'UTC', 20);
    expect(goal.progress).toBe(1);
    expect(goal.remaining).toBe(0);
    expect(goal.met).toBe(true);
  });

  it('starts at zero for a learner who has not studied today', () => {
    const goal = dailyGoalProgress([day('2026-03-14', 50)], now, 'UTC');
    expect(goal).toEqual({
      target: DEFAULT_DAILY_GOAL, completed: 0, remaining: DEFAULT_DAILY_GOAL,
      progress: 0, met: false,
    });
  });

  it('sums several sessions in the same local day', () => {
    const goal = dailyGoalProgress(
      [day('2026-03-15', 4), day('2026-03-15', 6)],
      now,
      'UTC',
      20,
    );
    expect(goal.completed).toBe(10);
  });

  it('uses the learner\'s timezone to decide which day is today', () => {
    const days = [day('2026-03-15', 9), day('2026-03-16', 2)];
    expect(dailyGoalProgress(days, now, 'UTC', 20).completed).toBe(9);
    expect(dailyGoalProgress(days, now, 'Pacific/Auckland', 20).completed).toBe(2);
  });

  it('clamps an out-of-range or nonsensical target', () => {
    expect(clampGoal(0)).toBe(GOAL_BOUNDS.min);
    expect(clampGoal(-40)).toBe(GOAL_BOUNDS.min);
    expect(clampGoal(10_000)).toBe(GOAL_BOUNDS.max);
    expect(clampGoal(12.9)).toBe(12);
    expect(clampGoal(Number.NaN)).toBe(DEFAULT_DAILY_GOAL);
    expect(clampGoal(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DAILY_GOAL);
  });

  it('never divides by zero, even if a stored target is 0', () => {
    const goal = dailyGoalProgress([day('2026-03-15', 5)], now, 'UTC', 0);
    expect(Number.isFinite(goal.progress)).toBe(true);
    expect(goal.target).toBe(GOAL_BOUNDS.min);
  });
});

describe('progress totals', () => {
  it('sums lifetime activity and names the first study day', () => {
    const summary = summariseProgress([
      day('2026-03-10', 10, 600),
      day('2026-03-11', 5, 300),
      day('2026-03-12', 0, 120), // did not qualify
    ]);
    expect(summary.reviewsCompleted).toBe(15);
    expect(summary.secondsStudied).toBe(1020);
    expect(summary.studyDays).toBe(2);
    expect(summary.firstStudyDate).toBe('2026-03-10');
  });

  it('is honestly empty for a new account', () => {
    expect(summariseProgress([])).toEqual({
      reviewsCompleted: 0, secondsStudied: 0, studyDays: 0, firstStudyDate: null,
    });
  });

  it('ignores negative stored counters rather than subtracting them', () => {
    const summary = summariseProgress([day('2026-03-10', -5, -100), day('2026-03-11', 4, 60)]);
    expect(summary.reviewsCompleted).toBe(4);
    expect(summary.secondsStudied).toBe(60);
  });
});

describe('the activity strip', () => {
  const now = new Date('2026-03-15T12:00:00.000Z');

  it('returns a contiguous window ending today, oldest first', () => {
    const strip = recentActivity([day('2026-03-15', 3)], now, 'UTC', 7);

    expect(strip).toHaveLength(7);
    expect(strip[0]!.date).toBe('2026-03-09');
    expect(strip[6]!.date).toBe('2026-03-15');
    for (let i = 1; i < strip.length; i += 1) {
      expect(calendarDaysBetween(strip[i - 1]!.date, strip[i]!.date)).toBe(1);
    }
  });

  it('shows real zeroes for days with no activity', () => {
    const strip = recentActivity([day('2026-03-15', 3)], now, 'UTC', 3);
    expect(strip.map((d) => d.reviews)).toEqual([0, 0, 3]);
  });

  it('merges several rows for the same day', () => {
    const strip = recentActivity([day('2026-03-15', 3), day('2026-03-15', 4)], now, 'UTC', 1);
    expect(strip[0]!.reviews).toBe(7);
  });

  it('is all zeroes for a learner with no history', () => {
    const strip = recentActivity([], now, 'UTC', 28);
    expect(strip).toHaveLength(28);
    expect(strip.every((d) => d.reviews === 0)).toBe(true);
  });
});

describe('purity', () => {
  it('reads no clock of its own', async () => {
    // Every function here takes `now`. If one called `new Date()` the streak
    // would depend on when the test ran, which is how timezone bugs survive.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'src/learning/streaks.ts'), 'utf8');

    // Positive control: the scan must be looking at the real module. If the
    // path were wrong this would read an empty string and pass vacuously.
    expect(source).toContain('export function computeStreak');

    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/new Date\(\s*\)/);
    expect(code).not.toMatch(/Date\.now\(/);
  });

  it('does not mutate the rows it is given', () => {
    const days = run('2026-03-15', 5);
    const snapshot = structuredClone(days);
    const now = new Date('2026-03-15T12:00:00.000Z');

    computeStreak(days, now, 'UTC');
    dailyGoalProgress(days, now, 'UTC');
    summariseProgress(days);
    recentActivity(days, now, 'UTC');

    expect(days).toEqual(snapshot);
  });
});
