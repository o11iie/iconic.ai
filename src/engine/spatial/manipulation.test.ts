import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SemanticId } from '@/lib/semantic-id';
import type {
  ExplodedGroup,
  SpatialLayer,
  SpatialModelGraph,
  SpatialObject,
} from '@/types/domain/spatial';
import { TransformStateManager } from '@/engine/3d/transform-state';
import { MaterialStateManager } from '@/engine/3d/materials/material-state';
import { deriveCapabilities, resolveCapabilities } from './capabilities';
import { completeLayer, peelSequence } from './layers';
import {
  INITIAL_MANIPULATION,
  explodedOffsets,
  isPristine,
  maxPeelLevel,
  nextReconstructionStage,
  peeledLayers,
  reconstructOnce,
  withinAny,
} from './manipulation';
import { ManipulationHistory } from './manipulation-history';
import { SceneController } from './scene-controller';
import type { SceneNode } from './object-registry';

/**
 * Spatial manipulation tests.
 *
 * The properties that make manipulation trustworthy: nothing is destroyed,
 * every operation is reversible, contradictory requests resolve the same way
 * every time, and a restore returns the model to exactly what the asset
 * described rather than approximately.
 */

const ROOT = 'veo.diagnostic.rig' as SemanticId;
const SYS_A = 'veo.diagnostic.rig.system_a' as SemanticId;
const SYS_B = 'veo.diagnostic.rig.system_b' as SemanticId;
const A1 = 'veo.diagnostic.rig.system_a.object_1' as SemanticId;
const A2 = 'veo.diagnostic.rig.system_a.object_2' as SemanticId;
const B1 = 'veo.diagnostic.rig.system_b.object_3' as SemanticId;
const B2 = 'veo.diagnostic.rig.system_b.object_4' as SemanticId;
const GHOST = 'veo.diagnostic.rig.absent' as SemanticId;

const LAYER_SHELL = 'shell';
const LAYER_FRAME = 'frame';
const LAYER_CORE = 'core';

function node(name: string, isMesh = false): SceneNode {
  return { name, parent: null, children: [], userData: {}, isMesh };
}

function descriptor(semanticId: SemanticId, overrides: Partial<SpatialObject> = {}): SpatialObject {
  return {
    id: semanticId,
    modelId: 'rig',
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

function layer(id: string, objectIds: readonly SemanticId[], order: number, peelable = true): SpatialLayer {
  return completeLayer({
    id,
    modelId: 'rig',
    name: id,
    description: null,
    objectIds,
    defaultVisible: true,
    order,
    peelable,
    colorToken: null,
  });
}

/**
 * A rig with layers that cut across the hierarchy.
 *
 * Shell holds one object from each system, as a real model does. A fixture
 * whose layers mirrored its systems would make the two indistinguishable and
 * would test neither.
 */
function graphFixture(options: { explosion?: readonly ExplodedGroup[] } = {}): SpatialModelGraph {
  const objects = new Map<SemanticId, SpatialObject>([
    [ROOT, descriptor(ROOT, { kind: 'group', childIds: [SYS_A, SYS_B] })],
    [SYS_A, descriptor(SYS_A, { kind: 'group', parentId: ROOT, childIds: [A1, A2] })],
    [SYS_B, descriptor(SYS_B, { kind: 'group', parentId: ROOT, childIds: [B1, B2] })],
    [A1, descriptor(A1, { parentId: SYS_A, explodedOffset: [-2, 0, 0] })],
    [A2, descriptor(A2, { parentId: SYS_A })],
    [B1, descriptor(B1, { parentId: SYS_B })],
    [B2, descriptor(B2, { parentId: SYS_B })],
  ]);

  return {
    model: {
      id: 'rig',
      domain: 'diagnostic',
      name: 'Rig',
      description: null,
      thumbnailUrl: null,
      provider: 'test',
      providerRef: 'rig',
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
    layers: [
      layer(LAYER_SHELL, [A1, B1], 0),
      layer(LAYER_FRAME, [A2, B2], 1),
      layer(LAYER_CORE, [], 2, false),
    ],
    regions: [],
    relationships: [],
    ...(options.explosion ? { explosion: options.explosion } : {}),
  };
}

/** Controller with the rig loaded and every leaf registered to a node. */
function rig(options: { explosion?: readonly ExplodedGroup[] } = {}) {
  const controller = new SceneController();
  controller.setGraph(graphFixture(options));

  const nodes = new Map<SemanticId, SceneNode>();
  for (const id of [A1, A2, B1, B2]) {
    const mesh = node(id, true);
    controller.registry.register(id, mesh);
    nodes.set(id, mesh);
  }

  return { controller, nodes };
}

const stateOf = (controller: SceneController, id: SemanticId) =>
  controller.getSnapshot().visual.states.get(id);

// ---------------------------------------------------------------- state ----

describe('manipulation state', () => {
  it('starts pristine and reports it', () => {
    expect(isPristine(INITIAL_MANIPULATION)).toBe(true);
    expect(isPristine({ ...INITIAL_MANIPULATION, peelLevel: 1 })).toBe(false);
    expect(isPristine({ ...INITIAL_MANIPULATION, exploded: true })).toBe(false);
  });

  it('treats a structure and its subtree as one for removal', () => {
    expect(withinAny(A1, [SYS_A])).toBe(true);
    expect(withinAny(SYS_A, [SYS_A])).toBe(true);
    expect(withinAny(B1, [SYS_A])).toBe(false);
    expect(withinAny(A1, [])).toBe(false);
  });
});

// ------------------------------------------------------------ hide/show ----

describe('object visibility', () => {
  it('hides and shows an object', () => {
    const { controller } = rig();

    expect(controller.hideObject(A1)).toBe(true);
    expect(stateOf(controller, A1)).toBe('hidden');

    expect(controller.showObject(A1)).toBe(true);
    expect(stateOf(controller, A1)).toBe('default');
  });

  it('toggles visibility', () => {
    const { controller } = rig();

    controller.toggleObjectVisibility(A1);
    expect(stateOf(controller, A1)).toBe('hidden');

    controller.toggleObjectVisibility(A1);
    expect(stateOf(controller, A1)).toBe('default');
  });

  it('hides a whole subtree when a grouping structure is hidden', () => {
    const { controller } = rig();
    controller.hideObject(SYS_A);

    expect(stateOf(controller, A1)).toBe('hidden');
    expect(stateOf(controller, A2)).toBe('hidden');
    expect(stateOf(controller, B1)).toBe('default');
  });

  it('never unregisters what it hides', () => {
    const { controller } = rig();
    controller.hideObject(A1);

    // The semantic object is untouched: still registered, still described,
    // still navigable. Hidden means not drawn, not gone.
    expect(controller.registry.isValid(A1)).toBe(true);
    expect(controller.getObject(A1)?.name).toBe('object_1');
    expect(controller.registry.getParent(A1)).toBe(SYS_A);
    expect(controller.registry.getAncestors(A1)).toEqual([SYS_A, ROOT]);
  });

  it('refuses an id the loaded model does not contain', () => {
    const { controller } = rig();
    expect(controller.hideObject(GHOST)).toBe(false);
    expect(controller.showObject(GHOST)).toBe(false);
    expect(controller.ghostObject(GHOST)).toBe(false);
  });

  it('treats hide and ghost as mutually exclusive', () => {
    const { controller } = rig();

    controller.ghostObject(A1);
    expect(stateOf(controller, A1)).toBe('ghosted');

    controller.hideObject(A1);
    expect(stateOf(controller, A1)).toBe('hidden');

    controller.ghostObject(A1);
    expect(stateOf(controller, A1)).toBe('ghosted');
  });
});

// --------------------------------------------------------------- layers ----

describe('layers', () => {
  it('hides, ghosts and restores a layer', () => {
    const { controller } = rig();

    controller.hideLayer(LAYER_SHELL);
    expect(controller.getLayerState(LAYER_SHELL)).toBe('hidden');
    expect(stateOf(controller, A1)).toBe('hidden');
    expect(stateOf(controller, B1)).toBe('hidden');
    expect(stateOf(controller, A2)).toBe('default');

    controller.ghostLayer(LAYER_SHELL);
    expect(controller.getLayerState(LAYER_SHELL)).toBe('ghosted');
    expect(stateOf(controller, A1)).toBe('ghosted');

    controller.restoreLayer(LAYER_SHELL);
    expect(controller.getLayerState(LAYER_SHELL)).toBe('visible');
    expect(stateOf(controller, A1)).toBe('default');
  });

  it('toggles between visible and hidden', () => {
    const { controller } = rig();

    controller.toggleLayer(LAYER_FRAME);
    expect(controller.getLayerState(LAYER_FRAME)).toBe('hidden');

    controller.toggleLayer(LAYER_FRAME);
    expect(controller.getLayerState(LAYER_FRAME)).toBe('visible');
  });

  it('operates across the hierarchy, not down it', () => {
    // Shell holds one object from each system. Hiding it must not behave like
    // hiding a system, or the two operations would be the same thing.
    const { controller } = rig();
    controller.hideLayer(LAYER_SHELL);

    expect(stateOf(controller, A1)).toBe('hidden');
    expect(stateOf(controller, B1)).toBe('hidden');
    expect(stateOf(controller, A2)).toBe('default');
    expect(stateOf(controller, B2)).toBe('default');
  });

  it('keeps a layer operation independent of registration', () => {
    const { controller } = rig();
    controller.hideLayer(LAYER_SHELL);

    expect(controller.registry.isValid(A1)).toBe(true);
    expect(controller.registry.hasGeometry(A1)).toBe(true);
    expect(controller.search('object_1')[0]?.semanticId).toBe(A1);
  });

  it('indexes membership rather than scanning every object', () => {
    // A layer operation on a large model must not walk the whole graph. The
    // observable form of that is the membership index the controller builds
    // once per model.
    const many = new Map<SemanticId, SpatialObject>();
    const ids: SemanticId[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const id = `veo.diagnostic.rig.bulk.object_${i}` as SemanticId;
      ids.push(id);
      many.set(id, descriptor(id));
    }

    const controller = new SceneController();
    controller.setGraph({
      ...graphFixture(),
      objects: many,
      layers: [layer(LAYER_SHELL, ids, 0)],
    });

    const started = performance.now();
    controller.hideLayer(LAYER_SHELL);
    controller.showLayer(LAYER_SHELL);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(250);
  });
});

// ------------------------------------------------------------ isolation ----

describe('isolation', () => {
  it('keeps context faintly present rather than deleting it', () => {
    const { controller } = rig();
    controller.isolate(SYS_A);

    expect(stateOf(controller, A1)).toBe('isolated');
    expect(stateOf(controller, A2)).toBe('isolated');
    expect(stateOf(controller, B1)).toBe('ghosted');
    expect(controller.registry.isValid(B1)).toBe(true);
  });

  it('holds the selection through isolation', () => {
    const { controller } = rig();
    controller.select(A1);
    controller.isolate(A1);

    expect(controller.getSnapshot().selectedId).toBe(A1);
    expect(controller.getObject(A1)?.name).toBe('object_1');
  });

  it('restores without erasing what was hidden by hand first', () => {
    // The defect this prevents: isolation writing itself into the hidden set,
    // so restoring it un-hides a structure the learner hid deliberately.
    const { controller } = rig();
    controller.hideObject(B2);
    controller.isolate(SYS_A);
    controller.restoreIsolation();

    expect(controller.getIsolatedId()).toBeNull();
    expect(stateOf(controller, B1)).toBe('default');
    expect(stateOf(controller, B2)).toBe('hidden');
  });

  it('refuses an id outside the model', () => {
    const { controller } = rig();
    expect(controller.isolate(GHOST)).toBe(false);
    expect(controller.getIsolatedId()).toBeNull();
  });
});

// ----------------------------------------------------------------- peel ----

describe('peel', () => {
  it('derives its steps from the model rather than a constant', () => {
    const graph = graphFixture();
    expect(maxPeelLevel(graph.layers)).toBe(2);
    expect(peelSequence(graph.layers).map((l) => l.id)).toEqual([LAYER_SHELL, LAYER_FRAME]);

    // The core is not peelable, so a peel can never empty the viewport.
    expect(peeledLayers(graph.layers, 99).has(LAYER_CORE)).toBe(false);
  });

  it('reveals layers in order and stops at the end', () => {
    const { controller } = rig();
    expect(controller.getPeelSteps()).toBe(2);

    expect(controller.nextPeel()).toBe(true);
    expect(stateOf(controller, A1)).toBe('peeled');
    expect(stateOf(controller, A2)).toBe('default');

    expect(controller.nextPeel()).toBe(true);
    expect(stateOf(controller, A2)).toBe('peeled');

    expect(controller.nextPeel()).toBe(false);
    expect(controller.getPeelLevel()).toBe(2);
  });

  it('reverses and stops at whole', () => {
    const { controller } = rig();
    controller.nextPeel();
    controller.nextPeel();

    expect(controller.previousPeel()).toBe(true);
    expect(stateOf(controller, A2)).toBe('default');

    expect(controller.previousPeel()).toBe(true);
    expect(controller.previousPeel()).toBe(false);
    expect(controller.getPeelLevel()).toBe(0);
  });

  it('leaves no residue across next/next/previous/reset/next/reset', () => {
    const { controller } = rig();

    controller.nextPeel();
    controller.nextPeel();
    controller.previousPeel();
    controller.resetPeel();
    controller.nextPeel();
    controller.resetPeel();

    expect(controller.getPeelLevel()).toBe(0);
    expect(controller.getPeeledLayerIds()).toEqual([]);
    for (const id of [A1, A2, B1, B2]) {
      expect(stateOf(controller, id)).toBe('default');
      expect(controller.registry.isValid(id)).toBe(true);
    }
  });

  it('never unregisters what it peels away', () => {
    const { controller } = rig();
    controller.nextPeel();

    expect(controller.registry.isValid(A1)).toBe(true);
    expect(controller.registry.hasGeometry(A1)).toBe(true);
    expect(controller.getObject(A1)).not.toBeNull();
  });

  it('honours a layer that peels by hiding rather than ghosting', () => {
    const controller = new SceneController();
    controller.setGraph({
      ...graphFixture(),
      layers: [
        completeLayer({
          id: LAYER_SHELL,
          modelId: 'rig',
          name: 'shell',
          description: null,
          objectIds: [A1, B1],
          defaultVisible: true,
          order: 0,
          peelMode: 'hide',
          colorToken: null,
        }),
        layer(LAYER_FRAME, [A2, B2], 1),
      ],
    });

    controller.nextPeel();
    expect(stateOf(controller, A1)).toBe('hidden');
  });
});

// ----------------------------------------------------------- dissection ----

describe('dissection', () => {
  it('removes a structure and reveals what it covered', () => {
    const { controller } = rig();
    controller.dissectObject(A1);

    expect(stateOf(controller, A1)).toBe('dissected');
    expect(stateOf(controller, A2)).toBe('default');
  });

  it('preserves everything semantic about what it removed', () => {
    const { controller } = rig();
    controller.dissectObject(A1);

    expect(controller.registry.isValid(A1)).toBe(true);
    expect(controller.getObject(A1)?.name).toBe('object_1');
    expect(controller.registry.getParent(A1)).toBe(SYS_A);
    expect(controller.registry.getChildren(SYS_A)).toContain(A1);
    expect(controller.search('object_1')[0]?.semanticId).toBe(A1);
  });

  it('keeps a stack and undoes it one at a time', () => {
    const { controller } = rig();
    controller.dissectObject(A1);
    controller.dissectObject(A2);
    controller.dissectObject(B1);

    expect(controller.getDissectedIds()).toEqual([A1, A2, B1]);

    expect(controller.restoreDissection()).toBe(B1);
    expect(controller.getDissectedIds()).toEqual([A1, A2]);

    expect(controller.restoreDissection()).toBe(A2);
    expect(controller.getDissectedIds()).toEqual([A1]);

    controller.resetDissection();
    expect(controller.getDissectedIds()).toEqual([]);
    expect(stateOf(controller, A1)).toBe('default');
  });

  it('returns null when there is nothing left to restore', () => {
    const { controller } = rig();
    expect(controller.restoreDissection()).toBeNull();
  });

  it('dissecting the same structure twice changes nothing', () => {
    const { controller } = rig();
    controller.dissectObject(A1);
    controller.dissectObject(A1);
    expect(controller.getDissectedIds()).toEqual([A1]);
  });

  it('takes the subtree with it', () => {
    const { controller } = rig();
    controller.dissectObject(SYS_A);

    expect(stateOf(controller, A1)).toBe('dissected');
    expect(stateOf(controller, A2)).toBe('dissected');
    expect(stateOf(controller, B1)).toBe('default');
  });
});

// -------------------------------------------------------- exploded view ----

describe('exploded view', () => {
  const group: ExplodedGroup = {
    id: 'b',
    objectIds: [B1, B2],
    center: [0, 0, 0],
    scale: 1.5,
    spacing: 0.8,
  };

  it('uses a declared offset when the model supplies one', () => {
    const offsets = explodedOffsets(graphFixture().objects, [], () => null);
    expect(offsets.get(A1)).toEqual([-2, 0, 0]);
    expect(offsets.has(A2)).toBe(false);
  });

  it('derives an offset radially from a group centre', () => {
    const centers = new Map<SemanticId, readonly [number, number, number]>([
      [B1, [2, 0, 0]],
      [B2, [0, -2, 0]],
    ]);
    const offsets = explodedOffsets(
      graphFixture().objects,
      [group],
      (id) => centers.get(id) ?? null,
    );

    // delta*(scale-1) + delta*(spacing/|delta|) = 2*0.5 + 0.8 = 1.8
    expect(offsets.get(B1)?.[0]).toBeCloseTo(1.8, 6);
    expect(offsets.get(B2)?.[1]).toBeCloseTo(-1.8, 6);
  });

  it('leaves a part at the centre where it is', () => {
    // There is no direction to move it in, and picking an axis would be a
    // guess presented as information.
    const offsets = explodedOffsets(
      graphFixture().objects,
      [group],
      () => [0, 0, 0] as const,
    );
    expect(offsets.has(B1)).toBe(false);
  });

  it('is deterministic', () => {
    const centers = new Map<SemanticId, readonly [number, number, number]>([[B1, [2, 0, 0]]]);
    const resolve = (id: SemanticId) => centers.get(id) ?? null;
    const first = explodedOffsets(graphFixture().objects, [group], resolve);
    const second = explodedOffsets(graphFixture().objects, [group], resolve);

    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it('enters and leaves through the controller', () => {
    const { controller } = rig({ explosion: [group] });

    expect(controller.isExploded()).toBe(false);
    expect(controller.enterExplodedView()).toBe(true);
    expect(controller.isExploded()).toBe(true);
    expect(controller.getExplodedOffsets().get(A1)).toEqual([-2, 0, 0]);

    controller.exitExplodedView();
    expect(controller.isExploded()).toBe(false);
    expect(controller.getExplodedOffsets().size).toBe(0);
  });

  it('refuses to explode a model with nothing declared', () => {
    const controller = new SceneController();
    const graph = graphFixture();
    const bare = new Map(graph.objects);
    bare.set(A1, descriptor(A1, { parentId: SYS_A }));
    controller.setGraph({ ...graph, objects: bare });

    expect(controller.getCapabilities().supportsExplosion).toBe(false);
    expect(controller.enterExplodedView()).toBe(false);
  });
});

// ----------------------------------------------------- transform safety ----

describe('transform safety', () => {
  it('restores the authored position exactly', () => {
    const transforms = new TransformStateManager();
    const mesh = new THREE.Mesh();
    mesh.position.set(1.1, -2.2, 3.3);
    const authored = mesh.position.clone();

    transforms.apply(mesh, [0.7, 0.7, 0.7]);
    expect(mesh.position.x).toBeCloseTo(1.8, 6);

    transforms.reset(mesh);
    expect(mesh.position.x).toBe(authored.x);
    expect(mesh.position.y).toBe(authored.y);
    expect(mesh.position.z).toBe(authored.z);
  });

  it('returns to the authored position after many cycles, without drift', () => {
    // Applying and subtracting an offset would accumulate floating-point
    // error; assigning the stored base cannot.
    const transforms = new TransformStateManager();
    const mesh = new THREE.Mesh();
    mesh.position.set(0.1, 0.2, 0.3);

    for (let cycle = 0; cycle < 100; cycle += 1) {
      transforms.apply(mesh, [0.37, -0.11, 0.59]);
      transforms.reset(mesh);
    }

    expect(mesh.position.x).toBe(0.1);
    expect(mesh.position.y).toBe(0.2);
    expect(mesh.position.z).toBe(0.3);
  });

  it('tracks the base transform once, not per application', () => {
    const transforms = new TransformStateManager();
    const mesh = new THREE.Mesh();
    mesh.position.set(1, 0, 0);

    transforms.apply(mesh, [1, 0, 0]);
    transforms.apply(mesh, [2, 0, 0]);
    transforms.apply(mesh, [3, 0, 0]);

    expect(transforms.baseOf(mesh)?.x).toBe(1);
    expect(mesh.position.x).toBe(4);
    expect(transforms.stats).toEqual({ tracked: 1, displaced: 1 });
  });

  it('reports no change when the offset is unchanged', () => {
    const transforms = new TransformStateManager();
    const mesh = new THREE.Mesh();

    expect(transforms.apply(mesh, [1, 1, 1])).toBe(true);
    expect(transforms.apply(mesh, [1, 1, 1])).toBe(false);
  });

  it('restores everything on disposal', () => {
    const transforms = new TransformStateManager();
    const a = new THREE.Mesh();
    const b = new THREE.Mesh();
    a.position.set(5, 0, 0);
    b.position.set(0, 5, 0);

    transforms.apply(a, [1, 0, 0]);
    transforms.apply(b, [0, 1, 0]);
    transforms.dispose();

    expect(a.position.x).toBe(5);
    expect(b.position.y).toBe(5);
    expect(transforms.stats).toEqual({ tracked: 0, displaced: 0 });
  });
});

// ------------------------------------------------------- reconstruction ----

describe('reconstruction', () => {
  it('retraces the learner\'s path in reverse', () => {
    const state = {
      ...INITIAL_MANIPULATION,
      dissectedIds: [A1, A2],
      hiddenIds: new Set([B1]),
      peelLevel: 1,
      isolatedId: SYS_A,
      hiddenLayerIds: new Set([LAYER_SHELL]),
    };

    expect(nextReconstructionStage(state)).toBe('dissection');
    const afterOne = reconstructOnce(state);
    expect(afterOne.dissectedIds).toEqual([A1]);

    const afterTwo = reconstructOnce(afterOne);
    expect(afterTwo.dissectedIds).toEqual([]);
    expect(nextReconstructionStage(afterTwo)).toBe('hidden');
  });

  it('reaches pristine and then reports nothing left', () => {
    let state = {
      ...INITIAL_MANIPULATION,
      dissectedIds: [A1],
      hiddenIds: new Set([B1]),
      ghostedIds: new Set([B2]),
      peelLevel: 2,
      isolatedId: SYS_A,
      hiddenLayerIds: new Set([LAYER_SHELL]),
      exploded: true,
    };

    for (let step = 0; step < 20; step += 1) state = reconstructOnce(state) as typeof state;

    expect(isPristine(state)).toBe(true);
    expect(nextReconstructionStage(state)).toBeNull();
  });

  it('steps through the controller and keeps the selection', () => {
    const { controller } = rig();
    controller.select(A2);
    controller.dissectObject(A1);

    expect(controller.getNextReconstructionStage()).toBe('dissection');
    expect(controller.reconstructStep()).toBe(true);
    expect(stateOf(controller, A1)).toBe('default');
    expect(controller.getSnapshot().selectedId).toBe(A2);

    expect(controller.reconstructStep()).toBe(false);
  });

  it('reconstructs everything at once without losing the learner\'s place', () => {
    const { controller } = rig();
    controller.select(A2);
    controller.hideObject(B1);
    controller.ghostObject(B2);
    controller.nextPeel();
    controller.isolate(SYS_A);

    controller.reconstructAll();

    expect(controller.getSnapshot().selectedId).toBe(A2);
    for (const id of [A1, B1, B2]) expect(stateOf(controller, id)).toBe('default');
  });
});

// ---------------------------------------------------------------- reset ----

describe('reset', () => {
  it('returns every axis to its default', () => {
    const { controller } = rig({
      explosion: [{ id: 'b', objectIds: [B1], center: [0, 0, 0], scale: 2, spacing: 1 }],
    });

    controller.select(A1);
    controller.hideObject(B1);
    controller.ghostObject(B2);
    controller.dissectObject(A2);
    controller.isolate(SYS_A);
    controller.hideLayer(LAYER_SHELL);
    controller.nextPeel();
    controller.enterExplodedView();

    controller.resetScene();
    const snapshot = controller.getSnapshot();

    expect(snapshot.selectedId).toBeNull();
    expect(isPristine(snapshot.manipulation)).toBe(true);
    expect(controller.getExplodedOffsets().size).toBe(0);
    for (const id of [A1, A2, B1, B2]) expect(stateOf(controller, id)).toBe('default');
  });

  it('is idempotent', () => {
    const { controller } = rig();
    controller.hideObject(A1);
    controller.nextPeel();

    controller.resetScene();
    const once = controller.getSnapshot().manipulation;

    controller.resetScene();
    const twice = controller.getSnapshot().manipulation;

    expect(twice).toEqual(once);
    expect(isPristine(twice)).toBe(true);
  });

  it('clears history, because a reset is a fresh start', () => {
    const { controller } = rig();
    controller.hideObject(A1);
    expect(controller.canUndo()).toBe(true);

    controller.resetScene();
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(false);
  });

  it('resetToOriginal is the same operation', () => {
    const { controller } = rig();
    controller.hideObject(A1);
    controller.resetToOriginal();

    expect(isPristine(controller.getSnapshot().manipulation)).toBe(true);
  });
});

// -------------------------------------------------------------- history ----

describe('manipulation history', () => {
  it('undoes and redoes a sequence', () => {
    const { controller } = rig();

    controller.hideObject(A1);
    controller.ghostObject(B1);
    controller.nextPeel();

    expect(controller.canUndo()).toBe(true);
    controller.undoManipulation();
    expect(controller.getPeelLevel()).toBe(0);
    expect(stateOf(controller, B1)).toBe('ghosted');

    controller.undoManipulation();
    expect(stateOf(controller, B1)).toBe('default');
    expect(stateOf(controller, A1)).toBe('hidden');

    controller.undoManipulation();
    expect(stateOf(controller, A1)).toBe('default');
    expect(controller.canUndo()).toBe(false);

    controller.redoManipulation();
    expect(stateOf(controller, A1)).toBe('hidden');
  });

  it('drops the abandoned future when a new action follows an undo', () => {
    const { controller } = rig();
    controller.hideObject(A1);
    controller.hideObject(B1);
    controller.undoManipulation();

    controller.ghostObject(A2);
    expect(controller.canRedo()).toBe(false);
    expect(stateOf(controller, B1)).toBe('default');
    expect(stateOf(controller, A2)).toBe('ghosted');
  });

  it('restores the selection that was in force', () => {
    const { controller } = rig();
    controller.select(A1);
    controller.hideObject(A1);

    // Hiding the selection invalidates it, and undo puts it back.
    expect(controller.getSnapshot().selectedId).toBeNull();
    controller.undoManipulation();
    expect(controller.getSnapshot().selectedId).toBeNull();
  });

  it('is bounded', () => {
    const history = new ManipulationHistory(3);
    for (let i = 0; i < 10; i += 1) {
      history.push({ action: 'hide', state: INITIAL_MANIPULATION, selectedId: null });
    }
    expect(history.length).toBe(3);
  });

  it('reports nothing to undo on an untouched model', () => {
    const { controller } = rig();
    expect(controller.undoManipulation()).toBe(false);
    expect(controller.redoManipulation()).toBe(false);
  });
});

// ------------------------------------------------------- capabilities ------

describe('capability discovery', () => {
  it('derives from the graph', () => {
    const capabilities = deriveCapabilities(graphFixture());

    expect(capabilities.supportsLayers).toBe(true);
    expect(capabilities.supportsPeeling).toBe(true);
    expect(capabilities.supportsIsolation).toBe(true);
    expect(capabilities.supportsDissection).toBe(true);
    expect(capabilities.supportsExplosion).toBe(true);
    expect(capabilities.supportsReconstruction).toBe(true);
  });

  it('reports nothing for no model', () => {
    const capabilities = deriveCapabilities(null);
    expect(capabilities.supportsLayers).toBe(false);
    expect(capabilities.supportsReconstruction).toBe(false);
  });

  it('refuses to peel a model with one peelable layer', () => {
    const graph = graphFixture();
    const capabilities = deriveCapabilities({
      ...graph,
      layers: [layer(LAYER_SHELL, [A1], 0)],
    });
    expect(capabilities.supportsPeeling).toBe(false);
  });

  it('lets a model switch a capability off', () => {
    const graph = graphFixture();
    const restricted = resolveCapabilities({
      ...graph,
      model: { ...graph.model, capabilities: { supportsDissection: false } },
    });

    expect(restricted.supportsDissection).toBe(false);
    expect(restricted.supportsLayers).toBe(true);
  });

  it('never lets a model switch a capability on', () => {
    // A manifest cannot assert its way into a feature it has no data for:
    // that is exactly the button that appears and then does nothing.
    const graph = graphFixture();
    const claimed = resolveCapabilities({
      ...graph,
      layers: [],
      model: { ...graph.model, capabilities: { supportsLayers: true, supportsPeeling: true } },
    });

    expect(claimed.supportsLayers).toBe(false);
    expect(claimed.supportsPeeling).toBe(false);
  });
});

// ------------------------------------------------------- precedence --------

describe('precedence between contradictory requests', () => {
  it('isolated and hidden: hidden wins', () => {
    const { controller } = rig();
    controller.isolate(SYS_A);
    controller.hideObject(A1);
    expect(stateOf(controller, A1)).toBe('hidden');
  });

  it('isolated and ghosted: isolation wins inside the subtree', () => {
    const { controller } = rig();
    controller.ghostObject(A1);
    controller.isolate(SYS_A);
    expect(stateOf(controller, A1)).toBe('isolated');
  });

  it('selected and hidden: the selection invalidates', () => {
    const { controller } = rig();
    controller.select(A1);
    controller.hideObject(A1);

    expect(controller.getSnapshot().selectedId).toBeNull();
    expect(stateOf(controller, A1)).toBe('hidden');
  });

  it('selected and ghosted: selection wins and survives', () => {
    const { controller } = rig();
    controller.select(A1);
    controller.ghostObject(A1);

    expect(controller.getSnapshot().selectedId).toBe(A1);
    expect(stateOf(controller, A1)).toBe('selected');
  });

  it('peeled and isolated: peel wins', () => {
    const { controller } = rig();
    controller.nextPeel();
    controller.isolate(SYS_A);
    expect(stateOf(controller, A1)).toBe('peeled');
  });

  it('dissected and selected: the selection invalidates', () => {
    const { controller } = rig();
    controller.select(A1);
    controller.dissectObject(A1);

    expect(controller.getSnapshot().selectedId).toBeNull();
    expect(stateOf(controller, A1)).toBe('dissected');
  });

  it('dissected beats every other removal', () => {
    const { controller } = rig();
    controller.hideLayer(LAYER_SHELL);
    controller.nextPeel();
    controller.dissectObject(A1);
    expect(stateOf(controller, A1)).toBe('dissected');
  });

  it('a hand-hidden structure stays hidden when its layer comes back', () => {
    // Explicit intent beats an incidental consequence: turning a layer on
    // must not silently undo a decision the learner made deliberately.
    const { controller } = rig();
    controller.hideObject(A1);
    controller.hideLayer(LAYER_SHELL);
    controller.showLayer(LAYER_SHELL);

    expect(stateOf(controller, A1)).toBe('hidden');
    expect(stateOf(controller, B1)).toBe('default');
  });

  it('exploded and reset: reset wins and clears the displacement', () => {
    const { controller } = rig({
      explosion: [{ id: 'b', objectIds: [B1], center: [0, 0, 0], scale: 2, spacing: 1 }],
    });
    controller.enterExplodedView();
    controller.resetScene();

    expect(controller.isExploded()).toBe(false);
    expect(controller.getExplodedOffsets().size).toBe(0);
  });

  it('an object in two layers stays visible while either is on', () => {
    const controller = new SceneController();
    controller.setGraph({
      ...graphFixture(),
      layers: [layer(LAYER_SHELL, [A1], 0), layer(LAYER_FRAME, [A1], 1)],
    });

    controller.hideLayer(LAYER_SHELL);
    expect(stateOf(controller, A1)).toBe('default');

    controller.hideLayer(LAYER_FRAME);
    expect(stateOf(controller, A1)).toBe('hidden');
  });
});

// ------------------------------------------------- material reuse ----------

describe('material safety under manipulation', () => {
  it('allocates one override per mesh across the whole manipulation sequence', () => {
    // hover -> select -> ghost -> restore -> dissect -> restore -> reset
    const materials = new MaterialStateManager();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x223344 }),
    );
    const authored = mesh.material as THREE.MeshStandardMaterial;
    const authoredColor = authored.color.getHex();

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const state of ['hovered', 'selected', 'ghosted', 'default', 'dissected', 'default', 'peeled', 'default'] as const) {
        materials.apply(mesh, state);
      }
    }

    expect(materials.overrideCount).toBe(1);
    expect(materials.trackedCount).toBe(1);
    expect(mesh.material).toBe(authored);
    expect(authored.color.getHex()).toBe(authoredColor);
    expect(authored.transparent).toBe(false);
  });

  it('hides a dissected mesh and brings it back', () => {
    const materials = new MaterialStateManager();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());

    materials.apply(mesh, 'dissected');
    expect(mesh.visible).toBe(false);

    materials.apply(mesh, 'default');
    expect(mesh.visible).toBe(true);
  });
});
