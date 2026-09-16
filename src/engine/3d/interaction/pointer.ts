import type { SemanticId } from '@/lib/semantic-id';
import type { SceneNode } from '@/engine/spatial/object-registry';
import { resolveSelectable } from '@/engine/spatial/object-registry';

/**
 * Pointer interaction rules.
 *
 * Pure, so the awkward parts — what counts as a click versus a drag, which
 * object a hit resolves to, whether a mode allows selection — are testable
 * without a canvas.
 */

export type PointerPhase = 'move' | 'down' | 'up' | 'leave';

/**
 * Distance in CSS pixels a pointer may travel between down and up and still
 * count as a click.
 *
 * Without this, orbiting the camera selects whatever happened to be under the
 * pointer when the drag ended — the single most irritating bug in 3D viewers.
 */
export const CLICK_SLOP_PX = 6;

export interface PointerOrigin {
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

/** True when a press-and-release should be treated as a click, not a drag. */
export function isClick(
  origin: PointerOrigin | null,
  end: { x: number; y: number },
  slop = CLICK_SLOP_PX,
): boolean {
  if (!origin) return false;
  return Math.hypot(end.x - origin.x, end.y - origin.y) <= slop;
}

/**
 * Resolve which structure a raycast hit belongs to.
 *
 * Returns the nearest tagged ancestor, so a selectable child inside a tagged
 * group wins over the group. `known` filters out identities that are not in
 * the current registry, which is what stops a stale tag left on a node from a
 * previous model resolving to something that no longer exists.
 */
export function resolveHit(
  node: SceneNode | null,
  known: (id: SemanticId) => boolean,
): SemanticId | null {
  const id = resolveSelectable(node);
  return id !== null && known(id) ? id : null;
}

/** Interaction modes that permit changing selection via the pointer. */
const SELECTING_MODES = new Set(['inspect', 'isolate', 'annotate']);

export function modeAllowsSelection(mode: string): boolean {
  return SELECTING_MODES.has(mode);
}

/** Interaction modes that permit hover feedback. */
export function modeAllowsHover(mode: string): boolean {
  // Orbit deliberately suppresses hover: highlighting structures while the
  // learner is moving the camera is noise, not information.
  return modeAllowsSelection(mode);
}

/**
 * Decide the next selection from a click.
 *
 * Clicking empty space clears selection rather than leaving a stale highlight;
 * clicking the already-selected structure keeps it selected rather than
 * toggling, because toggling makes double-clicks lose the selection.
 */
export function nextSelection(
  current: SemanticId | null,
  hit: SemanticId | null,
): SemanticId | null {
  if (hit === null) return null;
  return hit;
}

export { resolveSelectable };
export type { SceneNode };
