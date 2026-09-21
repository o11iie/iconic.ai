import * as THREE from 'three';

/**
 * Transform state
 * ===============
 *
 * The same contract the material layer holds, for positions.
 *
 * An asset's authored transform is the truth about where a part belongs. A
 * manipulation — an exploded view today, an animated assembly later — is a
 * displacement ON TOP of it, never a replacement for it. Writing the displaced
 * position back into the node would destroy the only record of where the part
 * started, and every subsequent restore would be an approximation.
 *
 * So each node's base position is captured once, the rendered position is
 * always `base + offset`, and restoring assigns the base back by value. That
 * makes restoration exact rather than close: the coordinates after a restore
 * are bit-for-bit the ones the asset shipped, however many times the view has
 * been exploded and collapsed in between.
 */

/**
 * Read-only view of transform bookkeeping.
 *
 * Handed to diagnostics instead of the manager itself: verification needs to
 * see what the authored position was and whether anything is displaced, and
 * has no business moving geometry.
 */
export interface TransformReader {
  readonly stats: () => TransformStats;
  readonly baseOf: (node: THREE.Object3D) => THREE.Vector3 | null;
}

export interface TransformStats {
  /** Nodes whose base transform is being held. */
  readonly tracked: number;
  /** Nodes currently displaced from their base. */
  readonly displaced: number;
}

interface TransformRecord {
  /** The authored position. Captured once, never written to. */
  readonly base: THREE.Vector3;
  /** Current displacement from base. Zero means the node is at rest. */
  readonly offset: THREE.Vector3;
}

export class TransformStateManager {
  private readonly records = new Map<THREE.Object3D, TransformRecord>();

  /** A read-only view, for diagnostics. */
  get reader(): TransformReader {
    return { stats: () => this.stats, baseOf: (node) => this.baseOf(node) };
  }

  get stats(): TransformStats {
    let displaced = 0;
    for (const record of this.records.values()) {
      if (record.offset.lengthSq() > 0) displaced += 1;
    }
    return { tracked: this.records.size, displaced };
  }

  /** The authored position of a node, or null when it is not tracked. */
  baseOf(node: THREE.Object3D): THREE.Vector3 | null {
    return this.records.get(node)?.base.clone() ?? null;
  }

  isDisplaced(node: THREE.Object3D): boolean {
    const record = this.records.get(node);
    return record !== undefined && record.offset.lengthSq() > 0;
  }

  /**
   * Displace a node from its authored position.
   *
   * Returns true when anything moved, so the caller can decide whether the
   * frame needs redrawing — under an on-demand loop that is the difference
   * between idle and busy.
   */
  apply(node: THREE.Object3D, offset: readonly [number, number, number]): boolean {
    let record = this.records.get(node);

    if (!record) {
      // First contact: capture the authored position before anything moves it.
      record = { base: node.position.clone(), offset: new THREE.Vector3() };
      this.records.set(node, record);
    }

    if (
      record.offset.x === offset[0] &&
      record.offset.y === offset[1] &&
      record.offset.z === offset[2]
    ) {
      return false;
    }

    record.offset.set(offset[0], offset[1], offset[2]);
    node.position.copy(record.base).add(record.offset);
    return true;
  }

  /** Return one node to its authored position, exactly. */
  reset(node: THREE.Object3D): boolean {
    const record = this.records.get(node);
    if (!record || record.offset.lengthSq() === 0) return false;

    record.offset.set(0, 0, 0);
    node.position.copy(record.base);
    return true;
  }

  /** Return every tracked node to its authored position, exactly. */
  resetAll(): boolean {
    let changed = false;
    for (const node of this.records.keys()) {
      if (this.reset(node)) changed = true;
    }
    return changed;
  }

  /**
   * Stop tracking, restoring first.
   *
   * Called when the scene is replaced. Leaving a displaced node behind would
   * hand the next disposal pass geometry in a position the asset never
   * described.
   */
  dispose(): void {
    this.resetAll();
    this.records.clear();
  }
}
