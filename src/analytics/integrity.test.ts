import { describe, expect, it } from 'vitest';
import {
  EARLIEST_PLAUSIBLE_MS,
  FUTURE_TOLERANCE_MS,
  MAX_REVIEW_SECONDS,
  clean,
  usableInstant,
} from './integrity';
import { computeActivity, computeRecall, computeRetention } from './metrics';
import { resolveWindow } from './periods';
import { event, item, iso, snapshot } from './fixtures';

/**
 * Data integrity.
 *
 * The rule under test: an impossible record is EXCLUDED and COUNTED, never
 * coerced into a statistic. A review dated in the year 3000 is not evidence of
 * anything, and turning it into a data point makes a number wrong in a way
 * nobody can trace back.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');
const WINDOW = resolveWindow('all', NOW, 'UTC');

describe('usable instants', () => {
  it('accepts a normal timestamp', () => {
    expect(usableInstant(iso(NOW, -1), NOW)).toBeTypeOf('number');
  });

  it('refuses an unparseable one', () => {
    for (const rubbish of ['', 'yesterday', 'not a date', '2026-13-45T99:99:99Z']) {
      expect(usableInstant(rubbish, NOW)).toBeNull();
    }
  });

  it('refuses epoch zero, which is a leaked default rather than a date', () => {
    // Left in, it anchors every trend to 1970 and makes every window look empty.
    expect(usableInstant(new Date(0).toISOString(), NOW)).toBeNull();
    expect(EARLIEST_PLAUSIBLE_MS).toBeGreaterThan(0);
  });

  it('tolerates small clock skew but refuses a future date', () => {
    const skewed = new Date(NOW.getTime() + FUTURE_TOLERANCE_MS - 1000).toISOString();
    expect(usableInstant(skewed, NOW)).toBeTypeOf('number');

    const future = new Date(NOW.getTime() + FUTURE_TOLERANCE_MS + 60_000).toISOString();
    expect(usableInstant(future, NOW)).toBeNull();
  });
});

describe('cleaning a snapshot', () => {
  it('passes a healthy snapshot through untouched', () => {
    const raw = snapshot({
      items: [item('i1')],
      events: [event('e1', 'i1', 'good', iso(NOW, -1))],
    });
    const result = clean(raw, NOW);

    expect(result.items).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.integrity).toMatchObject({
      reviewsExcluded: 0, itemsExcluded: 0, sessionsExcluded: 0,
    });
  });

  it('excludes a review with an impossible timestamp, and says so', () => {
    const raw = snapshot({
      items: [item('i1')],
      events: [
        event('e1', 'i1', 'good', iso(NOW, -1)),
        event('e2', 'i1', 'good', 'not a date' as never),
        event('e3', 'i1', 'good', iso(NOW, 400)),
      ],
    });
    const result = clean(raw, NOW);

    expect(result.events).toHaveLength(1);
    expect(result.integrity.reviewsExcluded).toBe(2);
    expect(result.integrity.reasons.invalid_timestamp).toBe(1);
    expect(result.integrity.reasons.future_timestamp).toBe(1);
  });

  it('excludes a review whose rating VEO does not define', () => {
    const raw = snapshot({
      items: [item('i1')],
      events: [event('e1', 'i1', 'brilliant' as never, iso(NOW, -1))],
    });
    const result = clean(raw, NOW);

    expect(result.events).toEqual([]);
    expect(result.integrity.reasons.invalid_rating).toBe(1);
  });

  it('excludes an orphaned review rather than attributing it to nothing', () => {
    const raw = snapshot({
      items: [item('i1')],
      events: [event('e1', 'ghost-item', 'good', iso(NOW, -1))],
    });
    const result = clean(raw, NOW);

    expect(result.events).toEqual([]);
    expect(result.integrity.reasons.unknown_item).toBe(1);
  });

  it('excludes a duplicate event id, because Gate 12 makes that impossible', () => {
    // Seeing one means a real defect upstream, so it is counted rather than
    // quietly deduplicated.
    const raw = snapshot({
      items: [item('i1')],
      events: [
        event('same', 'i1', 'good', iso(NOW, -2)),
        event('same', 'i1', 'again', iso(NOW, -1)),
      ],
    });
    const result = clean(raw, NOW);

    expect(result.events).toHaveLength(1);
    expect(result.integrity.reasons.duplicate_event).toBe(1);
  });

  it('clamps an absurd duration rather than discarding the review', () => {
    // The learner did answer it. Dropping the event would understate their
    // reviews as well as their time.
    const raw = snapshot({
      items: [item('i1')],
      events: [event('e1', 'i1', 'good', iso(NOW, -1), { responseMs: 9_000_000 })],
    });
    const result = clean(raw, NOW);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.responseMs).toBe(MAX_REVIEW_SECONDS * 1000);
    expect(result.integrity.reasons.invalid_duration).toBe(1);
  });

  it('excludes an item whose state is not arithmetic', () => {
    // One NaN produces a NaN mastery, which renders as "NaN%" and poisons
    // every aggregate it is averaged into.
    const raw = snapshot({
      items: [
        item('good'),
        item('nan', { stability: Number.NaN }),
        item('negative', { repetitions: -5 }),
        item('phase', { phase: 'nonsense' as never }),
      ],
    });
    const result = clean(raw, NOW);

    expect(result.items.map((i) => i.id)).toEqual(['good']);
    expect(result.integrity.itemsExcluded).toBe(3);
  });

  it('keeps an item with a stale semantic id, but drops the id', () => {
    // The schedule is still valid and the item still counts toward reviews.
    // It simply cannot be placed in the knowledge map.
    const raw = snapshot({ items: [item('i1', { semanticId: 'garbage' as never })] });
    const result = clean(raw, NOW);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.semanticId).toBeNull();
    expect(result.integrity.reasons.invalid_semantic_id).toBe(1);
  });

  it('excludes a session that ended before it started', () => {
    const raw = snapshot({
      sessions: [
        {
          id: 'backwards' as never,
          status: 'completed',
          startedAt: iso(NOW, -1),
          endedAt: iso(NOW, -2),
          itemsPlanned: 3,
          itemsCompleted: 3,
        },
      ],
    });
    const result = clean(raw, NOW);

    expect(result.sessions).toEqual([]);
    expect(result.integrity.sessionsExcluded).toBe(1);
  });

  it('keeps an open session, which is legitimate', () => {
    const raw = snapshot({
      sessions: [
        {
          id: 'open' as never,
          status: 'active',
          startedAt: iso(NOW, -1),
          endedAt: null,
          itemsPlanned: 3,
          itemsCompleted: 1,
        },
      ],
    });
    expect(clean(raw, NOW).sessions).toHaveLength(1);
  });

  it('excludes a malformed activity row', () => {
    const raw = snapshot({
      days: [
        { date: '2026-06-14', reviewsCompleted: 3, secondsStudied: 100 },
        { date: 'whenever', reviewsCompleted: 3, secondsStudied: 100 },
        { date: '2026-06-13', reviewsCompleted: Number.NaN, secondsStudied: 100 },
      ],
    });
    const result = clean(raw, NOW);

    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.date).toBe('2026-06-14');
  });

  it('orders events oldest first, whatever order they arrived in', () => {
    const raw = snapshot({
      items: [item('i1')],
      events: [
        event('e3', 'i1', 'good', iso(NOW, -1)),
        event('e1', 'i1', 'good', iso(NOW, -3)),
        event('e2', 'i1', 'good', iso(NOW, -2)),
      ],
    });
    expect(clean(raw, NOW).events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('invalid records never become statistics', () => {
  it('a corrupt review does not move retention', () => {
    // The central guarantee. Four real reviews, three recalled: 75%. Adding
    // junk must leave that untouched, not drag it to 60%.
    const healthy = snapshot({
      items: [item('i1')],
      events: [
        event('e1', 'i1', 'good', iso(NOW, -4)),
        event('e2', 'i1', 'good', iso(NOW, -3)),
        event('e3', 'i1', 'again', iso(NOW, -2)),
        event('e4', 'i1', 'good', iso(NOW, -1)),
      ],
    });

    const poisoned = snapshot({
      ...healthy,
      events: [
        ...healthy.events,
        event('bad1', 'i1', 'again', 'not a date' as never),
        event('bad2', 'ghost', 'again', iso(NOW, -1)),
        event('bad3', 'i1', 'terrible' as never, iso(NOW, -1)),
      ],
    });

    const clean1 = computeRetention(clean(healthy, NOW), WINDOW, NOW);
    const clean2 = computeRetention(clean(poisoned, NOW), WINDOW, NOW);

    expect(clean1.overall).toBe(0.75);
    expect(clean2.overall).toBe(0.75);
    expect(clean2.totalReviews).toBe(4);
  });

  it('a NaN item state does not produce a NaN mastery', () => {
    const poisoned = snapshot({
      items: [item('ok'), item('bad', { stability: Number.NaN, difficulty: Number.NaN })],
      events: [event('e1', 'ok', 'good', iso(NOW, -1))],
    });

    const metrics = computeRecall(clean(poisoned, NOW), WINDOW, NOW);
    expect(Number.isFinite(metrics.averageQuality ?? 0)).toBe(true);
  });

  it('a clamped duration cannot dominate a week of study time', () => {
    const poisoned = snapshot({
      items: [item('i1')],
      events: [
        event('e1', 'i1', 'good', iso(NOW, -1), { responseMs: 5000 }),
        event('e2', 'i1', 'good', iso(NOW, -1), { responseMs: 99_999_999 }),
      ],
    });

    const activity = computeActivity(clean(poisoned, NOW), WINDOW, NOW);
    expect(activity.studySeconds).toBe(5 + MAX_REVIEW_SECONDS);
  });

  it('reports every exclusion so a real data problem stays visible', () => {
    const poisoned = snapshot({
      items: [item('i1'), item('bad', { stability: Number.NaN })],
      events: [
        event('e1', 'i1', 'good', iso(NOW, -1)),
        event('e2', 'ghost', 'good', iso(NOW, -1)),
      ],
    });
    const result = clean(poisoned, NOW);

    expect(result.integrity.itemsExcluded).toBe(1);
    expect(result.integrity.reviewsExcluded).toBe(1);
    expect(Object.keys(result.integrity.reasons).length).toBeGreaterThan(0);
  });
});
