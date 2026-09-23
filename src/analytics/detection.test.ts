import { describe, expect, it } from 'vitest';
import type { ReviewRating } from '@/learning/scheduler';
import { DETECTION, detectDecay, detectStrengths, detectWeakAreas, gatherEvidence } from './detection';
import { RECOMMENDATION, buildRecommendations } from './recommendations';
import { structureViews } from './mastery';
import { clean } from './integrity';
import { resolveWindow } from './periods';
import { event, item, iso, snapshot, toId } from './fixtures';

/**
 * Detection and recommendations.
 *
 * Every classification VEO makes here is a claim about a learner, so these
 * tests attack the claim from both sides: does the rule fire when the evidence
 * is there, and — more importantly — does it stay silent when it is not.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');
const WINDOW = resolveWindow('all', NOW, 'UTC');
const STRUCT = 'veo.diagnostic.analytics_fixture.system_a.core_unit';
const OTHER = 'veo.diagnostic.analytics_fixture.system_a.edge_unit';

/** A structure with a given rating history, one review per day backwards. */
function withHistory(
  ratings: readonly ReviewRating[],
  itemOverrides: Parameters<typeof item>[1] = {},
  semantic = STRUCT,
) {
  const raw = snapshot({
    items: [
      item('i1', {
        semanticId: toId(semantic),
        modelRef: 'model-1',
        repetitions: ratings.filter((r) => r !== 'again').length,
        lapses: ratings.filter((r) => r === 'again').length,
        // Not yet due by default. The shared `item()` builder's due date sits
        // in the past, which would make every structure here incidentally
        // "long overdue" and fire a reason no test asked for.
        dueAt: iso(NOW, 5),
        ...itemOverrides,
      }),
    ],
    events: ratings.map((rating, index) =>
      event(`e${index}`, 'i1', rating, iso(NOW, -(ratings.length - index))),
    ),
  });

  const cleaned = clean(raw, NOW);
  const views = structureViews(cleaned, NOW);
  return { cleaned, views, evidence: gatherEvidence(cleaned, views, WINDOW, NOW) };
}

const ok = (n: number): ReviewRating[] => Array.from({ length: n }, () => 'good');
const bad = (n: number): ReviewRating[] => Array.from({ length: n }, () => 'again');

describe('weak-area detection', () => {
  it('says nothing from a single bad answer', () => {
    // The most important negative case. Telling a learner they are weak at
    // something because of one review is wrong in the way most likely to
    // discourage them.
    const { evidence } = withHistory(['again']);
    expect(detectWeakAreas(evidence)).toEqual([]);
  });

  it('stays silent below the minimum sample, however bad the reviews', () => {
    const { evidence } = withHistory(bad(DETECTION.minReviewsForClassification - 1));
    expect(detectWeakAreas(evidence)).toEqual([]);
  });

  it('flags repeated failures once there is enough evidence', () => {
    const { evidence } = withHistory([...bad(4), ...ok(2)]);
    const [flagged] = detectWeakAreas(evidence);

    expect(flagged).toBeDefined();
    expect(flagged!.reasons).toContain('repeated_failures');
    expect(flagged!.evidence.reviews).toBe(6);
    expect(flagged!.evidence.retention).toBeCloseTo(2 / 6, 9);
  });

  it('flags a high lapse rate', () => {
    const { evidence } = withHistory(ok(6), { lapses: 5, repetitions: 6 });
    const [flagged] = detectWeakAreas(evidence);
    expect(flagged!.reasons).toContain('high_lapse_rate');
  });

  it('flags a long-overdue structure even with little review history', () => {
    // Being forgotten about IS the finding; it needs no performance evidence.
    const { evidence } = withHistory(['good'], {
      dueAt: iso(NOW, -(DETECTION.longOverdueDays + 5)),
    });
    const [flagged] = detectWeakAreas(evidence);

    expect(flagged).toBeDefined();
    expect(flagged!.reasons).toContain('long_overdue');
    expect(flagged!.evidence.overdueDays).toBeGreaterThan(DETECTION.longOverdueDays);
  });

  it('flags a decline only when both halves carry enough reviews', () => {
    const tooFew = withHistory([...ok(2), ...bad(2)]);
    const decline = detectWeakAreas(tooFew.evidence).find((entry) =>
      entry.reasons.includes('declining_recall'),
    );
    expect(decline).toBeUndefined();

    const enough = withHistory([...ok(4), ...bad(4)]);
    const flagged = detectWeakAreas(enough.evidence)[0];
    expect(flagged!.reasons).toContain('declining_recall');
  });

  it('does not flag a structure that is going well', () => {
    const { evidence } = withHistory(ok(10), { lapses: 0, repetitions: 10 });
    expect(detectWeakAreas(evidence)).toEqual([]);
  });

  it('does not flag an improving structure as declining', () => {
    const { evidence } = withHistory([...bad(4), ...ok(4)]);
    const flagged = detectWeakAreas(evidence)[0];
    expect(flagged?.reasons ?? []).not.toContain('declining_recall');
  });

  it('carries evidence that explains the flag', () => {
    const { evidence } = withHistory([...bad(3), ...ok(3)], { lapses: 3, repetitions: 3 });
    const [flagged] = detectWeakAreas(evidence);

    // Every number a learner would be shown is reproducible from their events.
    expect(flagged!.evidence).toMatchObject({
      reviews: 6,
      lapses: 3,
      itemCount: 1,
    });
    expect(flagged!.evidence.retention).toBeCloseTo(0.5, 9);
    expect(flagged!.reasons.length).toBeGreaterThan(0);
  });

  it('orders the worst first', () => {
    const raw = snapshot({
      items: [
        item('mild', { semanticId: toId(STRUCT), repetitions: 3, lapses: 1 }),
        item('severe', { semanticId: toId(OTHER), repetitions: 0, lapses: 6, stability: 0.4 }),
      ],
      events: [
        ...ok(3).map((r, i) => event(`m${i}`, 'mild', r, iso(NOW, -(5 - i)))),
        ...bad(3).map((r, i) => event(`m2${i}`, 'mild', r, iso(NOW, -(9 - i)))),
        ...bad(8).map((r, i) => event(`s${i}`, 'severe', r, iso(NOW, -(10 - i)))),
      ],
    });
    const cleaned = clean(raw, NOW);
    const views = structureViews(cleaned, NOW);
    const flagged = detectWeakAreas(gatherEvidence(cleaned, views, WINDOW, NOW));

    expect(flagged[0]!.semanticId).toBe(toId(OTHER));
    expect(flagged[0]!.severity).toBeGreaterThan(flagged[1]!.severity);
  });
});

describe('strong-area detection', () => {
  /**
   * A state whose mastery and retention CLEAR every strength bar, so the only
   * thing that can disqualify it is the rule under test.
   *
   * This matters more than it looks. An earlier version of these tests fed
   * `ok(DETECTION.minReviewsForStrength - 1)` — deriving the input from the
   * very constant being tested, so mutating the constant moved the test with
   * it and the check could never fail. And with low repetitions, mastery fell
   * below the bar anyway, so the review-count rule was never what rejected
   * the structure. Both tests passed for reasons unrelated to their names.
   */
  const CLEARS_EVERY_BAR = {
    repetitions: 10, lapses: 0, stability: 400, lastReviewedAt: iso(NOW, -1),
  } as const;

  it('says nothing from one good answer', () => {
    const { evidence } = withHistory(['good'], CLEARS_EVERY_BAR);
    expect(detectStrengths(evidence)).toEqual([]);
  });

  it('requires enough reviews, even when everything else is excellent', () => {
    // Four reviews, all recalled, high mastery, no lapses — rejected purely
    // on sample size. Literals, so a change to the threshold breaks this.
    const four = withHistory(ok(4), CLEARS_EVERY_BAR);
    expect(detectStrengths(four.evidence)).toEqual([]);

    const five = withHistory(ok(5), CLEARS_EVERY_BAR);
    expect(detectStrengths(five.evidence)).toHaveLength(1);
  });

  it('refuses a strength when lapses undercut it, at mastery that would qualify', () => {
    // One lapse on a single item is above the per-item bar, but leaves mastery
    // at ~0.85 and retention at 0.875 — both above their thresholds. So the
    // lapse rule is the ONLY thing that can reject this.
    const { evidence } = withHistory([...ok(7), 'again'], {
      repetitions: 10, lapses: 1, stability: 400, lastReviewedAt: iso(NOW, -1),
    });

    const [structure] = [...evidence.values()];
    expect(structure!.mastery).toBeGreaterThanOrEqual(DETECTION.strongMastery);
    expect(structure!.retention!).toBeGreaterThanOrEqual(DETECTION.strongRetention);
    expect(structure!.lapses / structure!.itemCount).toBeGreaterThan(
      DETECTION.strongLapsesPerItem,
    );

    expect(detectStrengths(evidence)).toEqual([]);
  });

  it('refuses a strength when retention is below the bar', () => {
    const { evidence } = withHistory([...ok(6), ...bad(3)], {
      repetitions: 10, lapses: 0, stability: 400, lastReviewedAt: iso(NOW, -1),
    });
    expect(detectStrengths(evidence)).toEqual([]);
  });

  it('reports the run of successes behind the claim', () => {
    const { evidence } = withHistory(ok(8), {
      repetitions: 10, lapses: 0, stability: 400, lastReviewedAt: iso(NOW, -1),
    });
    const [strength] = detectStrengths(evidence);

    expect(strength!.consecutiveSuccesses).toBe(8);
    expect(strength!.retention).toBe(1);
    expect(strength!.mastery).toBeGreaterThanOrEqual(DETECTION.strongMastery);
  });
});

describe('decay detection', () => {
  it('reports nothing without enough on both sides', () => {
    const { evidence } = withHistory([...ok(2), ...bad(2)]);
    expect(detectDecay(evidence)).toEqual([]);
  });

  it('reports a decline with the two figures that show it', () => {
    const { evidence } = withHistory([...ok(4), ...bad(4)]);
    const [signal] = detectDecay(evidence);

    expect(signal!.earlierRetention).toBe(1);
    expect(signal!.recentRetention).toBe(0);
    expect(signal!.change).toBe(-1);
    expect(signal!.direction).toBe('declining');
    expect(signal!.earlierSampleSize).toBe(4);
    expect(signal!.recentSampleSize).toBe(4);
  });

  it('reports improvement as improvement', () => {
    const { evidence } = withHistory([...bad(4), ...ok(4)]);
    const [signal] = detectDecay(evidence);

    expect(signal!.change).toBe(1);
    expect(signal!.direction).toBe('improving');
  });

  it('calls a small wobble stable rather than a direction', () => {
    // 5/6 then 6/6 is a change of 0.167... which exceeds the band; 6/6 then
    // 6/6 is zero. A genuinely small change must read stable.
    const { evidence } = withHistory([...ok(5), 'again', ...ok(5), 'again']);
    const [signal] = detectDecay(evidence);

    expect(Math.abs(signal!.change)).toBeLessThan(DETECTION.stableBand);
    expect(signal!.direction).toBe('stable');
  });

  it('lists the steepest decline first', () => {
    const raw = snapshot({
      items: [
        item('a', { semanticId: toId(STRUCT) }),
        item('b', { semanticId: toId(OTHER) }),
      ],
      events: [
        ...[...ok(3), ...bad(3)].map((r, i) => event(`a${i}`, 'a', r, iso(NOW, -(6 - i)))),
        ...[...ok(3), 'good' as const, 'again' as const, 'again' as const].map((r, i) =>
          event(`b${i}`, 'b', r, iso(NOW, -(6 - i), 10)),
        ),
      ],
    });
    const cleaned = clean(raw, NOW);
    const signals = detectDecay(
      gatherEvidence(cleaned, structureViews(cleaned, NOW), WINDOW, NOW),
    );

    expect(signals[0]!.change).toBeLessThanOrEqual(signals[1]!.change);
  });
});

describe('recommendations', () => {
  const NO_MODELS = new Set<string>();

  function recommend(
    raw: ReturnType<typeof snapshot>,
    availableModels: ReadonlySet<string> = NO_MODELS,
  ) {
    const cleaned = clean(raw, NOW);
    const views = structureViews(cleaned, NOW);
    const evidence = gatherEvidence(cleaned, views, WINDOW, NOW);
    const attention = detectWeakAreas(evidence);
    return buildRecommendations(cleaned, views, attention, evidence, WINDOW, NOW, {
      availableModels,
    });
  }

  it('returns nothing and says so when there is no history at all', () => {
    // A padded list of plausible suggestions is worse than an empty one,
    // because it looks like the system knows something.
    const result = recommend(snapshot());
    expect(result.sufficientData).toBe(false);
    expect(result.recommendations).toEqual([]);
  });

  it('still suggests starting untouched material without review history', () => {
    // Not a guess: the learner has items they have never opened.
    const result = recommend(
      snapshot({ items: [item('i1', { phase: 'new', repetitions: 0, lapses: 0 })] }),
    );

    expect(result.sufficientData).toBe(false);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.kind).toBe('start_new_material');
  });

  it('puts overdue work first, with how late it is', () => {
    const result = recommend(
      snapshot({
        items: [
          item('i1', { semanticId: toId(STRUCT), dueAt: iso(NOW, -9) }),
          item('i2', { semanticId: toId(OTHER), dueAt: iso(NOW, -2) }),
        ],
        events: ok(4).map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(4 - i)))),
      }),
    );

    expect(result.recommendations[0]!.kind).toBe('overdue_review');
    expect(result.recommendations[0]!.reason).toMatch(/\d+ days?/);
    expect(result.recommendations[0]!.evidence.overdueDays).toBeGreaterThan(8);
  });

  it('gives every recommendation a reason and real item ids', () => {
    const result = recommend(
      snapshot({
        items: [item('i1', { semanticId: toId(STRUCT), dueAt: iso(NOW, -3) })],
        events: ok(4).map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(4 - i)))),
      }),
    );

    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of result.recommendations) {
      expect(recommendation.reason.length).toBeGreaterThan(10);
      expect(recommendation.itemIds.length).toBeGreaterThan(0);
      // Every id must be one the learner actually has.
      for (const id of recommendation.itemIds) expect(['i1']).toContain(id);
    }
  });

  it('explains a weak area with the numbers that flagged it', () => {
    const result = recommend(
      snapshot({
        items: [
          item('i1', {
            semanticId: toId(STRUCT), modelRef: 'model-1',
            repetitions: 1, lapses: 4, stability: 0.5, dueAt: iso(NOW, 5),
          }),
        ],
        events: [...bad(4), ...ok(1)].map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(5 - i)))),
      }),
    );

    const weak = result.recommendations.find((r) => r.kind === 'shore_up_weak_area');
    expect(weak).toBeDefined();
    // The prose is the evidence read aloud, so the two cannot drift apart.
    expect(weak!.reason).toMatch(/\d+%/);
    expect(weak!.evidence.reviews).toBe(5);
  });

  it('never offers a 3D action for a model that is not available', () => {
    // With Gate 9 RED no anatomy model loads. A button that fails when tapped
    // is worse than no button.
    const result = recommend(
      snapshot({
        items: [item('i1', { semanticId: toId(STRUCT), modelRef: 'unavailable', dueAt: iso(NOW, -3) })],
        events: ok(4).map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(4 - i)))),
      }),
      NO_MODELS,
    );

    expect(result.recommendations.every((r) => r.canViewInModel === false)).toBe(true);
  });

  it('offers the 3D action when the model really is available', () => {
    const result = recommend(
      snapshot({
        items: [item('i1', { semanticId: toId(STRUCT), modelRef: 'loaded', dueAt: iso(NOW, -3) })],
        events: ok(4).map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(4 - i)))),
      }),
      new Set(['loaded']),
    );

    expect(result.recommendations[0]!.canViewInModel).toBe(true);
  });

  it('does not recommend the same items twice', () => {
    const result = recommend(
      snapshot({
        items: [
          item('i1', { semanticId: toId(STRUCT), dueAt: iso(NOW, -9), repetitions: 0, lapses: 5, stability: 0.4 }),
          item('i2', { semanticId: toId(OTHER), dueAt: iso(NOW, 0) }),
          item('i3', { phase: 'new', repetitions: 0, lapses: 0 }),
        ],
        events: bad(5).map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(5 - i)))),
      }),
    );

    const seen = new Set<string>();
    for (const recommendation of result.recommendations) {
      for (const id of recommendation.itemIds) {
        expect(seen.has(id), `${id} recommended twice`).toBe(false);
        seen.add(id);
      }
    }
  });

  it('is deterministic', () => {
    const raw = snapshot({
      items: [
        item('i1', { semanticId: toId(STRUCT), dueAt: iso(NOW, -4) }),
        item('i2', { semanticId: toId(OTHER), dueAt: iso(NOW, -1) }),
      ],
      events: [...ok(3), ...bad(2)].map((r, i) => event(`e${i}`, 'i1', r, iso(NOW, -(5 - i)))),
    });

    expect(recommend(raw)).toEqual(recommend(raw));
  });

  it('returns no more than the configured number', () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      item(`i${i}`, { semanticId: toId(STRUCT), dueAt: iso(NOW, -(i + 1)) }),
    );
    const result = recommend(
      snapshot({
        items,
        events: ok(4).map((r, i) => event(`e${i}`, 'i0', r, iso(NOW, -(4 - i)))),
      }),
    );

    expect(result.recommendations.length).toBeLessThanOrEqual(RECOMMENDATION.limit);
  });
});
