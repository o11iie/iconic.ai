import { describe, expect, it, vi } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import type { BoundingBox, SpatialModelGraph, SpatialObject } from '@/types/domain/spatial';
import { SpatialObjectRegistry, type SceneNode } from './object-registry';
import { SceneController } from './scene-controller';
import { SpatialSearchIndex } from './search';
import { AnnotationRegistry, anchorPosition, defaultLabelsFor } from './annotations';

/**
 * Semantic layer tests.
 *
 * These cover the properties that make the layer trustworthy: a rendered mesh
 * is never the source of truth, a stale reference can never resolve, and
 * hierarchy, relationships and search all agree on one semantic model.
 */

const ROOT = 'veo.diagnostic.scene' as SemanticId;
const SYS_A = 'veo.diagnostic.scene.system_a' as SemanticId;
const SYS_B = 'veo.diagnostic.scene.system_b' as SemanticId;
const OBJ_1 = 'veo.diagnostic.scene.system_a.object_1' as SemanticId;
const OBJ_2 = 'veo.diagnostic.scene.system_a.object_2' as SemanticId;
const OBJ_3 = 'veo.diagnostic.scene.system_b.object_3' as SemanticId;

function node(name: string, isMesh = false): SceneNode {
  return { name, parent: null, children: [], userData: {}, isMesh };
}

function attach(parent: SceneNode, child: SceneNode): SceneNode {
  (parent.children as SceneNode[]).push(child);
  child.parent = parent;
  return child;
}

function descriptor(
  semanticId: SemanticId,
  overrides: Partial<SpatialObject> = {},
): SpatialObject {
  return {
    id: semanticId,
    modelId: 'model-1',
    semanticId,
    name: semanticId.split('.').pop() as string,
    kind: 'structure',
    parentId: null,
    childIds: [],
    system: null,
    region: null,
    layerIds: [],
    providerMeshNames: [],
    boundingBox: null,
    description: null,
    synonyms: [],
    metadata: {},
    ...overrides,
  };
}

/**
 * A small graph with two systems and three leaf objects.
 *
 * `edit` runs while the object map is still mutable, so a test can describe a
 * different model without reaching through the graph's readonly surface.
 */
function graphFixture(
  edit?: (objects: Map<SemanticId, SpatialObject>) => void,
): SpatialModelGraph {
  const objects = new Map<SemanticId, SpatialObject>([
    [ROOT, descriptor(ROOT, { name: 'Scene', kind: 'group', childIds: [SYS_A, SYS_B] })],
    [SYS_A, descriptor(SYS_A, { name: 'System A', kind: 'group', parentId: ROOT, childIds: [OBJ_1, OBJ_2], system: 'system_a' })],
    [SYS_B, descriptor(SYS_B, { name: 'System B', kind: 'group', parentId: ROOT, childIds: [OBJ_3], system: 'system_b' })],
    [OBJ_1, descriptor(OBJ_1, { name: 'Object One', parentId: SYS_A, system: 'system_a', region: 'west', synonyms: ['alpha'] })],
    [OBJ_2, descriptor(OBJ_2, { name: 'Object Two', parentId: SYS_A, system: 'system_a', region: 'north' })],
    [OBJ_3, descriptor(OBJ_3, { name: 'Object Three', parentId: SYS_B, system: 'system_b', region: 'east' })],
  ]);

  edit?.(objects);

  return {
    model: {
      id: 'model-1',
      domain: 'diagnostic',
      name: 'Fixture',
      description: null,
      thumbnailUrl: null,
      provider: 'test',
      providerRef: 'fixture',
      rootObjectId: ROOT,
      assetProfile: {
        approximateBytes: null,
        triangleCount: null,
        hasDracoCompression: false,
        hasKtx2Textures: false,
      },
      licence: { holder: 'VEO', kind: 'veo_owned', expiresAt: null, attributionRequired: false },
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    objects,
    layers: [],
    regions: [],
    relationships: [
      {
        id: 'r1',
        sourceId: OBJ_1,
        targetId: OBJ_3,
        kind: 'connects_to',
        label: 'Object Three',
        bidirectional: true,
        confidence: 1,
        metadata: {},
      },
      {
        id: 'r2',
        sourceId: OBJ_1,
        targetId: 'veo.diagnostic.scene.absent' as SemanticId,
        kind: 'connects_to',
        label: 'Missing',
        bidirectional: false,
        confidence: 1,
        metadata: {},
      },
    ],
  };
}

/** Controller with the fixture graph and every object registered to a node. */
function loadedController() {
  const controller = new SceneController();
  const graph = graphFixture();
  controller.setGraph(graph);

  const nodes = new Map<SemanticId, SceneNode>();
  const root = node('Scene');
  controller.registry.register(ROOT, root);
  nodes.set(ROOT, root);

  for (const [id, parentId] of [
    [SYS_A, ROOT],
    [SYS_B, ROOT],
  ] as const) {
    const group = attach(nodes.get(parentId) as SceneNode, node(id));
    controller.registry.register(id, group);
    nodes.set(id, group);
  }

  for (const [id, parentId] of [
    [OBJ_1, SYS_A],
    [OBJ_2, SYS_A],
    [OBJ_3, SYS_B],
  ] as const) {
    const mesh = attach(nodes.get(parentId) as SceneNode, node(id, true));
    controller.registry.register(id, mesh);
    nodes.set(id, mesh);
  }

  return { controller, nodes, graph };
}

/**
 * Controller whose graph declares grouping structures that own no geometry.
 *
 * This is the ordinary shape of a real asset: systems and regions exist as
 * grouping nodes, and only leaves carry meshes. Registering every object, as
 * `loadedController` does, would hide any place where the semantic layer has
 * quietly made geometry the test for existence.
 */
function partiallyRenderedController() {
  const controller = new SceneController();
  controller.setGraph(graphFixture());

  const nodes = new Map<SemanticId, SceneNode>();
  const boxes = new Map<SemanticId, BoundingBox>();
  const root = node('Scene');

  const geometry: readonly (readonly [SemanticId, BoundingBox])[] = [
    [OBJ_1, { min: [-2, -1, -1], max: [-1, 1, 1] }],
    [OBJ_2, { min: [1, -1, -1], max: [2, 1, 1] }],
    [OBJ_3, { min: [-1, 3, -1], max: [1, 4, 1] }],
  ];

  for (const [id, box] of geometry) {
    const mesh = attach(root, node(id, true));
    controller.registry.register(id, mesh);
    nodes.set(id, mesh);
    boxes.set(id, box);
  }

  controller.setBoundsResolver((id) => boxes.get(id) ?? null);
  return { controller, nodes };
}

describe('registry: descriptors and resolution', () => {
  it('resolves a render object all the way to its SpatialObject', () => {
    const { controller, nodes } = loadedController();

    const object = controller.registry.resolveFromObject(nodes.get(OBJ_1) as SceneNode);
    expect(object?.name).toBe('Object One');
    expect(object?.system).toBe('system_a');
  });

  it('resolves a semantic id to its descriptor', () => {
    const { controller } = loadedController();
    expect(controller.registry.resolveFromSemanticId(OBJ_2)?.name).toBe('Object Two');
  });

  it('returns null for an id the current model does not contain', () => {
    const { controller } = loadedController();
    expect(controller.registry.resolveFromSemanticId('veo.diagnostic.scene.nope' as SemanticId)).toBeNull();
    expect(controller.registry.isValid('veo.diagnostic.scene.nope' as SemanticId)).toBe(false);
  });

  it('unregisters a structure and stops resolving it from geometry', () => {
    const { controller, nodes } = loadedController();
    const mesh = nodes.get(OBJ_1) as SceneNode;

    expect(controller.registry.unregister(OBJ_1)).toBe(true);
    expect(controller.registry.hasGeometry(OBJ_1)).toBe(false);
    // The tag is stripped, so a raycast on that node resolves to its parent.
    expect(controller.registry.resolve(mesh)).toBe(SYS_A);

    // The model still DECLARES it. Unloading geometry is not the same as the
    // structure ceasing to exist, and the semantic layer must not confuse them.
    expect(controller.registry.has(OBJ_1)).toBe(true);
    expect(controller.getObject(OBJ_1)?.name).toBe('Object One');
  });
});

describe('registry: generation safety', () => {
  it('rejects a node held from a previous model', () => {
    // The exact defect this prevents: keeping a reference across a model swap
    // and having it silently resolve against the new model.
    const registry = new SpatialObjectRegistry();
    const mesh = node('Object', true);
    registry.register(OBJ_1, mesh);

    expect(registry.resolve(mesh)).toBe(OBJ_1);

    registry.clear();
    registry.register(OBJ_1, node('Object', true));

    // Same id, new model — but the OLD node must not resolve.
    expect(registry.resolve(mesh)).toBeNull();
  });

  it('increments generation on clear', () => {
    const registry = new SpatialObjectRegistry();
    const before = registry.generation;
    registry.clear();
    expect(registry.generation).toBe(before + 1);
  });

  it('strips tags on clear, so stale nodes carry no identity', () => {
    const registry = new SpatialObjectRegistry();
    const mesh = node('Object', true);
    registry.register(OBJ_1, mesh);

    registry.clear();

    expect(mesh.userData.veoSemanticId).toBeNull();
    expect(registry.resolve(mesh)).toBeNull();
  });
});

describe('registry: hierarchy', () => {
  it('reports parent and children from declared descriptors', () => {
    const { controller } = loadedController();

    expect(controller.registry.getParent(OBJ_1)).toBe(SYS_A);
    expect(controller.registry.getChildren(SYS_A).sort()).toEqual([OBJ_1, OBJ_2].sort());
    expect(controller.registry.getParent(ROOT)).toBeNull();
  });

  it('lists ancestors nearest first', () => {
    const { controller } = loadedController();
    expect(controller.registry.getAncestors(OBJ_1)).toEqual([SYS_A, ROOT]);
  });

  it('lists every descendant at any depth', () => {
    const { controller } = loadedController();
    expect(controller.registry.getDescendants(ROOT).sort()).toEqual(
      [SYS_A, SYS_B, OBJ_1, OBJ_2, OBJ_3].sort(),
    );
  });

  it('falls back to the semantic path when a model declares no tree', () => {
    // A model can ship geometry without a declared hierarchy; the id path is
    // still navigable.
    const registry = new SpatialObjectRegistry();
    registry.register(SYS_A, node('A'));
    registry.register(OBJ_1, node('One', true));

    expect(registry.getParent(OBJ_1)).toBe(SYS_A);
    expect(registry.getChildren(SYS_A)).toEqual([OBJ_1]);
  });

  it('terminates on a descriptor cycle rather than hanging', () => {
    const controller = new SceneController();
    const objects = new Map<SemanticId, SpatialObject>([
      [OBJ_1, descriptor(OBJ_1, { parentId: OBJ_2 })],
      [OBJ_2, descriptor(OBJ_2, { parentId: OBJ_1 })],
    ]);
    controller.registry.setDescriptors(objects);
    controller.registry.register(OBJ_1, node('1', true));
    controller.registry.register(OBJ_2, node('2', true));

    expect(() => controller.registry.getAncestors(OBJ_1)).not.toThrow();
    expect(controller.registry.getAncestors(OBJ_1).length).toBeLessThan(5);
  });
});

describe('controller: semantic model', () => {
  it('builds descriptors, search index and labels from one entry point', () => {
    const { controller } = loadedController();

    expect(controller.getObject(OBJ_1)?.name).toBe('Object One');
    expect(controller.searchIndex.size).toBe(6);
    expect(controller.annotations.allLabels()).toHaveLength(6);
  });

  it('filters relationships to targets that exist in the current model', () => {
    // A relationship pointing at something absent must not be offered: the
    // learner would click it and select nothing.
    const { controller } = loadedController();
    const related = controller.getRelationships(OBJ_1);

    expect(related).toHaveLength(1);
    expect(related[0]?.targetId).toBe(OBJ_3);
  });

  it('resolves bidirectional relationships from either end', () => {
    const { controller } = loadedController();
    expect(controller.getRelationships(OBJ_3).map((r) => r.id)).toEqual(['r1']);
  });

  it('clears everything when the graph is dropped', () => {
    const { controller } = loadedController();
    controller.setGraph(null);

    expect(controller.getObject(OBJ_1)).toBeNull();
    expect(controller.searchIndex.size).toBe(0);
    expect(controller.getObjectIds()).toEqual([]);
  });
});

describe('controller: selection integrity', () => {
  it('rejects an id the current model does not contain', () => {
    // This is what makes a URL parameter or a saved note safe to pass in.
    const { controller } = loadedController();

    expect(controller.select('veo.diagnostic.scene.injected' as SemanticId)).toBe(false);
    expect(controller.getSnapshot().selectedId).toBeNull();
  });

  it('keeps the selection when a different object is hovered', () => {
    const { controller } = loadedController();
    controller.select(OBJ_1);
    controller.setHovered(OBJ_2);

    const snapshot = controller.getSnapshot();
    expect(snapshot.selectedId).toBe(OBJ_1);
    expect(snapshot.hoveredId).toBe(OBJ_2);
    // Selected must stay visually distinct from hovered.
    expect(snapshot.visual.states.get(OBJ_1)).toBe('selected');
    expect(snapshot.visual.states.get(OBJ_2)).toBe('hovered');
  });

  it('keeps selection distinct when the SAME object is hovered', () => {
    const { controller } = loadedController();
    controller.select(OBJ_1);
    controller.setHovered(OBJ_1);

    expect(controller.getSnapshot().visual.states.get(OBJ_1)).toBe('selected');
  });

  it('invalidates the selection when the object is hidden', () => {
    const { controller } = loadedController();
    controller.select(OBJ_1);
    controller.hide([OBJ_1]);

    expect(controller.getSnapshot().selectedId).toBeNull();
    expect(controller.getSnapshot().visual.states.get(OBJ_1)).toBe('hidden');
  });

  it('ignores hover for an unknown id', () => {
    const { controller } = loadedController();
    controller.setHovered('veo.diagnostic.scene.ghost' as SemanticId);
    expect(controller.getSnapshot().hoveredId).toBeNull();
  });

  it('does not restore selection into a model that lacks the identity', () => {
    const { controller } = loadedController();
    controller.select(OBJ_1);

    const other = graphFixture((objects) => {
      objects.delete(OBJ_1);
    });
    controller.setGraph(other);

    expect(controller.getSnapshot().selectedId).toBeNull();
  });

  it('keeps selection across a reload that still contains the identity', () => {
    const { controller } = loadedController();
    controller.select(OBJ_1);

    controller.setGraph(graphFixture());

    // Losing the learner's place on every reload would be hostile; what must
    // not happen is a dangling reference, and the id genuinely still exists.
    expect(controller.getSnapshot().selectedId).toBe(OBJ_1);
  });

  it('focusObject selects and issues a camera intent in one step', () => {
    const { controller } = loadedController();

    expect(controller.focusObject(OBJ_2, { durationMs: 0 })).toBe(true);
    expect(controller.getSnapshot().selectedId).toBe(OBJ_2);
    expect(controller.getCameraCommand()?.kind).toBe('fly_to');
    expect(controller.getCameraCommand()?.targetId).toBe(OBJ_2);
  });

  it('focusObject refuses an unknown id and issues no camera intent', () => {
    const { controller } = loadedController();
    const before = controller.getCameraCommand();

    expect(controller.focusObject('veo.diagnostic.scene.nope' as SemanticId)).toBe(false);
    expect(controller.getCameraCommand()).toBe(before);
  });
});

describe('controller: bounds API', () => {
  it('reads live geometry through the injected resolver', () => {
    const { controller } = loadedController();
    controller.setBoundsResolver((id) =>
      id === OBJ_1 ? { min: [-1, -2, -3], max: [1, 2, 3] } : null,
    );

    expect(controller.getObjectBounds(OBJ_1)).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
    expect(controller.getObjectCenter(OBJ_1)).toEqual([0, 0, 0]);
    expect(controller.getObjectRadius(OBJ_1)).toBeCloseTo(Math.hypot(1, 2, 3), 5);
    expect(controller.getObjectWorldPosition(OBJ_1, 'top')).toEqual([0, 2, 0]);
  });

  it('falls back to declared bounds when nothing is rendered', () => {
    const controller = new SceneController();
    const graph = graphFixture((objects) => {
      objects.set(OBJ_1, descriptor(OBJ_1, { boundingBox: { min: [0, 0, 0], max: [2, 2, 2] } }));
    });
    controller.setGraph(graph);
    controller.registry.register(OBJ_1, node('1', true));

    expect(controller.getObjectCenter(OBJ_1)).toEqual([1, 1, 1]);
  });

  it('returns null rather than a box at the origin for an unknown id', () => {
    const { controller } = loadedController();
    expect(controller.getObjectBounds('veo.diagnostic.scene.nope' as SemanticId)).toBeNull();
    expect(controller.getObjectRadius('veo.diagnostic.scene.nope' as SemanticId)).toBeNull();
  });
});

describe('search', () => {
  it('finds objects by name, id, synonym, system and region', () => {
    const { controller } = loadedController();

    expect(controller.search('Object One')[0]?.semanticId).toBe(OBJ_1);
    expect(controller.search('object_3')[0]?.semanticId).toBe(OBJ_3);
    expect(controller.search('alpha')[0]?.semanticId).toBe(OBJ_1);
    expect(controller.search('system_b').map((r) => r.semanticId)).toContain(OBJ_3);
    expect(controller.search('east').map((r) => r.semanticId)).toContain(OBJ_3);
  });

  it('ranks an exact name match above a weaker one', () => {
    const index = new SpatialSearchIndex();
    index.build([
      descriptor(OBJ_1, { name: 'Valve' }),
      descriptor(OBJ_2, { name: 'Valve housing assembly' }),
    ]);

    expect(index.search('valve')[0]?.semanticId).toBe(OBJ_1);
  });

  it('returns nothing for an empty query rather than everything', () => {
    const { controller } = loadedController();
    expect(controller.search('')).toEqual([]);
    expect(controller.search('   ')).toEqual([]);
  });

  it('every result resolves back to a selectable object', () => {
    const { controller } = loadedController();
    for (const result of controller.search('object')) {
      expect(controller.registry.isValid(result.semanticId)).toBe(true);
      expect(controller.select(result.semanticId)).toBe(true);
    }
  });

  it('reports which field matched, so a result can be explained', () => {
    const { controller } = loadedController();
    expect(controller.search('Object One')[0]?.matchedOn).toBe('name');
    expect(controller.search('alpha')[0]?.matchedOn).toBe('synonym');
  });
});

describe('annotations', () => {
  it('anchors a label to a semantic object, never a world position', () => {
    const registry = new AnnotationRegistry();
    registry.addLabel({
      id: 'l1',
      semanticId: OBJ_1,
      name: 'Object One',
      priority: 50,
      visible: true,
      anchor: 'top',
    });

    expect(registry.labelsFor(OBJ_1)).toHaveLength(1);
    expect(registry.getLabel('l1')?.semanticId).toBe(OBJ_1);
  });

  it('derives position from live bounds at render time', () => {
    const box = { min: [-1, -1, -1] as const, max: [1, 3, 1] as const };
    expect(anchorPosition(box as never, 'top')).toEqual([0, 3, 0]);
    expect(anchorPosition(box as never, 'bottom')).toEqual([0, -1, 0]);
    expect(anchorPosition(box as never, 'center')).toEqual([0, 1, 0]);
  });

  it('orders labels by priority and honours a budget', () => {
    const registry = new AnnotationRegistry();
    registry.setLabels(
      defaultLabelsFor([
        { semanticId: ROOT, name: 'Scene', depth: 0 },
        { semanticId: OBJ_1, name: 'Object One', depth: 2 },
      ]).map((label) => ({ ...label, visible: true })),
    );

    const visible = registry.visibleLabels(1);
    expect(visible).toHaveLength(1);
    // Shallower structures win the limited budget; they orient the learner.
    expect(visible[0]?.semanticId).toBe(ROOT);
  });

  it('draws no labels until asked, so a dense model is not unreadable by default', () => {
    // The guarantee lives in the controller's master switch. Seeding each
    // label hidden as well made the switch inert — turning labels on drew
    // nothing — so the property is asserted where it is enforced.
    const { controller } = loadedController();
    controller.setBoundsResolver(() => ({ min: [0, 0, 0], max: [1, 1, 1] }));

    expect(controller.areLabelsEnabled()).toBe(false);
    expect(controller.getVisibleLabels()).toHaveLength(0);

    controller.setLabelsEnabled(true);
    expect(controller.getVisibleLabels().length).toBeGreaterThan(0);
  });

  it('drops a label whose structure has no position to anchor to', () => {
    // Without live geometry there is nowhere to put it, and a label at the
    // origin would point at the wrong thing rather than at nothing.
    const { controller } = loadedController();
    controller.setLabelsEnabled(true);

    expect(controller.getVisibleLabels()).toHaveLength(0);
  });

  it('drops a label whose structure is no longer drawn', () => {
    // A name floating over nothing is worse than no name.
    const { controller } = loadedController();
    controller.setLabelsEnabled(true);
    controller.setBoundsResolver(() => ({ min: [0, 0, 0], max: [1, 1, 1] }));

    const named = () => controller.getVisibleLabels().map((l) => l.annotation.semanticId);
    expect(named()).toContain(OBJ_1);

    controller.hideObject(OBJ_1);
    expect(named()).not.toContain(OBJ_1);

    controller.showObject(OBJ_1);
    expect(named()).toContain(OBJ_1);
  });

  it('keeps a ghosted structure labelled, because it is still there', () => {
    const { controller } = loadedController();
    controller.setLabelsEnabled(true);
    controller.setBoundsResolver(() => ({ min: [0, 0, 0], max: [1, 1, 1] }));

    controller.ghostObject(OBJ_1);
    expect(controller.getVisibleLabels().map((l) => l.annotation.semanticId)).toContain(OBJ_1);
  });

  it('never drops the selected structure to the budget', () => {
    const { controller } = loadedController();
    controller.setLabelsEnabled(true);
    controller.setBoundsResolver(() => ({ min: [0, 0, 0], max: [1, 1, 1] }));
    controller.select(OBJ_3);

    // OBJ_3 is the deepest, so priority alone would drop it first.
    const only = controller.getVisibleLabels(1);
    expect(only[0]?.annotation.semanticId).toBe(OBJ_3);
  });

  it('anchors a pin to a semantic object', () => {
    const registry = new AnnotationRegistry();
    registry.addPin({
      id: 'p1',
      semanticId: OBJ_2,
      title: 'Check this',
      description: null,
      kind: 'note',
      anchor: 'center',
      ownerId: 'user-1',
    });

    expect(registry.pinsFor(OBJ_2)).toHaveLength(1);
    expect(registry.pinsFor(OBJ_1)).toHaveLength(0);
  });

  it('prunes annotations whose object is not in the current model', () => {
    // A label authored against one model must not float over another.
    const registry = new AnnotationRegistry();
    registry.addLabel({
      id: 'l1', semanticId: OBJ_1, name: 'One', priority: 1, visible: true, anchor: 'top',
    });
    registry.addPin({
      id: 'p1', semanticId: OBJ_3, title: 'Pin', description: null, kind: 'note',
      anchor: 'center', ownerId: null,
    });

    const removed = registry.pruneTo(new Set([OBJ_1]));

    expect(removed).toBe(1);
    expect(registry.allLabels()).toHaveLength(1);
    expect(registry.allPins()).toHaveLength(0);
  });
});

describe('performance characteristics', () => {
  it('does not notify subscribers when selection is unchanged', () => {
    const { controller } = loadedController();
    controller.select(OBJ_1);

    const listener = vi.fn();
    controller.subscribe(listener);
    controller.select(OBJ_1);
    controller.setHovered(null);

    expect(listener).not.toHaveBeenCalled();
  });

  it('validates selection in constant time against an indexed set', () => {
    // Guards against a regression to a linear scan of objectIds on every
    // pointer move.
    const controller = new SceneController();
    const many = Array.from({ length: 5000 }, (_, i) => `veo.diagnostic.scene.n_${i}` as SemanticId);
    controller.setObjects(many);

    const started = performance.now();
    for (let i = 0; i < 5000; i += 1) controller.isSelectable(many[i] as SemanticId);
    expect(performance.now() - started).toBeLessThan(120);
  });
});

/**
 * Regression: structures a model declares but does not render.
 *
 * The registry originally treated "has a registered render node" as the test
 * for membership in the current model. Every grouping structure therefore
 * vanished from hierarchy, search and selection the moment it was drawn as a
 * bare group — which is how essentially every real asset is authored. Making
 * the rendered mesh the arbiter of existence is the exact mistake the semantic
 * layer exists to prevent.
 */
describe('regression: declared structures without geometry', () => {
  it('counts a declared structure as part of the current model', () => {
    const { controller } = partiallyRenderedController();

    expect(controller.registry.has(SYS_A)).toBe(true);
    expect(controller.registry.isValid(SYS_A)).toBe(true);
    expect(controller.registry.hasGeometry(SYS_A)).toBe(false);
    expect(controller.registry.hasGeometry(OBJ_1)).toBe(true);
  });

  it('resolves it to its descriptor', () => {
    const { controller } = partiallyRenderedController();
    expect(controller.getObject(SYS_A)?.name).toBe('System A');
  });

  it('keeps it in the hierarchy, so a breadcrumb reaches the root', () => {
    const { controller } = partiallyRenderedController();

    expect(controller.registry.getParent(OBJ_1)).toBe(SYS_A);
    expect(controller.registry.getAncestors(OBJ_1)).toEqual([SYS_A, ROOT]);
    expect(controller.registry.getChildren(SYS_A)).toEqual([OBJ_1, OBJ_2]);
  });

  it('keeps it selectable and findable', () => {
    const { controller } = partiallyRenderedController();

    expect(controller.search('System A')[0]?.semanticId).toBe(SYS_A);
    expect(controller.select(SYS_A)).toBe(true);
    expect(controller.getSnapshot().selectedId).toBe(SYS_A);
  });

  it('frames it by the extent of what it contains', () => {
    const { controller } = partiallyRenderedController();

    // System A holds objects 1 and 2, which straddle the origin on x.
    expect(controller.getObjectBounds(SYS_A)).toEqual({ min: [-2, -1, -1], max: [2, 1, 1] });
    expect(controller.getObjectCenter(SYS_A)).toEqual([0, 0, 0]);

    // The root spans everything, including object 3 up at y = 4.
    expect(controller.getObjectBounds(ROOT)).toEqual({ min: [-2, -1, -1], max: [2, 4, 1] });
  });

  it('still refuses an id no model declares', () => {
    const { controller } = partiallyRenderedController();
    const ghost = 'veo.diagnostic.scene.ghost' as SemanticId;

    expect(controller.registry.isValid(ghost)).toBe(false);
    expect(controller.select(ghost)).toBe(false);
    expect(controller.getObjectBounds(ghost)).toBeNull();
  });

  it('drops declared structures when the model is cleared', () => {
    const { controller } = partiallyRenderedController();
    controller.registry.clear();

    expect(controller.registry.isValid(SYS_A)).toBe(false);
    expect(controller.registry.resolveFromSemanticId(SYS_A)).toBeNull();
  });
});

/**
 * Regression: registration and model publication commit in either order.
 *
 * The canvas is a separate React tree and commits on its own schedule, so the
 * effect that registers render nodes and the effect that publishes the model
 * cannot assume which runs first. Clearing render nodes used to discard the
 * model's descriptors as a side effect, and whenever registration committed
 * last the model silently lost its hierarchy, its grouping structures and its
 * search entries — while still rendering and selecting perfectly, which is why
 * only a live browser caught it.
 */
describe('regression: registration order', () => {
  function registerLeaves(controller: SceneController) {
    const root = node('Scene');
    for (const id of [OBJ_1, OBJ_2, OBJ_3]) {
      controller.registry.register(id, attach(root, node(id, true)));
    }
  }

  function expectIntactModel(controller: SceneController) {
    expect(controller.registry.getParent(OBJ_1)).toBe(SYS_A);
    expect(controller.registry.getAncestors(OBJ_1)).toEqual([SYS_A, ROOT]);
    expect(controller.getObject(SYS_A)?.name).toBe('System A');
    expect(controller.search('System A')[0]?.semanticId).toBe(SYS_A);
    expect(controller.getObject(OBJ_1)?.region).toBe('west');
  }

  it('keeps the model when the graph is published first', () => {
    const controller = new SceneController();
    controller.setGraph(graphFixture());
    controller.beginRegistration();
    registerLeaves(controller);

    expectIntactModel(controller);
  });

  it('keeps the model when the scene registers first', () => {
    const controller = new SceneController();
    controller.beginRegistration();
    registerLeaves(controller);
    controller.setGraph(graphFixture());

    expectIntactModel(controller);
  });

  it('survives a replacement in the order React actually commits it', () => {
    const controller = new SceneController();
    controller.setGraph(graphFixture());
    controller.beginRegistration();
    registerLeaves(controller);

    // Replacement: the page tree tears down and republishes, the canvas tree
    // re-registers afterwards.
    controller.setGraph(null);
    controller.setGraph(graphFixture());
    controller.beginRegistration();
    registerLeaves(controller);

    expectIntactModel(controller);
  });

  it('still invalidates nodes from the previous generation', () => {
    const controller = new SceneController();
    controller.setGraph(graphFixture());
    controller.beginRegistration();

    const mesh = node('Object', true);
    controller.registry.register(OBJ_1, mesh);
    expect(controller.registry.resolve(mesh)).toBe(OBJ_1);

    controller.beginRegistration();
    expect(controller.registry.resolve(mesh)).toBeNull();
  });
});

/**
 * Regression: the provider's view of the loaded model.
 *
 * A provider used to keep its own copy of the graph alongside the
 * controller's. A model published straight to the controller — which is
 * exactly what the diagnostic path does — left that copy null, so everything
 * reading the provider saw a model with no layers while the engine was
 * happily peeling those same layers. Two copies of the truth, and the
 * interface read the wrong one.
 */
describe('regression: one copy of the loaded model', () => {
  it('reports a graph published directly to the controller', async () => {
    const { BaseSceneGraphProvider } = await import('./base-provider');
    const { ok } = await import('@/lib/result');

    /** The smallest provider that compiles: this tests the base class. */
    class BareProvider extends BaseSceneGraphProvider {
      readonly id = 'test';
      readonly name = 'Test';
      protected readonly capabilities = {
        ownsRenderer: false,
        supportsPartialLoad: false,
        supportsGhosting: true,
        supportsIsolation: true,
        supportsCutPlanes: false,
        supportsExplodedView: true,
        supportsAnimation: false,
        providesHierarchy: true,
        providesRelationships: true,
      };

      async initialize() {
        return ok(this.getStatus());
      }

      async loadModel() {
        return ok(graphFixture());
      }

      getAssetUrl(): string | null {
        return null;
      }

      getMeshMapping(): ReadonlyMap<string, SemanticId> {
        return new Map();
      }
    }

    const provider = new BareProvider();
    const graph = graphFixture();

    // Straight to the controller, bypassing the provider's own load path.
    provider.scene.setGraph(graph);

    expect(provider.getSnapshot().graph?.model.id).toBe('model-1');
    expect(provider.getSnapshot().capabilities.supportsIsolation).toBe(true);
  });
});
