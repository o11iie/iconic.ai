import { describe, expect, it } from 'vitest';
import { buildSemanticId, semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import {
  MASTERY,
  aggregateMastery,
  itemMastery,
  retention,
  structureMastery,
  type MasteryNode,
  type ReviewRecord,
} from './mastery';
import type { LearningItem } from './queue';
import { addDays, newReviewState, type ReviewRating, type ReviewState } from './scheduler';

const NOW = new Date('2026-03-15T12:00:00.000Z');

function toId(dotted: string): SemanticId {
  const [namespace, domain, ...path] = dotted.split('.');
  if (namespace !== 'veo' || !domain) throw new Error(`bad test id: ${dotted}`);
  return buildSemanticId(domain, ...path);
}

/** A reviewed item: `repetitions` successes, last seen `agoDays` ago. */
function reviewed(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    ...newReviewState(NOW),
    phase: 'review',
    stability: 30,
    difficulty: 0.3,
    repetitions: 5,
    lapses: 0,
    intervalDays: 3,
    dueAt: addDays(NOW, 3).toISOString(),
    lastReviewedAt: NOW.toISOString(),
    ...overrides,
  };
}

function item(id: string, semantic: string | null, state: ReviewState): LearningItem {
  return {
    id: id as UUID,
    contentId: `content-${id}`,
    contentType: 'question',
    semanticId: semantic ? toId(semantic) : null,
    modelRef: semantic ? 'model-1' : null,
    state,
  };
}

function record(rating: ReviewRating, agoDays: number): ReviewRecord {
  return {
    itemId: 'item-1',
    rating,
    reviewedAt: addDays(NOW, -agoDays).toISOString() as ISODateString,
  };
}

describe('item mastery', () => {
  it('is zero for an item VEO has no evidence about', () => {
    // Not because the learner knows nothing — because nothing has been
    // measured, and 0 is the honest number for "no evidence".
    expect(itemMastery(newReviewState(NOW), NOW)).toBe(0);
  });

  it('is zero for an item with no stability, whatever its phase claims', () => {
    expect(itemMastery(reviewed({ stability: 0 }), NOW)).toBe(0);
    expect(itemMastery(reviewed({ stability: -5 }), NOW)).toBe(0);
  });

  it('is not awarded for activity alone', () => {
    // The central lie this module exists to prevent: forty answers, thirty
    // wrong, is a lot of completion and no mastery.
    const busyButFailing = reviewed({ repetitions: 1, lapses: 12, stability: 0.5 });
    expect(itemMastery(busyButFailing, NOW)).toBeLessThan(MASTERY.strugglingThreshold);
  });

  it('decays on its own between reviews', () => {
    // A dashboard showing 94% for something last seen in March is reporting
    // history, not knowledge.
    const state = reviewed({ stability: 10 });
    const fresh = itemMastery(state, NOW);
    const week = itemMastery(state, addDays(NOW, 7));
    const year = itemMastery(state, addDays(NOW, 365));

    expect(fresh).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(year);
    expect(year).toBeLessThan(0.01);
  });

  it('holds one lucky answer below full mastery', () => {
    const once = itemMastery(reviewed({ repetitions: 1 }), NOW);
    const established = itemMastery(reviewed({ repetitions: MASTERY.fullConfidenceReps }), NOW);

    expect(once).toBeLessThan(established);
    expect(once).toBeLessThanOrEqual(1 / MASTERY.fullConfidenceReps + 1e-9);
  });

  it('stops rewarding repetitions once the evidence is complete', () => {
    const atThreshold = itemMastery(reviewed({ repetitions: MASTERY.fullConfidenceReps }), NOW);
    const farBeyond = itemMastery(reviewed({ repetitions: 400 }), NOW);
    expect(farBeyond).toBeCloseTo(atThreshold, 9);
  });

  it('is cut by lapses but never below the confidence floor', () => {
    const clean = itemMastery(reviewed({ repetitions: 5, lapses: 0 }), NOW);
    const lapsed = itemMastery(reviewed({ repetitions: 5, lapses: 2 }), NOW);
    const disastrous = itemMastery(reviewed({ repetitions: 5, lapses: 99 }), NOW);

    expect(lapsed).toBeLessThan(clean);
    expect(disastrous).toBeGreaterThan(0);
    expect(disastrous).toBeCloseTo(
      itemMastery(reviewed({ repetitions: 5, lapses: 0, stability: 30 }), NOW) *
        MASTERY.minConfidence,
      6,
    );
  });

  it('stays within 0..1 for every plausible and implausible state', () => {
    const states = [
      reviewed(),
      reviewed({ stability: MASTERY.fullConfidenceReps * 1e6, repetitions: 1e6 }),
      reviewed({ stability: Number.NaN }),
      reviewed({ repetitions: Number.NaN }),
      reviewed({ lastReviewedAt: 'not a date' as never }),
      reviewed({ lastReviewedAt: null }),
      reviewed({ phase: 'suspended' }),
    ];
    for (const state of states) {
      const value = itemMastery(state, NOW);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('does not credit a review that has not happened yet', () => {
    // A clock skew must not produce negative elapsed time and inflated recall.
    const future = reviewed({ lastReviewedAt: addDays(NOW, 5).toISOString() });
    expect(itemMastery(future, NOW)).toBeLessThanOrEqual(1);
    expect(itemMastery(future, NOW)).toBeCloseTo(itemMastery(reviewed(), NOW), 9);
  });
});

describe('structure mastery', () => {
  it('averages across a structure\'s items rather than taking the best', () => {
    // Taking the best would let a learner reach 100% by never reviewing the
    // hard card.
    const strong = reviewed({ stability: 100, repetitions: 10 });
    const forgotten = reviewed({ stability: 0.1, repetitions: 1, lapses: 4 });

    const [structure] = structureMastery(
      [item('a', 'veo.anatomy.heart', strong), item('b', 'veo.anatomy.heart', forgotten)],
      NOW,
    );

    expect(structure!.itemCount).toBe(2);
    expect(structure!.mastery).toBeCloseTo(
      (itemMastery(strong, NOW) + itemMastery(forgotten, NOW)) / 2,
      9,
    );
    expect(structure!.mastery).toBeLessThan(itemMastery(strong, NOW));
  });

  it('ignores items that are about no structure', () => {
    expect(structureMastery([item('a', null, reviewed())], NOW)).toEqual([]);
  });

  it('bands an unreviewed structure as untouched, not struggling', () => {
    // "You are struggling with this" about something never shown is false and
    // discouraging.
    const [structure] = structureMastery(
      [item('a', 'veo.chemistry.molecule.benzene', newReviewState(NOW))],
      NOW,
    );
    expect(structure!.band).toBe('untouched');
    expect(structure!.reviewCount).toBe(0);
  });

  it('bands a repeatedly-forgotten structure as struggling', () => {
    const repeatedlyLost = reviewed({
      stability: 200, repetitions: 9, lapses: MASTERY.difficultLapses,
    });
    const [structure] = structureMastery([item('a', 'veo.anatomy.heart', repeatedlyLost)], NOW);
    expect(structure!.band).toBe('struggling');
  });

  it('judges lapses per item, not in total', () => {
    // Regression. `difficultLapses` is a per-item threshold, but a structure's
    // lapse count is the SUM across its items. Compared directly, the band
    // became a function of how much content existed about a structure: twenty
    // well-known items that each lapsed once years ago sum to twenty, and the
    // structure read "struggling" at 0.85 mastery, permanently.
    const recovered = reviewed({ stability: 400, repetitions: 12, lapses: 1 });
    const many = Array.from({ length: 20 }, (_, i) =>
      item(`i${i}`, 'veo.anatomy.heart', recovered),
    );

    const [structure] = structureMastery(many, NOW);

    expect(structure!.lapses).toBe(20);
    expect(structure!.mastery).toBeGreaterThan(MASTERY.strongThreshold);
    expect(structure!.band).toBe('strong');
  });

  it('still flags a structure whose items each lapse repeatedly', () => {
    // The other direction: the rule must not be defanged. Every item lapsing
    // three times is a genuinely difficult structure whatever it scores today.
    const chronic = reviewed({
      stability: 400, repetitions: 12, lapses: MASTERY.difficultLapses,
    });
    const many = Array.from({ length: 20 }, (_, i) =>
      item(`i${i}`, 'veo.anatomy.heart', chronic),
    );

    const [structure] = structureMastery(many, NOW);
    expect(structure!.band).toBe('struggling');
  });

  it('bands strong, developing and struggling by score', () => {
    const bandOf = (state: ReviewState) =>
      structureMastery([item('a', 'veo.anatomy.heart', state)], NOW)[0]!.band;

    expect(bandOf(reviewed({ stability: 500, repetitions: 8 }))).toBe('strong');
    expect(bandOf(reviewed({ stability: 30, repetitions: 2, lastReviewedAt: addDays(NOW, -6).toISOString() })))
      .toBe('developing');
    expect(bandOf(reviewed({ stability: 1, repetitions: 1, lastReviewedAt: addDays(NOW, -3).toISOString() })))
      .toBe('struggling');
  });

  it('counts what is due now, excluding suspended items', () => {
    const [structure] = structureMastery(
      [
        item('a', 'veo.anatomy.heart', reviewed({ dueAt: addDays(NOW, -1).toISOString() })),
        item('b', 'veo.anatomy.heart', reviewed({ dueAt: addDays(NOW, 5).toISOString() })),
        item('c', 'veo.anatomy.heart', reviewed({ phase: 'suspended', dueAt: addDays(NOW, -9).toISOString() })),
      ],
      NOW,
    );
    expect(structure!.dueNow).toBe(1);
  });

  it('reports the most recent review across the structure\'s items', () => {
    const [structure] = structureMastery(
      [
        item('a', 'veo.anatomy.heart', reviewed({ lastReviewedAt: addDays(NOW, -10).toISOString() })),
        item('b', 'veo.anatomy.heart', reviewed({ lastReviewedAt: addDays(NOW, -2).toISOString() })),
      ],
      NOW,
    );
    expect(structure!.lastReviewedAt).toBe(addDays(NOW, -2).toISOString());
  });

  it('sorts weakest first, so the dashboard leads with what needs work', () => {
    const structures = structureMastery(
      [
        item('a', 'veo.anatomy.heart', reviewed({ stability: 500, repetitions: 9 })),
        item('b', 'veo.anatomy.lung', reviewed({ stability: 0.4, repetitions: 1 })),
        item('c', 'veo.anatomy.liver', reviewed({ stability: 20, repetitions: 4 })),
      ],
      NOW,
    );
    const scores = structures.map((s) => s.mastery);
    expect(scores).toEqual([...scores].sort((x, y) => x - y));
    expect(structures[0]!.semanticId).toBe(toId('veo.anatomy.lung'));
  });

  it('is deterministic for structures with identical scores', () => {
    const identical = ['veo.anatomy.zeta', 'veo.anatomy.alpha', 'veo.anatomy.mu'].map((id, i) =>
      item(`i${i}`, id, reviewed()),
    );
    const order = structureMastery(identical, NOW).map((s) => s.semanticId);
    expect(structureMastery([...identical].reverse(), NOW).map((s) => s.semanticId)).toEqual(order);
    expect(order).toEqual([toId('veo.anatomy.alpha'), toId('veo.anatomy.mu'), toId('veo.anatomy.zeta')]);
  });
});

describe('aggregation up the hierarchy', () => {
  const label = (id: SemanticId) => semanticIdToLabel(id);

  function find(nodes: readonly MasteryNode[], id: string): MasteryNode | null {
    for (const node of nodes) {
      if (node.semanticId === toId(id)) return node;
      const inChild = find(node.children, id);
      if (inChild) return inChild;
    }
    return null;
  }

  it('derives the tree from the semantic ids, with nothing hard-coded', () => {
    const tree = aggregateMastery(
      structureMastery(
        [
          item('a', 'veo.anatomy.cardiovascular.heart.left_ventricle', reviewed()),
          item('b', 'veo.anatomy.cardiovascular.heart.right_atrium', reviewed()),
        ],
        NOW,
      ),
      label,
    );

    // The shallowest legal semantic id is `veo.<domain>.<segment>`, so that is
    // where the tree roots — the module does not invent a domain-only node.
    expect(tree.map((node) => node.semanticId)).toEqual([toId('veo.anatomy.cardiovascular')]);
    expect(find(tree, 'veo.anatomy.cardiovascular.heart')).not.toBeNull();
    expect(find(tree, 'veo.anatomy.cardiovascular.heart.left_ventricle')).not.toBeNull();
  });

  it('works identically for a domain that is not anatomy', () => {
    const tree = aggregateMastery(
      structureMastery(
        [
          item('a', 'veo.chemistry.organic.aromatic.benzene', reviewed({ stability: 500, repetitions: 9 })),
          item('b', 'veo.chemistry.organic.aromatic.toluene', reviewed({ stability: 0.2, repetitions: 1 })),
        ],
        NOW,
      ),
      label,
    );

    const aromatic = find(tree, 'veo.chemistry.organic.aromatic');
    expect(aromatic).not.toBeNull();
    expect(aromatic!.itemCount).toBe(2);
    expect(aromatic!.mastery).toBeGreaterThan(0);
    expect(aromatic!.mastery).toBeLessThan(1);
  });

  it('weights a parent by item count, not by child count', () => {
    // A system with one well-known structure and one barely-touched structure
    // carrying twenty items should read closer to the twenty.
    const strong = reviewed({ stability: 500, repetitions: 9 });
    const weak = reviewed({ stability: 0.2, repetitions: 1, lapses: 2 });

    const items = [
      item('s0', 'veo.physics.mechanics.lever', strong),
      ...Array.from({ length: 20 }, (_, i) => item(`w${i}`, 'veo.physics.mechanics.pulley', weak)),
    ];

    const tree = aggregateMastery(structureMastery(items, NOW), label);
    const mechanics = find(tree, 'veo.physics.mechanics')!;

    const strongScore = itemMastery(strong, NOW);
    const weakScore = itemMastery(weak, NOW);

    expect(mechanics.itemCount).toBe(21);
    // The exact weighted mean, not an approximate bound.
    expect(mechanics.mastery).toBeCloseTo((strongScore + weakScore * 20) / 21, 9);
    // A mean of means would sit at the midpoint of the two structures; the
    // weighted figure must sit far below it, near the twenty weak items.
    expect(mechanics.mastery).toBeLessThan((strongScore + weakScore) / 2);
    expect(mechanics.mastery).toBeLessThan(weakScore * 1.2);
  });

  it('takes labels from the caller, never from a scene of its own', () => {
    const tree = aggregateMastery(
      structureMastery([item('a', 'veo.anatomy.heart.left_ventricle', reviewed())], NOW),
      () => 'INJECTED',
    );
    expect(tree[0]!.label).toBe('INJECTED');
  });

  it('stops at the requested depth', () => {
    const tree = aggregateMastery(
      structureMastery([item('a', 'veo.anatomy.cardiovascular.heart.left_ventricle', reviewed())], NOW),
      label,
      { maxDepth: 2 },
    );
    expect(tree[0]!.children[0]!.children).toEqual([]);
  });

  it('returns nothing for a learner with no structures', () => {
    expect(aggregateMastery([], label)).toEqual([]);
  });

  it('keeps sibling domains separate', () => {
    const tree = aggregateMastery(
      structureMastery(
        [
          item('a', 'veo.anatomy.heart', reviewed({ stability: 500, repetitions: 9 })),
          item('b', 'veo.astrophysics.star', reviewed({ stability: 0.2, repetitions: 1 })),
        ],
        NOW,
      ),
      label,
    );

    expect(tree).toHaveLength(2);
    expect(find(tree, 'veo.anatomy.heart')!.mastery).toBeGreaterThan(
      find(tree, 'veo.astrophysics.star')!.mastery,
    );
  });
});

describe('retention', () => {
  it('is null, not zero, for an account with no reviews', () => {
    // "0% retention" on a new account is a lie in the discouraging direction;
    // "100%" is a lie in the other.
    expect(retention([])).toEqual({
      overall: null, recent: null, totalReviews: 0, recentReviews: 0,
    });
  });

  it('measures the share of reviews the learner actually recalled', () => {
    const summary = retention([
      record('good', 5), record('easy', 4), record('hard', 3), record('again', 2),
    ]);
    expect(summary.overall).toBeCloseTo(0.75, 9);
    expect(summary.totalReviews).toBe(4);
  });

  it('counts `hard` as recall and only `again` as failure', () => {
    expect(retention([record('hard', 1)]).overall).toBe(1);
    expect(retention([record('again', 1)]).overall).toBe(0);
  });

  it('reports recent retention over the most recent reviews only', () => {
    // Twenty old failures, then five recent successes: the recent window must
    // show the improvement rather than burying it.
    const records = [
      ...Array.from({ length: 20 }, (_, i) => record('again', 30 - i)),
      ...Array.from({ length: 5 }, (_, i) => record('good', 5 - i)),
    ];
    const summary = retention(records, 5);

    expect(summary.overall).toBeCloseTo(5 / 25, 9);
    expect(summary.recent).toBe(1);
    expect(summary.recentReviews).toBe(5);
  });

  it('orders by review time, not by array order', () => {
    const records = [record('good', 1), record('again', 10), record('good', 5)];
    const summary = retention([...records].reverse(), 1);
    // The most recent single review is the one from a day ago: a success.
    expect(summary.recent).toBe(1);
    expect(summary.overall).toBeCloseTo(2 / 3, 9);
  });

  it('does not mutate the records it was given', () => {
    const records = [record('again', 3), record('good', 9), record('hard', 1)];
    const snapshot = structuredClone(records);
    retention(records);
    expect(records).toEqual(snapshot);
  });

  it('falls back to the whole history when it is shorter than the window', () => {
    const summary = retention([record('good', 2), record('again', 1)], 50);
    expect(summary.recentReviews).toBe(2);
    expect(summary.recent).toBe(summary.overall);
  });
});
