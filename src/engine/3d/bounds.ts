import * as THREE from 'three';
import type { BoundingBox, Vec3 } from '@/types/domain/spatial';

/**
 * Bounds derived from live scene content.
 *
 * Every framing decision in VEO — initial view, reset, fit-to-model,
 * fit-to-selection — resolves through here. Nothing hard-codes camera
 * coordinates, which is what makes the same rig work for a diagnostic node and
 * a licensed asset of unknown scale.
 */

const scratchBox = new THREE.Box3();

/** World-space bounds of an object and its descendants, or null if empty. */
export function boundsOf(object: THREE.Object3D | null): BoundingBox | null {
  if (!object) return null;

  // `setFromObject` needs current world matrices; a freshly added node has
  // stale ones until the next render, which yields a box at the origin.
  object.updateWorldMatrix(true, true);
  scratchBox.setFromObject(object);

  if (scratchBox.isEmpty()) return null;

  return {
    min: [scratchBox.min.x, scratchBox.min.y, scratchBox.min.z],
    max: [scratchBox.max.x, scratchBox.max.y, scratchBox.max.z],
  };
}

/** Combined bounds of several objects. */
export function boundsOfAll(objects: readonly THREE.Object3D[]): BoundingBox | null {
  const combined = new THREE.Box3();
  let found = false;

  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) continue;
    combined.union(box);
    found = true;
  }

  if (!found || combined.isEmpty()) return null;

  return {
    min: [combined.min.x, combined.min.y, combined.min.z],
    max: [combined.max.x, combined.max.y, combined.max.z],
  };
}

export function centerOf(box: BoundingBox): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}
