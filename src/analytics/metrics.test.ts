import { describe, expect, it } from 'vitest';
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from './contract';
import { clean } from './integrity';
import {
  computeActivity,
  computeRecall,
  computeRetention,
  computeSessions,
  computeVelocity,
  retentionOf,
} from './metrics';
import { granularityFor, isAnalyticsPeriod, resolveWindow, startOfLocalDay, weekStart } from './periods';
import { REFERENCE, event, item, iso, referenceSnapshot, session, snapshot, toId } from './fixtures';

/**
 * The metric calculations, asserted against values worked out by hand.
 *
 * Every expectation below is a literal that can be checked with a pencil. A
 * test that asserts `retention > 0` passes for a function returning 0.001, and
 * proves only that something ran.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');

function windowFor(period: AnalyticsPeriod, timeZone = 'UTC') {
  return resolveWindow(period, NOW, timeZone);
}

function cleaned(raw: Parameters<typeof clean>[0]) {
  return clean(raw, NOW);
}

describe('periods', () => {
  it('accepts only the periods VEO defines', () => {
    for (const period of ANALYTICS_PERIODS) expect(isAnalyticsPeriod(period)).toBe(true);
    for (const rubbish of ['1d', '', 'ALL', '30', 365, null, {}, '7d; drop table']) {
      expect(isAnalyticsPeriod(rubbish)).toBe(false);
    }
  });

  it('includes today in a 7-day window, so it covers 7 calendar days', () => {
    // A rolling 168 hours would start mid-day and disagree with the activity
    // strip beside it.
    const window = windowFor('7d');
    expect(window.from).toBe('2026-06-09T00:00:00.000Z');
    expect(window.days).toBe(7);
  });

  it('has no lower bound for all time', () => {
    const window = windowFor('all');
    expect(window.from).toBeNull();
    expect(window.days).toBeNull();
  });

  it('resolves the window in the learner\'s timezone, not the server\'s', () => {
    // 2026-06-15T12:00Z is already the 16th in Auckland, so their 7-day window
    // starts a day later than a UTC learner's.
    expect(windowFor('7d', 'Pacific/Auckland').from).toBe('2026-06-09T12:00:00.000Z');
    expect(windowFor('7d', 'UTC').from).toBe('2026-06-09T00:00:00.000Z');
  });

  it('finds the true start of a local day across a DST boundary', () => {
    // US DST began 2026-03-08. Offset arithmetic lands an hour into the
    // previous day here; a search does not.
    const start = startOfLocalDay('2026-03-08', 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');

    const after = startOfLocalDay('2026-03-09', 'America/New_York');
    expect(after.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('buckets by day for short windows and by week for long ones', () => {
    expect(granularityFor(windowFor('7d'))).toBe('day');
    expect(granularityFor(windowFor('30d'))).toBe('day');
    expect(granularityFor(windowFor('90d'))).toBe('week');
    expect(granularityFor(windowFor('all'))).toBe('week');
  });

  it('anchors weeks to Monday', () => {
    expect(weekStart('2026-06-15')).toBe('2026-06-15'); // a Monday
    expect(weekStart('2026-06-21')).toBe('2026-06-15'); // the Sunday after
    expect(weekStart('2026-06-14')).toBe('2026-06-08'); // the Sunday before
  });
});

describe('retention', () => {
  const reference = cleaned(referenceSnapshot(NOW));

  it('is null with no reviews, never 0%', () => {
    // 0% says the learner got everything wrong. Null says nothing was measured.
    const empty = cleaned(snapshot());
    expect(computeRetention(empty, windowFor('30d'), NOW).overall).toBeNull();
    expect(retentionOf([])).toBeNull();
  });

  it('reports a single review honestly rather than as a rate', () => {
    const one = cleaned(
      snapshot({
        items: [item('i1')],
        events: [event('e1', 'i1', 'good', iso(NOW, -1))],
      }),
    );
    const metrics = computeRetention(one, windowFor('30d'), NOW);

    expect(metrics.overall).toBe(1);
    expect(metrics.totalReviews).toBe(1);
    // With one review there is nothing to compare, so no direction is claimed.
    expect(metrics.change).toBeNull();
  });

  it('computes the reference learner\'s overall retention exactly', () => {
    // 15 reviews, 9 recalled.
    const metrics = computeRetention(reference, windowFor('30d'), NOW);
    expect(metrics.totalReviews).toBe(REFERENCE.totalReviews);
    expect(metrics.overall).toBeCloseTo(REFERENCE.overallRetention, 9);
  });

  it('computes retention per structure exactly', () => {
    const metrics = computeRetention(reference, windowFor('30d'), NOW);
    const byId = new Map(metrics.byStructure.map((entry) => [entry.semanticId, entry]));

    expect(byId.get(toId(REFERENCE.structureA))).toMatchObject({
      retention: REFERENCE.retentionA,
      reviews: 10,
      lapses: 2,
    });
    expect(byId.get(toId(REFERENCE.structureB))).toMatchObject({
      retention: REFERENCE.retentionB,
      reviews: 5,
      lapses: 4,
    });
  });

  it('lists the weakest structure first', () => {
    const metrics = computeRetention(reference, windowFor('30d'), NOW);
    expect(metrics.byStructure[0]!.semanticId).toBe(toId(REFERENCE.structureB));
  });

  it('omits a structure with no reviews rather than showing it at 0%', () => {
    const metrics = computeRetention(reference, windowFor('30d'), NOW);
    const ids = metrics.byStructure.map((entry) => entry.semanticId);
    expect(ids).not.toContain(toId(REFERENCE.structureC));
  });

  it('rolls retention up the semantic hierarchy, with no domain knowledge', () => {
    const metrics = computeRetention(reference, windowFor('30d'), NOW);
    const groups = new Map(metrics.byGroup.map((entry) => [entry.semanticId, entry]));

    // system_a holds both reviewed structures: 15 reviews, 9 recalled.
    const systemA = groups.get(toId('veo.diagnostic.analytics_fixture.system_a'));
    expect(systemA).toMatchObject({ reviews: 15, structures: 2 });
    expect(systemA!.retention).toBeCloseTo(0.6, 9);
  });

  it('works identically for a domain that is not anatomy', () => {
    const chem = cleaned(
      snapshot({
        items: [
          item('i1', { semanticId: toId('veo.chemistry.organic.aromatic.benzene') }),
          item('i2', { semanticId: toId('veo.chemistry.organic.aromatic.toluene') }),
        ],
        events: [
          event('e1', 'i1', 'good', iso(NOW, -1)),
          event('e2', 'i1', 'good', iso(NOW, -2)),
          event('e3', 'i2', 'again', iso(NOW, -1)),
          event('e4', 'i2', 'again', iso(NOW, -2)),
        ],
      }),
    );

    const metrics = computeRetention(chem, windowFor('30d'), NOW);
    expect(metrics.overall).toBe(0.5);

    const aromatic = metrics.byGroup.find(
      (entry) => entry.semanticId === toId('veo.chemistry.organic.aromatic'),
    );
    expect(aromatic).toMatchObject({ reviews: 4, structures: 2 });
  });

  it('scopes to the requested window', () => {
    // The reference learner's structure-B reviews all fall in the last 5 days;
    // structure A's stretch back 10.
    const sevenDay = computeRetention(reference, windowFor('7d'), NOW);
    const thirtyDay = computeRetention(reference, windowFor('30d'), NOW);

    expect(sevenDay.totalReviews).toBeLessThan(thirtyDay.totalReviews);
    expect(thirtyDay.totalReviews).toBe(15);
  });

  it('draws a trend bucket with no reviews as null, not zero', () => {
    // A day off is not a day of total failure.
    const sparse = cleaned(
      snapshot({
        items: [item('i1')],
        events: [event('e1', 'i1', 'good', iso(NOW, -6))],
      }),
    );
    const metrics = computeRetention(sparse, windowFor('7d'), NOW);

    expect(metrics.trend).toHaveLength(7);
    expect(metrics.trend.filter((point) => point.value === null).length).toBe(6);
    expect(metrics.trend.filter((point) => point.value === 0).length).toBe(0);
  });

  it('refuses to report a change from too small a sample', () => {
    // Eight reviews splits into two halves of four — both non-empty, both
    // below the floor. This is the case that proves the guard runs at all: an
    // earlier revision split at a fixed tail, which left the earlier half
    // empty below 21 reviews and made the guard unreachable.
    const eight = cleaned(
      snapshot({
        items: [item('i1')],
        events: Array.from({ length: 8 }, (_, i) =>
          event(`e${i}`, 'i1', i < 4 ? 'again' : 'good', iso(NOW, -(8 - i))),
        ),
      }),
    );
    const metrics = computeRetention(eight, windowFor('30d'), NOW);

    expect(metrics.totalReviews).toBe(8);
    expect(metrics.change).toBeNull();
  });

  it('reports a change once both halves are big enough', () => {
    // Ten reviews: first five all failed, last five all recalled.
    // Earlier half 0.0, recent half 1.0, so change is exactly +1.
    const ten = cleaned(
      snapshot({
        items: [item('i1')],
        events: Array.from({ length: 10 }, (_, i) =>
          event(`e${i}`, 'i1', i < 5 ? 'again' : 'good', iso(NOW, -(10 - i))),
        ),
      }),
    );
    const metrics = computeRetention(ten, windowFor('30d'), NOW);

    expect(metrics.change).toBeCloseTo(1, 9);
    expect(metrics.overall).toBeCloseTo(0.5, 9);
  });

  it('reports a decline as a negative change', () => {
    const declining = cleaned(
      snapshot({
        items: [item('i1')],
        events: Array.from({ length: 12 }, (_, i) =>
          event(`e${i}`, 'i1', i < 6 ? 'good' : 'again', iso(NOW, -(12 - i))),
        ),
      }),
    );
    expect(computeRetention(declining, windowFor('30d'), NOW).change).toBeCloseTo(-1, 9);
  });

  it('keeps the recent figure separate from the change comparison', () => {
    // `recent` is the last 20 reviews; `change` compares halves. With 10
    // reviews `recent` covers all of them, so it must NOT equal the recent
    // half used for the change.
    const ten = cleaned(
      snapshot({
        items: [item('i1')],
        events: Array.from({ length: 10 }, (_, i) =>
          event(`e${i}`, 'i1', i < 5 ? 'again' : 'good', iso(NOW, -(10 - i))),
        ),
      }),
    );
    const metrics = computeRetention(ten, windowFor('30d'), NOW);

    expect(metrics.recentSampleSize).toBe(10);
    expect(metrics.recent).toBeCloseTo(0.5, 9);
    expect(metrics.change).toBeCloseTo(1, 9);
  });
});

describe('recall', () => {
  const reference = cleaned(referenceSnapshot(NOW));

  it('counts every rating', () => {
    const metrics = computeRecall(reference, windowFor('30d'), NOW);
    const { again, hard, good, easy } = metrics.distribution;

    expect(again + hard + good + easy).toBe(REFERENCE.totalReviews);
    // Structure A had 2 failures, structure B had 4.
    expect(again).toBe(6);
  });

  it('excludes self-rated flashcards from accuracy rather than counting them correct', () => {
    // The reference learner's flashcard reviews carry correct: null. Counting
    // them as correct would inflate accuracy by exactly the share of their
    // material that is flashcards.
    const metrics = computeRecall(reference, windowFor('30d'), NOW);

    expect(metrics.checkableReviews).toBe(10); // structure A only
    expect(metrics.accuracy).toBeCloseTo(0.8, 9);
    expect(metrics.totalReviews).toBe(15);
  });

  it('is null for accuracy when nothing was checkable', () => {
    const flashOnly = cleaned(
      snapshot({
        items: [item('i1', { contentType: 'flashcard' })],
        events: [event('e1', 'i1', 'good', iso(NOW, -1), { correct: null })],
      }),
    );
    const metrics = computeRecall(flashOnly, windowFor('30d'), NOW);
    expect(metrics.accuracy).toBeNull();
    expect(metrics.checkableReviews).toBe(0);
  });

  it('averages rating quality on the documented scale', () => {
    const mixed = cleaned(
      snapshot({
        items: [item('i1')],
        events: [
          event('e1', 'i1', 'again', iso(NOW, -4)), // 0
          event('e2', 'i1', 'easy', iso(NOW, -3)), // 1
        ],
      }),
    );
    expect(computeRecall(mixed, windowFor('30d'), NOW).averageQuality).toBeCloseTo(0.5, 9);
  });

  it('uses a median response time, so one interruption cannot skew it', () => {
    const withOutlier = cleaned(
      snapshot({
        items: [item('i1')],
        events: [
          event('e1', 'i1', 'good', iso(NOW, -3), { responseMs: 2000 }),
          event('e2', 'i1', 'good', iso(NOW, -2), { responseMs: 3000 }),
          event('e3', 'i1', 'good', iso(NOW, -1), { responseMs: 600_000 }),
        ],
      }),
    );
    expect(computeRecall(withOutlier, windowFor('30d'), NOW).medianResponseMs).toBe(3000);
  });

  it('does not call an item difficult after one bad answer', () => {
    const oneBad = cleaned(
      snapshot({
        items: [item('i1')],
        events: [
          event('e1', 'i1', 'good', iso(NOW, -3)),
          event('e2', 'i1', 'again', iso(NOW, -2)),
          event('e3', 'i1', 'good', iso(NOW, -1)),
        ],
      }),
    );
    expect(computeRecall(oneBad, windowFor('30d'), NOW).difficultItems).toEqual([]);
  });

  it('flags an item that keeps going wrong, worst first', () => {
    const metrics = computeRecall(reference, windowFor('30d'), NOW);

    expect(metrics.difficultItems.map((entry) => entry.itemId)).toEqual(['item-b', 'item-a']);
    expect(metrics.difficultItems[0]).toMatchObject({
      failures: 4,
      reviews: 5,
      retention: 0.2,
      contentType: 'flashcard',
    });
  });
});

describe('activity', () => {
  const reference = cleaned(referenceSnapshot(NOW));

  it('separates questions from flashcards', () => {
    const metrics = computeActivity(reference, windowFor('30d'), NOW);
    expect(metrics.questionsAnswered).toBe(10);
    expect(metrics.flashcardsReviewed).toBe(5);
    expect(metrics.reviews).toBe(15);
  });

  it('sums study time from per-review durations, not wall-clock', () => {
    // 15 reviews at 4s each. A tab left open overnight is not eight hours of
    // study, and counting it would be the easiest possible way to flatter a
    // learner with a number they did not earn.
    const metrics = computeActivity(reference, windowFor('30d'), NOW);
    expect(metrics.studySeconds).toBe(60);
  });

  it('counts active days from real reviews', () => {
    const metrics = computeActivity(reference, windowFor('30d'), NOW);
    // Reviews land on days -10..-1, so ten distinct local dates.
    expect(metrics.activeDays).toBe(10);
  });

  it('reports consistency against the window, and null for all time', () => {
    expect(computeActivity(reference, windowFor('30d'), NOW).consistency).toBeCloseTo(10 / 30, 9);
    expect(computeActivity(reference, windowFor('all'), NOW).consistency).toBeNull();
  });

  it('separates completed from abandoned sessions', () => {
    const withBoth = cleaned(
      snapshot({
        sessions: [
          session('s1', iso(NOW, -1)),
          session('s2', iso(NOW, -2), { status: 'abandoned' }),
          session('s3', iso(NOW, -3), { status: 'active', endedAt: null }),
        ],
      }),
    );
    const metrics = computeActivity(withBoth, windowFor('30d'), NOW);

    expect(metrics.sessions).toBe(3);
    expect(metrics.completedSessions).toBe(1);
    expect(metrics.abandonedSessions).toBe(1);
  });

  it('gives an open session no duration rather than guessing one', () => {
    const open = cleaned(
      snapshot({ sessions: [session('s1', iso(NOW, -1), { status: 'active', endedAt: null })] }),
    );
    expect(computeActivity(open, windowFor('30d'), NOW).medianSessionSeconds).toBeNull();
  });

  it('produces a count trend with real zeroes for quiet days', () => {
    // Unlike retention, a COUNT of zero reviews is a fact, not a gap.
    const metrics = computeActivity(reference, windowFor('7d'), NOW);
    expect(metrics.reviewsPerDay).toHaveLength(7);
    expect(metrics.reviewsPerDay.every((point) => point.value !== null)).toBe(true);
  });

  it('is entirely zero for a learner who has done nothing', () => {
    const metrics = computeActivity(cleaned(snapshot()), windowFor('30d'), NOW);
    expect(metrics).toMatchObject({
      reviews: 0, questionsAnswered: 0, flashcardsReviewed: 0,
      studySeconds: 0, sessions: 0, activeDays: 0,
    });
    expect(metrics.medianSessionSeconds).toBeNull();
  });
});

describe('velocity', () => {
  const reference = cleaned(referenceSnapshot(NOW));

  it('counts first contact, never comprehension', () => {
    // Two structures were reviewed; the third was enrolled and never studied.
    const metrics = computeVelocity(reference, windowFor('30d'), NOW, new Set());
    expect(metrics.structuresEncountered).toBe(2);
    expect(metrics.structuresReachingStrong).toBe(0);
  });

  it('does not credit a structure that reached strength outside the window', () => {
    // Structure A is strong, but nothing in the last 2 days touched structure B.
    const strong = new Set([toId(REFERENCE.structureA), toId(REFERENCE.structureB)]);
    const short = computeVelocity(reference, windowFor('7d'), NOW, strong);
    expect(short.structuresReachingStrong).toBe(2);

    const noneEncountered = computeVelocity(
      cleaned(snapshot()),
      windowFor('7d'),
      NOW,
      strong,
    );
    expect(noneEncountered.structuresReachingStrong).toBe(0);
  });

  it('reports pace when studying, not pace overall', () => {
    const metrics = computeVelocity(reference, windowFor('30d'), NOW, new Set());
    // 15 reviews across 10 active days.
    expect(metrics.reviewsPerActiveDay).toBeCloseTo(1.5, 9);
  });

  it('counts items started inside the window only', () => {
    const metrics = computeVelocity(reference, windowFor('7d'), NOW, new Set());
    // Only structure C's item was created in the last 7 days.
    expect(metrics.itemsStarted).toBe(1);
    expect(computeVelocity(reference, windowFor('30d'), NOW, new Set()).itemsStarted).toBe(3);
  });
});

describe('sessions', () => {
  it('counts items attempted from events, not from a stored counter', () => {
    // The counter is a cache; the events are the record. When they disagree
    // the events win, because they are what actually happened.
    const lying = cleaned(
      snapshot({
        items: [item('i1'), item('i2')],
        sessions: [session('s1', iso(NOW, -1), { itemsPlanned: 5, itemsCompleted: 99 })],
        events: [
          event('e1', 'i1', 'good', iso(NOW, -1, 1), { sessionId: 's1' as never }),
          event('e2', 'i2', 'again', iso(NOW, -1, 2), { sessionId: 's1' as never }),
        ],
      }),
    );

    const [analytics] = computeSessions(lying, windowFor('30d'), NOW);
    expect(analytics!.itemsAttempted).toBe(2);
    expect(analytics!.itemsPlanned).toBe(5);
    expect(analytics!.retention).toBe(0.5);
  });

  it('gives a session with no reviews null rates rather than zero', () => {
    const empty = cleaned(snapshot({ sessions: [session('s1', iso(NOW, -1))] }));
    const [analytics] = computeSessions(empty, windowFor('30d'), NOW);

    expect(analytics!.retention).toBeNull();
    expect(analytics!.accuracy).toBeNull();
    expect(analytics!.averageQuality).toBeNull();
  });

  it('bounds an absurd session duration rather than reporting it', () => {
    const marathon = cleaned(
      snapshot({
        sessions: [
          session('s1', iso(NOW, -2), { endedAt: iso(NOW, -1) }), // 24 hours
        ],
      }),
    );
    const [analytics] = computeSessions(marathon, windowFor('30d'), NOW);
    expect(analytics!.durationSeconds).toBe(6 * 60 * 60);
  });

  it('lists newest first', () => {
    const many = cleaned(
      snapshot({
        sessions: [
          session('old', iso(NOW, -5)),
          session('new', iso(NOW, -1)),
          session('mid', iso(NOW, -3)),
        ],
      }),
    );
    expect(computeSessions(many, windowFor('30d'), NOW).map((s) => s.sessionId)).toEqual([
      'new', 'mid', 'old',
    ]);
  });
});

describe('determinism', () => {
  it('returns identical results for identical inputs', () => {
    const reference = cleaned(referenceSnapshot(NOW));
    const window = windowFor('30d');

    expect(computeRetention(reference, window, NOW)).toEqual(
      computeRetention(reference, window, NOW),
    );
    expect(computeActivity(reference, window, NOW)).toEqual(
      computeActivity(reference, window, NOW),
    );
  });

  it('does not depend on the order events arrive in', () => {
    const raw = referenceSnapshot(NOW);
    const forwards = cleaned(raw);
    const backwards = cleaned({ ...raw, events: [...raw.events].reverse() });

    expect(computeRetention(backwards, windowFor('30d'), NOW)).toEqual(
      computeRetention(forwards, windowFor('30d'), NOW),
    );
  });
});
