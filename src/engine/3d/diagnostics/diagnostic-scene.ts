import * as THREE from 'three';
import { buildSemanticId, type SemanticId } from '@/lib/semantic-id';
import { tagNode } from '@/engine/spatial/object-registry';

/**
 * ============================================================================
 * VEO SPATIAL ENGINE TEST — DIAGNOSTIC CONTENT, NOT A SUBJECT MODEL
 * ============================================================================
 *
 * This is a calibration rig, not a model of anything. Its only purpose is to
 * exercise the spatial engine end to end — renderer, camera, registry,
 * raycasting, selection, highlighting, visibility and disposal — on a machine
 * where no licensed asset is configured.
 *
 * Its nodes are deliberately abstract geometric primitives with engineering
 * names (Node A, Node B, ...) under the reserved `veo.diagnostic` namespace.
 * They are not, and must never be presented as, anatomy or any other subject.
 * `diagnostic` is intentionally NOT a knowledge domain, so nothing in the
 * learning catalogue can reference these ids.
 *
 * VEO does not substitute generated geometry for licensed subject models. A
 * model made of primitives would look complete while teaching nothing true.
 * This scene exists so engineers can verify the engine, and it is labelled as
 * such wherever it is mounted.
 * ============================================================================
 */

export const DIAGNOSTIC_DOMAIN = 'diagnostic';
export const DIAGNOSTIC_MODEL_REF = '__veo_spatial_engine_test__';
export const DIAGNOSTIC_LABEL = 'VEO SPATIAL ENGINE TEST';

export interface DiagnosticNodeSpec {
  readonly semanticId: SemanticId;
  readonly label: string;
  readonly position: [number, number, number];
  readonly kind: 'box' | 'sphere' | 'torus' | 'cone';
  readonly color: string;
}

/**
 * The diagnostic nodes.
 *
 * Four distinct, individually selectable forms at known positions. Distinct
 * shapes make it obvious at a glance which node is selected; known positions
 * make fit-to-selection verifiable by eye as well as by assertion.
 */
export const DIAGNOSTIC_NODES: readonly DiagnosticNodeSpec[] = [
  {
    semanticId: buildSemanticId(DIAGNOSTIC_DOMAIN, 'test_scene', 'node_a'),
    label: 'Node A',
    position: [-1.1, 0, 0],
    kind: 'box',
    color: '#64748b',
  },
  {
    semanticId: buildSemanticId(DIAGNOSTIC_DOMAIN, 'test_scene', 'node_b'),
    label: 'Node B',
    position: [1.1, 0, 0],
    kind: 'sphere',
    color: '#64748b',
  },
  {
    semanticId: buildSemanticId(DIAGNOSTIC_DOMAIN, 'test_scene', 'node_c'),
    label: 'Node C',
    position: [0, 1.15, 0],
    kind: 'torus',
    color: '#64748b',
  },
  {
    semanticId: buildSemanticId(DIAGNOSTIC_DOMAIN, 'test_scene', 'node_d'),
    label: 'Node D',
    position: [0, -1.15, 0],
    kind: 'cone',
    color: '#64748b',
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

/**
 * Builds the diagnostic scene as a real `THREE.Group`.
 *
 * Constructed imperatively rather than declaratively so it takes exactly the
 * same code path as a loaded GLTF: one root Object3D handed to the scene root,
 * which tags it, registers it and disposes it identically. Testing the engine
 * against a scene that bypasses the production path would prove nothing.
 */
export function buildDiagnosticScene(): THREE.Group {
  const root = new THREE.Group();
  root.name = DIAGNOSTIC_LABEL;

  for (const spec of DIAGNOSTIC_NODES) {
    const mesh = new THREE.Mesh(
      geometryFor(spec.kind),
      new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.55,
        metalness: 0.08,
      }),
    );

    mesh.name = spec.label;
    mesh.position.set(...spec.position);
    tagNode(mesh, spec.semanticId);
    root.add(mesh);
  }

  // Reference frame: a grid and axes, so orientation and scale are readable
  // while testing the camera. Tagged as non-selectable so raycasts ignore them.
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

/**
 * NOTE: there is deliberately no React component here.
 *
 * The diagnostic group is handed to `SpatialSceneRoot` exactly as a loaded
 * GLTF scene is, so it takes the same registration, interaction, material and
 * disposal path. A diagnostic that mounted itself would be testing a code
 * path the product never runs.
 */
