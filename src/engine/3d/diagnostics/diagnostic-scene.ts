import * as THREE from 'three';
import { buildSemanticId, type SemanticId } from '@/lib/semantic-id';
import { tagNode } from '@/engine/spatial/object-registry';
import type {
  Relationship,
  SpatialLayer,
  SpatialModel,
  SpatialModelGraph,
  SpatialObject,
} from '@/types/domain/spatial';

/**
 * ============================================================================
 * VEO SPATIAL ENGINE TEST — DIAGNOSTIC CONTENT, NOT A SUBJECT MODEL
 * ============================================================================
 *
 * A calibration rig, not a model of anything. Its purpose is to exercise the
 * whole semantic pipeline end to end — registry, raycast resolution,
 * hierarchy, relationships, search, labels, camera targeting and disposal — on
 * a machine where no licensed asset is configured.
 *
 * Its nodes are abstract geometric primitives with engineering names (System A
 * / Object 1, …) under the reserved `veo.diagnostic` namespace. They are not,
 * and must never be presented as, anatomy or any other subject. `diagnostic`
 * is intentionally NOT a knowledge domain, so nothing in the learning
 * catalogue can reference these ids.
 *
 * VEO does not substitute generated geometry for licensed subject models. A
 * model made of primitives would look complete while teaching nothing true.
 * This scene exists so engineers can verify the engine, and it is labelled as
 * such wherever it is mounted.
 *
 * It produces a real `SpatialModelGraph` and takes exactly the same path as a
 * manifest-loaded asset. Verifying the engine against a scene that bypassed
 * the production path would prove nothing.
 * ============================================================================
 */

export const DIAGNOSTIC_DOMAIN = 'diagnostic';
export const DIAGNOSTIC_MODEL_REF = '__veo_spatial_engine_test__';
export const DIAGNOSTIC_MODEL_ID = '00000000-0000-4000-8000-00000000d1a6';
export const DIAGNOSTIC_LABEL = 'VEO SPATIAL ENGINE TEST';

const id = (...path: string[]): SemanticId => buildSemanticId(DIAGNOSTIC_DOMAIN, ...path);

/** Root, two systems, and four objects — enough to exercise real hierarchy. */
export const DIAGNOSTIC_IDS = {
  root: id('test_scene'),
  systemA: id('test_scene', 'system_a'),
  systemB: id('test_scene', 'system_b'),
  object1: id('test_scene', 'system_a', 'object_1'),
  object2: id('test_scene', 'system_a', 'object_2'),
  object3: id('test_scene', 'system_b', 'object_3'),
  object4: id('test_scene', 'system_b', 'object_4'),
} as const;

export interface DiagnosticNodeSpec {
  readonly semanticId: SemanticId;
  readonly label: string;
  readonly parentId: SemanticId;
  readonly position: [number, number, number];
  readonly kind: 'box' | 'sphere' | 'torus' | 'cone';
  readonly system: string;
  readonly region: string;
  readonly color: string;
}

/**
 * Renderable nodes.
 *
 * Four distinct forms at known positions: distinct shapes make it obvious at a
 * glance which node is selected, and known positions make fit-to-selection
 * verifiable by eye as well as by assertion.
 */
export const DIAGNOSTIC_NODES: readonly DiagnosticNodeSpec[] = [
  {
    semanticId: DIAGNOSTIC_IDS.object1,
    label: 'Object 1',
    parentId: DIAGNOSTIC_IDS.systemA,
    position: [-1.15, 0, 0],
    kind: 'box',
    system: 'system_a',
    region: 'quadrant_west',
    color: '#64748b',
  },
  {
    semanticId: DIAGNOSTIC_IDS.object2,
    label: 'Object 2',
    parentId: DIAGNOSTIC_IDS.systemA,
    position: [0, 1.2, 0],
    kind: 'torus',
    system: 'system_a',
    region: 'quadrant_north',
    color: '#64748b',
  },
  {
    semanticId: DIAGNOSTIC_IDS.object3,
    label: 'Object 3',
    parentId: DIAGNOSTIC_IDS.systemB,
    position: [1.15, 0, 0],
    kind: 'sphere',
    system: 'system_b',
    region: 'quadrant_east',
    color: '#64748b',
  },
  {
    semanticId: DIAGNOSTIC_IDS.object4,
    label: 'Object 4',
    parentId: DIAGNOSTIC_IDS.systemB,
    position: [0, -1.2, 0],
    kind: 'cone',
    system: 'system_b',
    region: 'quadrant_south',
    color: '#64748b',
  },
];

/** Grouping nodes. They carry hierarchy but no geometry of their own. */
const DIAGNOSTIC_GROUPS: readonly {
  semanticId: SemanticId;
  label: string;
  parentId: SemanticId | null;
  system: string | null;
}[] = [
  { semanticId: DIAGNOSTIC_IDS.root, label: 'Test Scene', parentId: null, system: null },
  { semanticId: DIAGNOSTIC_IDS.systemA, label: 'System A', parentId: DIAGNOSTIC_IDS.root, system: 'system_a' },
  { semanticId: DIAGNOSTIC_IDS.systemB, label: 'System B', parentId: DIAGNOSTIC_IDS.root, system: 'system_b' },
];

/** Typed edges, proving relationship resolution across and within systems. */
const DIAGNOSTIC_RELATIONSHIPS: readonly {
  source: SemanticId;
  target: SemanticId;
  kind: string;
  label: string;
  bidirectional: boolean;
}[] = [
  {
    source: DIAGNOSTIC_IDS.object1,
    target: DIAGNOSTIC_IDS.object2,
    kind: 'adjacent_to',
    label: 'Object 2',
    bidirectional: true,
  },
  {
    source: DIAGNOSTIC_IDS.object1,
    target: DIAGNOSTIC_IDS.object3,
    kind: 'connects_to',
    label: 'Object 3',
    bidirectional: true,
  },
  {
    source: DIAGNOSTIC_IDS.object3,
    target: DIAGNOSTIC_IDS.object4,
    kind: 'contains',
    label: 'Object 4',
    bidirectional: false,
  },
];

function geometryFor(kind: DiagnosticNodeSpec['kind']): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(0.9, 0.9, 0.9);
    case 'sphere':
      return new THREE.SphereGeometry(0.55, 32, 24);
    case 'torus':
      return new THREE.TorusGeometry(0.42, 0.16, 20, 48);
    case 'cone':
      return new THREE.ConeGeometry(0.52, 0.95, 32);
    default:
      return new THREE.BoxGeometry(0.9, 0.9, 0.9);
  }
}

function emptyObject(
  semanticId: SemanticId,
  name: string,
  parentId: SemanticId | null,
  childIds: readonly SemanticId[],
  system: string | null,
): SpatialObject {
  return {
    id: semanticId,
    modelId: DIAGNOSTIC_MODEL_ID,
    semanticId,
    name,
    kind: 'group',
    parentId,
    childIds,
    system,
    region: null,
    layerIds: system ? [system] : [],
    providerMeshNames: [],
    boundingBox: null,
    description: null,
    synonyms: [],
    metadata: { diagnostic: true },
  };
}

/**
 * The diagnostic model's semantic graph.
 *
 * A genuine `SpatialModelGraph`, so it flows through `SceneController.setGraph`
 * exactly as a manifest-loaded model does and exercises the same registry,
 * search index, label seeding and hierarchy code.
 */
export function buildDiagnosticGraph(): SpatialModelGraph {
  const now = new Date().toISOString();
  const objects = new Map<SemanticId, SpatialObject>();

  for (const group of DIAGNOSTIC_GROUPS) {
    const childIds =
      group.semanticId === DIAGNOSTIC_IDS.root
        ? [DIAGNOSTIC_IDS.systemA, DIAGNOSTIC_IDS.systemB]
        : DIAGNOSTIC_NODES.filter((node) => node.parentId === group.semanticId).map(
            (node) => node.semanticId,
          );

    objects.set(
      group.semanticId,
      emptyObject(group.semanticId, group.label, group.parentId, childIds, group.system),
    );
  }

  for (const node of DIAGNOSTIC_NODES) {
    objects.set(node.semanticId, {
      id: node.semanticId,
      modelId: DIAGNOSTIC_MODEL_ID,
      semanticId: node.semanticId,
      name: node.label,
      kind: 'structure',
      parentId: node.parentId,
      childIds: [],
      system: node.system,
      region: node.region,
      layerIds: [node.system],
      providerMeshNames: [node.label],
      boundingBox: null,
      description: `Diagnostic ${node.kind} used to verify selection, hierarchy, relationships and camera targeting. Not subject content.`,
      synonyms: [`${node.kind} node`],
      metadata: { diagnostic: true, primitive: node.kind },
    });
  }

  const layers: SpatialLayer[] = ['system_a', 'system_b'].map((system, index) => ({
    id: system,
    modelId: DIAGNOSTIC_MODEL_ID,
    name: system === 'system_a' ? 'System A' : 'System B',
    description: 'Diagnostic layer',
    objectIds: DIAGNOSTIC_NODES.filter((node) => node.system === system).map(
      (node) => node.semanticId,
    ),
    defaultVisible: true,
    order: index,
    colorToken: null,
  }));

  const relationships: Relationship[] = DIAGNOSTIC_RELATIONSHIPS.map((edge, index) => ({
    id: `${DIAGNOSTIC_MODEL_ID}:rel:${index}`,
    sourceId: edge.source,
    targetId: edge.target,
    kind: edge.kind,
    label: edge.label,
    bidirectional: edge.bidirectional,
    confidence: 1,
    metadata: {},
  }));

  const model: SpatialModel = {
    id: DIAGNOSTIC_MODEL_ID,
    domain: DIAGNOSTIC_DOMAIN,
    name: DIAGNOSTIC_LABEL,
    description: 'Abstract calibration scene for engine verification. Not subject content.',
    thumbnailUrl: null,
    provider: 'diagnostic',
    providerRef: DIAGNOSTIC_MODEL_REF,
    rootObjectId: DIAGNOSTIC_IDS.root,
    assetProfile: {
      approximateBytes: null,
      triangleCount: null,
      hasDracoCompression: false,
      hasKtx2Textures: false,
    },
    licence: {
      holder: 'VEO',
      kind: 'veo_owned',
      expiresAt: null,
      attributionRequired: false,
    },
    metadata: { diagnostic: true },
    createdAt: now,
    updatedAt: now,
  };

  return { model, objects, layers, regions: [], relationships };
}

/**
 * The renderable scene.
 *
 * Built imperatively and handed to `SpatialSceneRoot` exactly as a loaded GLTF
 * scene is, so it takes the same registration, interaction, material and
 * disposal path.
 *
 * Group nodes are real `Object3D` groups tagged with their identity, so the
 * nearest-selectable-ancestor rule has something genuine to resolve against:
 * a click on Object 1 must select Object 1, not System A.
 */
export function buildDiagnosticScene(): THREE.Group {
  const root = new THREE.Group();
  root.name = DIAGNOSTIC_LABEL;
  tagNode(root, DIAGNOSTIC_IDS.root);

  const systems = new Map<SemanticId, THREE.Group>();
  for (const group of DIAGNOSTIC_GROUPS) {
    if (group.semanticId === DIAGNOSTIC_IDS.root) continue;
    const node = new THREE.Group();
    node.name = group.label;
    tagNode(node, group.semanticId);
    systems.set(group.semanticId, node);
    root.add(node);
  }

  for (const spec of DIAGNOSTIC_NODES) {
    const mesh = new THREE.Mesh(
      geometryFor(spec.kind),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.55, metalness: 0.08 }),
    );

    mesh.name = spec.label;
    mesh.position.set(...spec.position);
    tagNode(mesh, spec.semanticId);
    (systems.get(spec.parentId) ?? root).add(mesh);
  }

  // Reference frame: orientation and scale while testing the camera. Tagged
  // non-selectable and excluded from raycasting, so clicking one selects
  // nothing — which is itself a behaviour worth verifying.
  const grid = new THREE.GridHelper(6, 12, 0x1e293b, 0x111827);
  grid.position.y = -2;
  grid.raycast = () => {};
  tagNode(grid, null);
  root.add(grid);

  const axes = new THREE.AxesHelper(1.6);
  axes.raycast = () => {};
  tagNode(axes, null);
  root.add(axes);

  return root;
}
