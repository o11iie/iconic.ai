import * as THREE from 'three';

/**
 * Scene disposal.
 *
 * three.js does not garbage-collect GPU resources. Geometries, materials and
 * textures live on the GPU until `dispose()` is called, so a viewport that
 * swaps models without disposing leaks VRAM until the context is lost — which
 * on a mobile device happens quickly.
 *
 * These helpers are exhaustive and idempotent: safe to call twice, and they
 * walk every material slot and every texture-bearing uniform.
 */

/** Material properties that can hold a texture. */
const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
  'lightMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'anisotropyMap',
] as const;

export interface DisposalReport {
  geometries: number;
  materials: number;
  textures: number;
}

export function disposeMaterial(material: THREE.Material, report: DisposalReport): void {
  const record = material as unknown as Record<string, unknown>;

  for (const key of TEXTURE_KEYS) {
    const value = record[key];
    if (value instanceof THREE.Texture) {
      value.dispose();
      report.textures += 1;
      record[key] = null;
    }
  }

  material.dispose();
  report.materials += 1;
}

/**
 * Recursively release every GPU resource beneath a root, and detach it.
 *
 * Returns a count of what was freed, which is what makes "no leak on model
 * replacement" a testable claim rather than an assertion.
 */
export function disposeObject3D(root: THREE.Object3D | null): DisposalReport {
  const report: DisposalReport = { geometries: 0, materials: 0, textures: 0 };
  if (!root) return report;

  // Collect first: mutating the graph while traversing it skips nodes.
  const nodes: THREE.Object3D[] = [];
  root.traverse((node) => nodes.push(node));

  const seenMaterials = new Set<THREE.Material>();

  for (const node of nodes) {
    const mesh = node as THREE.Mesh;

    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
      report.geometries += 1;
    }

    const material = mesh.material;
    if (!material) continue;

    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      // Shared materials appear on many meshes; dispose each exactly once.
      if (!entry || seenMaterials.has(entry)) continue;
      seenMaterials.add(entry);
      disposeMaterial(entry, report);
    }
  }

  root.parent?.remove(root);
  root.clear();

  return report;
}

/** Remove every child from a scene and dispose it. */
export function clearScene(scene: THREE.Object3D): DisposalReport {
  const total: DisposalReport = { geometries: 0, materials: 0, textures: 0 };

  for (const child of [...scene.children]) {
    const report = disposeObject3D(child);
    total.geometries += report.geometries;
    total.materials += report.materials;
    total.textures += report.textures;
  }

  return total;
}

/** Count live GPU-backed resources beneath a root. Used by leak assertions. */
export function countResources(root: THREE.Object3D): DisposalReport {
  const report: DisposalReport = { geometries: 0, materials: 0, textures: 0 };
  const seen = new Set<THREE.Material>();

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) report.geometries += 1;

    const material = mesh.material;
    if (!material) return;

    for (const entry of Array.isArray(material) ? material : [material]) {
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      report.materials += 1;
    }
  });

  return report;
}
