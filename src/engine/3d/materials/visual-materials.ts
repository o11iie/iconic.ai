import * as THREE from 'three';
import { styleFor } from '@/engine/spatial/visual-state';
import type { VisualState } from '@/engine/spatial/types';

/**
 * Applies VEO visual states to three.js materials.
 *
 * Original materials are cached and restored rather than mutated destructively,
 * so toggling isolation or ghosting never permanently degrades a licensed
 * asset's authored appearance.
 */

export interface VisualColorPalette {
  readonly surface: THREE.ColorRepresentation;
  readonly accent: THREE.ColorRepresentation;
  readonly accentSecondary: THREE.ColorRepresentation;
  readonly highlight: THREE.ColorRepresentation;
  readonly muted: THREE.ColorRepresentation;
}

/** Matches the VEO design tokens in globals.css. */
export const DEFAULT_PALETTE: VisualColorPalette = {
  surface: '#c8d2e4',
  accent: '#3b82f6',
  accentSecondary: '#22d3ee',
  highlight: '#818cf8',
  muted: '#64748b',
};

const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

function rememberOriginal(mesh: THREE.Mesh): void {
  if (!originalMaterials.has(mesh)) {
    originalMaterials.set(mesh, mesh.material);
  }
}

/**
 * Apply a visual state to a mesh.
 *
 * `default` restores the asset's authored material exactly; every other state
 * uses a cloned material so the original is never written to.
 */
export function applyVisualState(
  mesh: THREE.Mesh,
  state: VisualState,
  palette: VisualColorPalette = DEFAULT_PALETTE,
): void {
  rememberOriginal(mesh);
  const style = styleFor(state);

  mesh.visible = style.visible;
  if (!style.visible) return;

  if (state === 'default') {
    const original = originalMaterials.get(mesh);
    if (original) mesh.material = original;
    return;
  }

  const base = originalMaterials.get(mesh);
  const source = Array.isArray(base) ? base[0] : base;
  const cloned =
    source instanceof THREE.MeshStandardMaterial
      ? source.clone()
      : new THREE.MeshStandardMaterial({ color: palette.surface, roughness: 0.65, metalness: 0.05 });

  cloned.transparent = style.transparent;
  cloned.opacity = style.opacity;
  cloned.depthWrite = style.depthWrite;

  if (state !== 'ghosted') {
    cloned.emissive = new THREE.Color(palette[style.colorToken]);
    cloned.emissiveIntensity = style.emissiveIntensity;
  } else {
    cloned.color = new THREE.Color(palette.muted);
    cloned.emissiveIntensity = 0;
  }

  cloned.needsUpdate = true;
  mesh.material = cloned;
}

/** Restore every mesh under a root to its authored material. */
export function restoreMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const original = originalMaterials.get(child);
    if (original) child.material = original;
    child.visible = true;
  });
}

/** Free cloned materials. Call on unmount to avoid GPU memory growth. */
export function disposeClonedMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const original = originalMaterials.get(child);
    const current = child.material;
    if (current && current !== original) {
      const materials = Array.isArray(current) ? current : [current];
      for (const material of materials) material.dispose();
    }
  });
}
