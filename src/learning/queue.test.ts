import { describe, expect, it } from 'vitest';
import { buildSemanticId } from '@/lib/semantic-id';
import type { UUID } from '@/types/domain/primitives';
import {
  DEFAULT_QUEUE_LIMITS,
  QUEUE_BUCKETS,
  buildQueue,
  classify,
  countQueue,
  isActivePhase,
  nextDueAt,
  upcomingWithin,
  type LearningItem,
  type QueueBucket,
} from './queue';
import { addDays, newReviewState, type ReviewPhase, type ReviewState } from './scheduler';

const NOW = new Date('2026-03-15T12:00:00.000Z');

/** 'veo.chemistry.molecule.benzene' -> a validated SemanticId. */
function toId(dotted: string) {
  const [namespace, domain, ...path] = dotted.split('.');
  if (namespace !== 'veo' || !domain) throw new Error(`bad test id: ${dotted}`);
  return buildSemanticId(domain, ...path);
}

function item(
  id: string,
  overrides: Partial<ReviewState> = {},
  semantic: string | null = null,
): LearningItem {
  return {
    id: id as UUID,
    contentId: `content-${id}`,
    contentType: 'question',
    semanticId: semantic ? toId(semantic) : null,
    modelRef: null,
    state: { ...newReviewState(NOW), ...overrides },
  };
}

/** An item in `review` phase, due `daysAgo` days ago (negative = future). */
function due(id: string, daysAgo: number, overrides: Partial<ReviewState> = {}): LearningItem {
  return item(id, {
    phase: 'review',
    stability: 10,
    repetitions: 3,
    intervalDays: 5,
    dueAt: addDays(NOW, -daysAgo).toISOString(),
    lastReviewedAt: addDays(NOW, -daysAgo - 5).toISOString(),
    ...overrides,
  });
}

describe('classification', () => {
  it('puts an unseen item in `new`', () => {
    expect(classify(item('a'), NOW).bucket).toBe('new');
  });

  it('separates due from overdue with a day of grace', () => {
    // An evening learner should not be told they are behind every morning.
    expect(classify(due('a', 0.5), NOW).bucket).toBe('due');
    expect(classify(due('b', 0.99), NOW).bucket).toBe('due');
    expect(classify(due('c', 1.01), NOW).bucket).toBe('overdue');
  });

  it('treats an item due in the future as upcoming', () => {
    const queued = classify(due('a', -3), NOW);
    expect(queued.bucket).toBe('upcoming');
    expect(queued.overdueDays).toBeCloseTo(-3, 6);
  });

  it('treats learning and relearning as urgent once their step has passed', () => {
    for (const phase of ['learning', 'relearning'] as const) {
      expect(classify(item('a', { phase, dueAt: addDays(NOW, -0.001).toISOString() }), NOW).bucket)
        .toBe('learning');
      expect(classify(item('b', { phase, dueAt: addDays(NOW, 0.5).toISOString() }), NOW).bucket)
        .toBe('upcoming');
    }
  });

  it('keeps suspended items out of every other bucket', () => {
    const suspended = item('a', { phase: 'suspended', dueAt: addDays(NOW, -100).toISOString() });
    expect(classify(suspended, NOW).bucket).toBe('suspended');
    expect(classify(suspended, NOW).overdueDays).toBe(0);
  });

  it('does not crash on an unparseable due date', () => {
    const broken = item('a', { phase: 'review', dueAt: 'not a date' as never });
    const queued = classify(broken, NOW);
    expect(QUEUE_BUCKETS).toContain(queued.bucket);
    expect(Number.isFinite(queued.overdueDays)).toBe(true);
  });

  it('names the active phases', () => {
    const active = (['new', 'learning', 'review', 'relearning', 'suspended'] as ReviewPhase[])
      .filter(isActivePhase);
    expect(active).toEqual(['learning', 'relearning']);
  });
});

describe('counting', () => {
  it('counts each bucket and totals only what can be reviewed now', () => {
    const counts = countQueue(
      [
        due('a', 5), due('b', 3),                       // overdue
        due('c', 0.5),                                   // due
        item('d', { phase: 'learning', dueAt: addDays(NOW, -0.01).toISOString() }),
        item('e'), item('f'),                            // new
        due('g', -2),                                    // upcoming
        item('h', { phase: 'suspended' }),               // suspended
      ],
      NOW,
    );

    expect(counts).toEqual({
      overdue: 2, due: 1, learning: 1, new: 2, upcoming: 1, suspended: 1,
      actionable: 6,
    });
  });

  it('reports honest zeroes for a learner with nothing', () => {
    // A new account must never be shown invented numbers.
    const counts = countQueue([], NOW);
    expect(counts.actionable).toBe(0);
    for (const bucket of QUEUE_BUCKETS) expect(counts[bucket]).toBe(0);
  });
});

describe('queue order', () => {
  it('puts learning first, then overdue, then due, then new', () => {
    const queue = buildQueue(
      [
        item('new-1'),
        due('due-1', 0.2),
        due('overdue-1', 9),
        item('learn-1', { phase: 'learning', dueAt: addDays(NOW, -0.01).toISOString() }),
      ],
      NOW,
    );

    expect(queue.map((q) => q.bucket)).toEqual(['learning', 'overdue', 'due', 'new']);
  });

  it('holds new items back behind the backlog', () => {
    // The starvation that actually happens: a learner who keeps generating
    // content spends every session on new material while what they half-know
    // rots behind it.
    const queue = buildQueue(
      [item('new-a'), item('new-b'), due('old', 4)],
      NOW,
    );
    expect(queue[0]!.item.id).toBe('old');
  });

  it('orders the most overdue first within a bucket', () => {
    const queue = buildQueue([due('a', 2), due('b', 30), due('c', 7)], NOW);
    expect(queue.map((q) => q.item.id)).toEqual(['b', 'c', 'a']);
  });

  it('is a total order: identical schedules still order deterministically', () => {
    // Without a final tie-break on a unique value the queue is not
    // reproducible, and a learner who refreshes loses their place.
    const identical = ['z', 'm', 'a'].map((id) => due(id, 3));
    const first = buildQueue(identical, NOW).map((q) => q.item.id);
    const reversed = buildQueue([...identical].reverse(), NOW).map((q) => q.item.id);

    expect(first).toEqual(['a', 'm', 'z']);
    expect(reversed).toEqual(first);
  });

  it('returns the same queue for the same inputs, every time', () => {
    const items = [due('a', 1), item('b'), due('c', 12), item('d', { phase: 'learning' })];
    const runs = Array.from({ length: 5 }, () => buildQueue(items, NOW).map((q) => q.item.id));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });

  it('excludes upcoming and suspended items entirely', () => {
    const queue = buildQueue(
      [due('future', -5), item('off', { phase: 'suspended' }), due('now', 1)],
      NOW,
    );
    expect(queue.map((q) => q.item.id)).toEqual(['now']);
  });

  it('drops duplicate ids, so one item cannot be answered twice', () => {
    const queue = buildQueue([due('a', 2), due('a', 9), due('b', 1)], NOW);
    expect(queue.filter((q) => q.item.id === 'a')).toHaveLength(1);
    expect(queue).toHaveLength(2);
  });
});

describe('session limits', () => {
  it('caps new items so tomorrow stays survivable', () => {
    const many = Array.from({ length: 50 }, (_, i) => item(`new-${String(i).padStart(3, '0')}`));
    const queue = buildQueue(many, NOW);

    expect(queue).toHaveLength(DEFAULT_QUEUE_LIMITS.maxNewPerSession);
    expect(queue.every((q) => q.bucket === 'new')).toBe(true);
  });

  it('caps reviews independently of new work', () => {
    const reviews = Array.from({ length: 100 }, (_, i) => due(`r-${String(i).padStart(3, '0')}`, 2));
    const news = Array.from({ length: 20 }, (_, i) => item(`n-${String(i).padStart(3, '0')}`));

    const queue = buildQueue([...reviews, ...news], NOW, {
      maxNewPerSession: 5,
      maxReviewsPerSession: 7,
      maxSessionSize: 100,
    });

    expect(queue.filter((q) => q.bucket === 'new')).toHaveLength(5);
    expect(queue.filter((q) => q.bucket !== 'new')).toHaveLength(7);
  });

  it('never exceeds the overall session size', () => {
    const items = [
      ...Array.from({ length: 40 }, (_, i) => due(`r-${String(i).padStart(3, '0')}`, 3)),
      ...Array.from({ length: 40 }, (_, i) => item(`n-${String(i).padStart(3, '0')}`)),
    ];
    const queue = buildQueue(items, NOW, {
      maxNewPerSession: 30, maxReviewsPerSession: 30, maxSessionSize: 12,
    });
    expect(queue).toHaveLength(12);
  });

  it('spends the session on the backlog before new material when both are capped', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => due(`r-${i}`, 5)),
      ...Array.from({ length: 10 }, (_, i) => item(`n-${i}`)),
    ];
    const queue = buildQueue(items, NOW, {
      maxNewPerSession: 10, maxReviewsPerSession: 10, maxSessionSize: 10,
    });
    expect(queue.every((q) => q.bucket === 'overdue')).toBe(true);
  });
});

describe('looking ahead', () => {
  it('lists only what comes due inside the horizon, soonest first', () => {
    const upcoming = upcomingWithin(
      [due('tomorrow', -1), due('next-week', -7), due('next-month', -30), due('now', 0)],
      NOW,
      8,
    );
    expect(upcoming.map((q) => q.item.id)).toEqual(['tomorrow', 'next-week']);
  });

  it('reports the next due date, ignoring suspended items', () => {
    expect(
      nextDueAt([due('a', -3), item('b', { phase: 'suspended', dueAt: addDays(NOW, 1).toISOString() })], NOW),
    ).toBe(addDays(NOW, 3).toISOString());
  });

  it('returns null when nothing is scheduled ahead', () => {
    // "Caught up" is a real state and must be representable, not faked with a
    // far-future date.
    expect(nextDueAt([due('a', 2)], NOW)).toBeNull();
    expect(nextDueAt([], NOW)).toBeNull();
  });
});

describe('domain neutrality', () => {
  it('queues items from any domain, with no anatomy anywhere', () => {
    const mixed = [
      item('anat', { phase: 'review', dueAt: addDays(NOW, -2).toISOString() }, 'veo.anatomy.heart.left_ventricle'),
      item('chem', { phase: 'review', dueAt: addDays(NOW, -3).toISOString() }, 'veo.chemistry.molecule.benzene'),
      item('astro', { phase: 'review', dueAt: addDays(NOW, -4).toISOString() }, 'veo.astrophysics.star.main_sequence'),
      item('eng', { phase: 'review', dueAt: addDays(NOW, -5).toISOString() }, 'veo.engineering.engine.crankshaft'),
    ];

    const queue = buildQueue(mixed, NOW);
    expect(queue).toHaveLength(4);
    // Ordered purely by how overdue they are — the domain is not consulted.
    expect(queue.map((q) => q.item.id)).toEqual(['eng', 'astro', 'chem', 'anat']);
  });

  it('queues an item that is about no structure at all', () => {
    const queue = buildQueue([item('abstract', { phase: 'review', dueAt: addDays(NOW, -1).toISOString() })], NOW);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.item.semanticId).toBeNull();
  });
});

describe('purity', () => {
  it('does not mutate or reorder the caller\'s array', () => {
    const items = [due('c', 1), due('a', 5), due('b', 3)];
    const snapshot = items.map((i) => i.id);
    buildQueue(items, NOW);
    countQueue(items, NOW);
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });

  it('classifies every bucket name that exists', () => {
    // Guards against a bucket being added to the union but never produced —
    // a dashboard column that can only ever render zero.
    const produced = new Set<QueueBucket>([
      classify(due('a', 5), NOW).bucket,
      classify(due('b', 0.2), NOW).bucket,
      classify(item('c', { phase: 'learning', dueAt: addDays(NOW, -0.01).toISOString() }), NOW).bucket,
      classify(item('d'), NOW).bucket,
      classify(due('e', -5), NOW).bucket,
      classify(item('f', { phase: 'suspended' }), NOW).bucket,
    ]);
    expect([...produced].sort()).toEqual([...QUEUE_BUCKETS].sort());
  });
});
