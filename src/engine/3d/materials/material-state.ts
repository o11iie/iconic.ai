import * as THREE from 'three';
import type { VisualState } from '@/engine/spatial/types';
import { styleFor } from '@/engine/spatial/visual-state';

/**
 * Material State Manager
 * ======================
 *
 * Applies VEO visual states to meshes without ever mutating the asset's
 * authored materials.
 *
 * The naive approach — clone the material each time state changes — is what
 * makes viewers degrade over a session. Every hover allocates a material, and
 * nothing disposes them until unmount, so a minute of moving the pointer
 * across a model leaves hundreds of orphaned GPU resources behind.
 *
 * This manager instead creates AT MOST ONE override material per mesh, lazily,
 * and mutates that single instance on subsequent state changes. Restoring is a
 * reference swap back to the original, so repeated selection changes can never
 * accumulate corruption, and disposal is bounded and complete.
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

/** Live material bookkeeping. Read by diagnostics to prove nothing leaks. */
export interface MaterialStats {
  /** Override materials currently allocated by VEO. */
  readonly overrides: number;
  /** Meshes whose authored material is being tracked. */
  readonly tracked: number;
}

interface MeshRecord {
  /** The asset's authored material. Never mutated, never disposed by us. */
  readonly original: THREE.Material | THREE.Material[];
  /** Single reusable override. Created on first non-default state. */
  override: THREE.MeshStandardMaterial | null;
  state: VisualState;
}

export class MaterialStateManager {
  private readonly records = new Map<THREE.Mesh, MeshRecord>();
  private readonly palette: VisualColorPalette;

  constructor(palette: VisualColorPalette = DEFAULT_PALETTE) {
    this.palette = palette;
  }

  /** Number of override materials currently allocated. Used by leak tests. */
  get overrideCount(): number {
    let count = 0;
    for (const record of this.records.values()) if (record.override) count += 1;
    return count;
  }

  get trackedCount(): number {
    return this.records.size;
  }

  get stats(): MaterialStats {
    return { overrides: this.overrideCount, tracked: this.trackedCount };
  }

  stateOf(mesh: THREE.Mesh): VisualState {
    return this.records.get(mesh)?.state ?? 'default';
  }

  /**
   * Apply a visual state to a mesh.
   *
   * Returns true when anything changed, so callers can decide whether the
   * frame needs re-rendering — important under an on-demand frame loop.
   */
  apply(mesh: THREE.Mesh, state: VisualState): boolean {
    let record = this.records.get(mesh);

    if (!record) {
      record = { original: mesh.material, override: null, state: 'default' };
      this.records.set(mesh, record);
    }

    if (record.state === state) return false;
    record.state = state;

    const style = styleFor(state);
    mesh.visible = style.visible;

    if (state === 'default') {
      // Reference swap back. The authored material was never touched.
      mesh.material = record.original;
      return true;
    }

    if (!style.visible) {
      // Hidden geometry needs no material work at all.
      return true;
    }

    const override = record.override ?? this.createOverride(record.original);
    record.override = override;

    override.transparent = style.transparent;
    override.opacity = style.opacity;
    override.depthWrite = style.depthWrite;

    if (state === 'ghosted') {
      override.color.set(this.palette.muted);
      override.emissive.set(0x000000);
      override.emissiveIntensity = 0;
    } else {
      const base = firstOf(record.original);
      if (base instanceof THREE.MeshStandardMaterial) {
        override.color.copy(base.color);
      } else {
        override.color.set(this.palette.surface);
      }
      override.emissive.set(this.palette[style.colorToken]);
      override.emissiveIntensity = style.emissiveIntensity;
    }

    override.needsUpdate = true;
    mesh.material = override;
    return true;
  }

  /** Return one mesh to its authored material. */
  restore(mesh: THREE.Mesh): void {
    const record = this.records.get(mesh);
    if (!record) return;

    mesh.material = record.original;
    mesh.visible = true;
    record.state = 'default';
  }

  /** Return every tracked mesh to its authored material. */
  restoreAll(): void {
    for (const [mesh] of this.records) this.restore(mesh);
  }

  /**
   * Release every override material.
   *
   * Originals belong to the asset and are disposed by the scene's own
   * disposal pass, not here — disposing them twice would break a shared
   * material still used by another mesh.
   */
  dispose(): void {
    for (const record of this.records.values()) {
      record.override?.dispose();
      record.override = null;
    }
    this.records.clear();
  }

  /** Forget a mesh, e.g. when it is removed from the scene. */
  forget(mesh: THREE.Mesh): void {
    const record = this.records.get(mesh);
    if (!record) return;
    record.override?.dispose();
    this.records.delete(mesh);
  }

  private createOverride(original: THREE.Material | THREE.Material[]): THREE.MeshStandardMaterial {
    const base = firstOf(original);

    if (base instanceof THREE.MeshStandardMaterial) {
      // Clone once, so maps and PBR parameters carry over and the highlighted
      // structure still reads as the same material.
      return base.clone();
    }

    return new THREE.MeshStandardMaterial({
      color: this.palette.surface,
      roughness: 0.65,
      metalness: 0.05,
    });
  }
}

function firstOf(material: THREE.Material | THREE.Material[]): THREE.Material | undefined {
  return Array.isArray(material) ? material[0] : material;
}
