import { describe, expect, it } from 'vitest';
import { clean } from './integrity';
import { buildKnowledgeMap, flattenMap } from './knowledge-map';
import { structureViews } from './mastery';
import { analyse } from './engine';
import { event, item, iso, referenceSnapshot, snapshot, toId, REFERENCE } from './fixtures';
import type { KnowledgeMapNode } from './contract';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const NO_MODELS = new Set<string>();

function mapOf(raw: ReturnType<typeof snapshot>, availableModels = NO_MODELS) {
  const cleaned = clean(raw, NOW);
  return buildKnowledgeMap(cleaned, structureViews(cleaned, NOW), { availableModels });
}

function find(nodes: readonly KnowledgeMapNode[], dotted: string): KnowledgeMapNode | null {
  return flattenMap(nodes).find((node) => node.semanticId === toId(dotted)) ?? null;
}

describe('the knowledge map', () => {
  it('is empty but valid for a learner with nothing', () => {
    const map = mapOf(snapshot());
    expect(map).toEqual({ roots: [], totalStructures: 0, totalItems: 0, unplacedItems: 0 });
  });

  it('derives its hierarchy from the semantic ids alone', () => {
    const map = mapOf(referenceSnapshot(NOW));

    // The shallowest legal id is `veo.<domain>.<segment>`, so the tree roots
    // there. Nothing in the module knows what a "system" is.
    expect(map.roots.map((node) => node.semanticId)).toEqual([
      toId('veo.diagnostic.analytics_fixture'),
    ]);
    expect(find(map.roots, 'veo.diagnostic.analytics_fixture.system_a')).not.toBeNull();
    expect(find(map.roots, REFERENCE.structureA)).not.toBeNull();
  });

  it('builds the same shape for a domain that is not anatomy', () => {
    const map = mapOf(
      snapshot({
        items: [
          item('i1', { semanticId: toId('veo.astrophysics.stellar.main_sequence.g_type') }),
          item('i2', { semanticId: toId('veo.astrophysics.stellar.giants.red_giant') }),
        ],
        events: [
          event('e1', 'i1', 'good', iso(NOW, -1)),
          event('e2', 'i2', 'again', iso(NOW, -1)),
        ],
      }),
    );

    const stellar = find(map.roots, 'veo.astrophysics.stellar');
    expect(stellar).not.toBeNull();
    expect(stellar!.reviewCount).toBe(2);
    expect(stellar!.retention).toBe(0.5);
  });

  it('rolls retention up, weighted by the reviews beneath', () => {
    const map = mapOf(referenceSnapshot(NOW));
    const systemA = find(map.roots, 'veo.diagnostic.analytics_fixture.system_a')!;

    // 15 reviews, 9 recalled.
    expect(systemA.reviewCount).toBe(15);
    expect(systemA.retention).toBeCloseTo(0.6, 9);
  });

  it('gives an unreviewed node null retention, not zero', () => {
    // A node nobody has studied has no retention. 0% would say total failure.
    const map = mapOf(referenceSnapshot(NOW));
    const structureC = find(map.roots, REFERENCE.structureC)!;

    expect(structureC.reviewCount).toBe(0);
    expect(structureC.retention).toBeNull();
    expect(structureC.band).toBe('untouched');
  });

  it('does not call an unstudied structure "struggling"', () => {
    const map = mapOf(referenceSnapshot(NOW));
    for (const node of flattenMap(map.roots)) {
      if (node.reviewCount === 0) expect(node.band).toBe('untouched');
    }
  });

  it('counts items it could not place rather than dropping them', () => {
    // A total that quietly disagrees with the schedule is worse than one that
    // says what is missing.
    const map = mapOf(
      snapshot({
        items: [
          item('placed', { semanticId: toId('veo.physics.mechanics.lever') }),
          item('unplaced', { semanticId: null }),
        ],
      }),
    );

    expect(map.totalItems).toBe(2);
    expect(map.unplacedItems).toBe(1);
    expect(map.totalStructures).toBe(1);
  });

  it('treats a stale semantic id as unplaced rather than crashing', () => {
    const map = mapOf(
      snapshot({
        items: [item('broken', { semanticId: 'not.a.veo.id' as never })],
      }),
    );

    expect(map.roots).toEqual([]);
    expect(map.unplacedItems).toBe(1);
  });

  it('offers no 3D action when the model is unavailable', () => {
    // Gate 9 is RED: no anatomy model loads, so every node must say so.
    const map = mapOf(referenceSnapshot(NOW), NO_MODELS);
    expect(flattenMap(map.roots).every((node) => node.canViewInModel === false)).toBe(true);
  });

  it('offers the 3D action when the model really is available', () => {
    const map = mapOf(referenceSnapshot(NOW), new Set([REFERENCE.modelRef]));
    expect(find(map.roots, REFERENCE.structureA)!.canViewInModel).toBe(true);
  });

  it('refuses to guess when descendants name different models', () => {
    // Two models under one node means VEO cannot say which to open.
    const map = mapOf(
      snapshot({
        items: [
          item('i1', { semanticId: toId('veo.physics.mechanics.lever'), modelRef: 'model-a' }),
          item('i2', { semanticId: toId('veo.physics.mechanics.pulley'), modelRef: 'model-b' }),
        ],
      }),
      new Set(['model-a', 'model-b']),
    );

    const mechanics = find(map.roots, 'veo.physics.mechanics')!;
    expect(mechanics.modelRef).toBeNull();
    expect(mechanics.canViewInModel).toBe(false);

    // The leaves, which each name one model, still offer it.
    expect(find(map.roots, 'veo.physics.mechanics.lever')!.canViewInModel).toBe(true);
  });

  it('labels a node from its own id, never from invented anatomy', () => {
    const map = mapOf(referenceSnapshot(NOW));
    const node = find(map.roots, REFERENCE.structureA)!;

    expect(node.label.toLowerCase()).toContain('core');
    expect(node.label).not.toMatch(/ventricle|atrium|aorta/i);
  });

  it('stops at the requested depth but still counts what is below', () => {
    const cleaned = clean(referenceSnapshot(NOW), NOW);
    const shallow = buildKnowledgeMap(cleaned, structureViews(cleaned, NOW), {
      availableModels: NO_MODELS,
      maxDepth: 1,
    });

    expect(shallow.roots[0]!.children).toEqual([]);
    // Descendants are not rendered, but their items are still counted.
    expect(shallow.roots[0]!.itemCount).toBe(3);
  });

  it('is deterministic', () => {
    const raw = referenceSnapshot(NOW);
    expect(mapOf(raw)).toEqual(mapOf(raw));
  });
});

describe('the engine, end to end', () => {
  const result = analyse(referenceSnapshot(NOW), {
    period: '30d',
    now: NOW,
    availableModels: NO_MODELS,
  });

  it('reports one consistent account of the learner across every panel', () => {
    // The same structure must not be "struggling" in one panel and
    // "developing" in another.
    const fromMastery = result.overview.mastery.structures.find(
      (view) => view.semanticId === toId(REFERENCE.structureB),
    );
    const fromMap = find(result.knowledgeMap.roots, REFERENCE.structureB);

    expect(fromMastery!.mastery).toBeCloseTo(fromMap!.mastery, 9);
    expect(fromMastery!.band).toBe(fromMap!.band);
  });

  it('agrees with the retention panel about totals', () => {
    expect(result.overview.retention.totalReviews).toBe(REFERENCE.totalReviews);
    expect(result.overview.activity.reviews).toBe(REFERENCE.totalReviews);
  });

  it('says it has data when the learner has reviews', () => {
    expect(result.overview.hasData).toBe(true);
  });

  it('says it has no data for a brand-new learner', () => {
    const empty = analyse(snapshot(), { period: '30d', now: NOW, availableModels: NO_MODELS });

    expect(empty.overview.hasData).toBe(false);
    expect(empty.overview.retention.overall).toBeNull();
    expect(empty.overview.mastery.overall).toBeNull();
    expect(empty.overview.recommendations.sufficientData).toBe(false);
    expect(empty.overview.today.streakCurrent).toBe(0);
  });

  it('reports what it refused to count', () => {
    expect(result.overview.integrity.reviewsExcluded).toBe(0);
    expect(result.overview.integrity.itemsExcluded).toBe(0);
  });

  it('is deterministic across the whole surface', () => {
    const again = analyse(referenceSnapshot(NOW), {
      period: '30d', now: NOW, availableModels: NO_MODELS,
    });
    expect(again).toEqual(result);
  });
});
