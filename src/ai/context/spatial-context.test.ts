import { describe, expect, it } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import type { SpatialCapabilities } from '@/types/domain/spatial';
import {
  buildTutorFixtureGraph,
  TUTOR_FIXTURE_IDS,
  TUTOR_FIXTURE_LAYERS,
} from '../fixtures/tutor-fixture';
import {
  buildSpatialContext,
  contextSemanticIds,
  DEFAULT_CONTEXT_LIMITS,
  type SceneStateView,
} from './spatial-context';

/**
 * The context builder is the boundary between VEO's model of the world and the
 * model's. Everything downstream — grounding, injection defence, the honest
 * "I don't know" — depends on this producing exactly what VEO can support and
 * nothing else.
 */

const ALL_CAPABILITIES: SpatialCapabilities = {
  supportsSelection: true,
  supportsLabels: true,
  supportsRelationships: true,
  supportsLayers: true,
  supportsIsolation: true,
  supportsGhosting: true,
  supportsPeeling: true,
  supportsDissection: true,
  supportsExplosion: false,
  supportsReconstruction: true,
};

function scene(overrides: Partial<SceneStateView> = {}): SceneStateView {
  return {
    selectedId: null,
    isolatedId: null,
    hiddenIds: new Set(),
    ghostedIds: new Set(),
    visibleLayerIds: new Set([TUTOR_FIXTURE_LAYERS.shell, TUTOR_FIXTURE_LAYERS.core]),
    capabilities: ALL_CAPABILITIES,
    ...overrides,
  };
}

function build(semanticId: string, sceneOverrides: Partial<SceneStateView> = {}) {
  return buildSpatialContext({
    graph: buildTutorFixtureGraph(),
    semanticId,
    scene: scene(sceneOverrides),
  });
}

describe('validating the selection', () => {
  it('refuses a malformed semantic id rather than building a prompt from it', () => {
    const result = build('not a semantic id at all');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('malformed_semantic_id');
  });

  it('refuses a well-formed id that is not in THIS model', () => {
    // The critical case: shape alone is not membership. An id from another
    // model would otherwise produce a confident answer about something absent.
    const result = build('veo.anatomy.heart.left_ventricle');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown_structure');
  });

  it('refuses when no model is loaded', () => {
    const result = buildSpatialContext({
      graph: null,
      semanticId: TUTOR_FIXTURE_IDS.coreUnit,
      scene: scene(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no_model');
  });
});

describe('resolving hierarchy', () => {
  it('builds the path from the model root to the subject', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.hierarchy.path).toEqual(['Test Apparatus', 'Assembly A', 'Core Unit']);
    expect(result.context.hierarchy.parent?.semanticId).toBe(TUTOR_FIXTURE_IDS.assemblyA);
  });

  it('lists children and counts everything below', () => {
    const result = build(TUTOR_FIXTURE_IDS.root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.hierarchy.children.map((c) => c.name)).toEqual([
      'Assembly A',
      'Assembly B',
    ]);
    // Two assemblies plus five structures beneath them.
    expect(result.context.hierarchy.descendantCount).toBe(7);
  });
});

describe('resolving relationships', () => {
  it('includes both directions of a bidirectional edge', () => {
    // Core Unit is the SOURCE of one edge and the TARGET of another. Both are
    // real connections to teach from, and a builder that only followed
    // outbound edges would silently lose half the model's connectivity.
    const result = build(TUTOR_FIXTURE_IDS.transferConduit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const targets = result.context.relationships.map((r) => r.targetId);
    expect(targets).toContain(TUTOR_FIXTURE_IDS.coreUnit);
    expect(targets).toContain(TUTOR_FIXTURE_IDS.outerShell);
  });

  it('names the other end using the name VEO holds for it', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const conduit = result.context.relationships.find(
      (r) => r.targetId === TUTOR_FIXTURE_IDS.transferConduit,
    );
    expect(conduit?.targetName).toBe('Transfer Conduit');
  });
});

describe('grounding assessment', () => {
  it('reports rich when the model supplies description and function', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.grounding).toBe('rich');
    expect(result.context.subject.description).toBeDefined();
    expect(result.context.subject.function).toBeDefined();
  });

  it('reports structural when there is no prose but there are real facts', () => {
    const result = build(TUTOR_FIXTURE_IDS.transferConduit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.grounding).toBe('structural');
    // The absent fields are ABSENT, not empty strings. A model shown
    // `description: ""` may treat it as a description that happens to be blank.
    expect(result.context.subject.description).toBeUndefined();
    expect(result.context.subject.function).toBeUndefined();
  });

  it('reports bare when the model supplies nothing beyond a name', () => {
    const result = build(TUTOR_FIXTURE_IDS.unmarkedElement);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.grounding).toBe('bare');
  });
});

describe('scene state', () => {
  it('reports the subject as hidden when it is', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit, {
      hiddenIds: new Set([TUTOR_FIXTURE_IDS.coreUnit as SemanticId]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.state.visibility).toBe('hidden');
  });

  it('says when something ELSE is isolated, which is why this may be dimmed', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit, {
      isolatedId: TUTOR_FIXTURE_IDS.outerShell as SemanticId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.state.isolated).toBe(false);
    expect(result.context.state.isolatedElsewhere).toBe(TUTOR_FIXTURE_IDS.outerShell);
  });

  it('reports layer visibility as the learner currently has it', () => {
    const result = build(TUTOR_FIXTURE_IDS.outerShell, {
      visibleLayerIds: new Set([TUTOR_FIXTURE_LAYERS.core]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const shell = result.context.state.layers.find((l) => l.id === TUTOR_FIXTURE_LAYERS.shell);
    expect(shell?.visible).toBe(false);
  });
});

describe('available actions', () => {
  it('offers only what the model supports', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit, {
      capabilities: { ...ALL_CAPABILITIES, supportsIsolation: false, supportsLayers: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.availableActions).not.toContain('ISOLATE_STRUCTURE');
    expect(result.context.availableActions).not.toContain('SHOW_LAYER');
    expect(result.context.availableActions).toContain('SELECT_STRUCTURE');
  });

  it('offers RESET_VIEW only when there is something to reset', () => {
    const clean = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.context.availableActions).not.toContain('RESET_VIEW');

    const dirty = build(TUTOR_FIXTURE_IDS.coreUnit, {
      hiddenIds: new Set([TUTOR_FIXTURE_IDS.outerShell as SemanticId]),
    });
    expect(dirty.ok).toBe(true);
    if (!dirty.ok) return;
    expect(dirty.context.availableActions).toContain('RESET_VIEW');
  });

  it('reports only the capabilities that are actually on', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // supportsExplosion is false in this fixture and must not be advertised.
    expect(result.context.capabilities).not.toContain('supportsExplosion');
    expect(result.context.capabilities).toContain('supportsSelection');
  });
});

describe('bounding', () => {
  it('caps children and says how many it dropped', () => {
    const result = buildSpatialContext({
      graph: buildTutorFixtureGraph(),
      semanticId: TUTOR_FIXTURE_IDS.assemblyA,
      scene: scene(),
      limits: { maxChildren: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.hierarchy.children).toHaveLength(1);
    expect(result.context.truncation.children).toBe(2);
    expect(result.context.truncation.any).toBe(true);
  });

  it('caps relationships and reports the truncation', () => {
    const result = buildSpatialContext({
      graph: buildTutorFixtureGraph(),
      semanticId: TUTOR_FIXTURE_IDS.transferConduit,
      scene: scene(),
      limits: { maxRelationships: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.relationships).toHaveLength(1);
    expect(result.context.truncation.relationships).toBeGreaterThan(0);
  });

  it('clamps a long description rather than sending it whole', () => {
    const graph = buildTutorFixtureGraph();
    const core = graph.objects.get(TUTOR_FIXTURE_IDS.coreUnit);
    expect(core).toBeDefined();
    if (!core) return;

    const objects = new Map(graph.objects);
    objects.set(TUTOR_FIXTURE_IDS.coreUnit, { ...core, description: 'x '.repeat(2000) });

    const result = buildSpatialContext({
      graph: { ...graph, objects },
      semanticId: TUTOR_FIXTURE_IDS.coreUnit,
      scene: scene(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.subject.description?.length).toBeLessThanOrEqual(
      DEFAULT_CONTEXT_LIMITS.maxDescriptionChars + 1,
    );
  });

  it('reports no truncation when nothing was dropped', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.truncation.any).toBe(false);
  });
});

describe('determinism', () => {
  it('produces byte-identical output for the same inputs', () => {
    // Guards against Map iteration order leaking into a prompt, which would
    // make responses unreproducible and any future cache useless.
    const a = build(TUTOR_FIXTURE_IDS.coreUnit);
    const b = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(JSON.stringify(a.context)).toBe(JSON.stringify(b.context));
  });

  it('sorts relationships regardless of authored order', () => {
    const graph = buildTutorFixtureGraph();
    const reversed = { ...graph, relationships: [...graph.relationships].reverse() };

    const forward = buildSpatialContext({
      graph,
      semanticId: TUTOR_FIXTURE_IDS.transferConduit,
      scene: scene(),
    });
    const backward = buildSpatialContext({
      graph: reversed,
      semanticId: TUTOR_FIXTURE_IDS.transferConduit,
      scene: scene(),
    });

    expect(forward.ok && backward.ok).toBe(true);
    if (!forward.ok || !backward.ok) return;
    expect(JSON.stringify(forward.context.relationships)).toBe(
      JSON.stringify(backward.context.relationships),
    );
  });
});

describe('no rendering internals cross the boundary', () => {
  it('carries no geometry, mesh names or provider handles', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialised = JSON.stringify(result.context);
    // Mesh names are a vendor artefact and are VEO's mapping detail, not
    // something a tutor should be able to quote back at a learner.
    expect(serialised).not.toContain('Fixture_Core_Unit');
    expect(serialised).not.toContain('providerMeshNames');
    expect(serialised).not.toContain('boundingBox');
    expect(serialised).not.toContain('modelId');
  });
});

describe('the id allowlist for the response validator', () => {
  it('collects every structure the context mentions', () => {
    const result = build(TUTOR_FIXTURE_IDS.coreUnit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = contextSemanticIds(result.context);
    expect(ids.has(TUTOR_FIXTURE_IDS.coreUnit)).toBe(true);
    expect(ids.has(TUTOR_FIXTURE_IDS.assemblyA)).toBe(true);
    expect(ids.has(TUTOR_FIXTURE_IDS.transferConduit)).toBe(true);
    // Never something the context did not carry.
    expect(ids.has('veo.anatomy.heart' as SemanticId)).toBe(false);
  });
});
