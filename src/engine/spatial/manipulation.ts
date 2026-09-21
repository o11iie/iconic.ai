import { isDescendantOf, type SemanticId } from '@/lib/semantic-id';
import type { ExplodedGroup, SpatialLayer, SpatialObject, Vec3 } from '@/types/domain/spatial';
import { peelSequence } from './layers';

/**
 * Spatial manipulation
 * ====================
 *
 * How a learner takes a model apart without taking the MODEL apart.
 *
 * Every operation here is a change of presentation. Nothing is unregistered,
 * no geometry is disposed, no authored material or transform is overwritten,
 * and every semantic object stays queryable throughout. A dissected structure
 * still has a name, a parent and its relationships; it simply is not being
 * drawn at the moment.
 *
 * ## The state
 *
 * Eight fields, each an independent axis of meaning rather than a pile of
 * booleans. Isolation, peeling and layer state are NOT baked into the hidden
 * set when they are applied: they stay as what the learner asked for, and the
 * rendered result is computed from all of them together. That is what makes
 * "restore isolation" leave an unrelated hidden object hidden, and what makes
 * every operation reversible without remembering what it overwrote.
 *
 * ## Precedence
 *
 * Resolution runs in one fixed order and the first rule that matches wins.
 * The order is not arbitrary: removal always beats emphasis, because
 * emphasising something the learner cannot see is meaningless, and explicit
 * intent always beats an incidental consequence, because a learner who hides
 * one structure should not find it reappearing when a layer is turned on.
 *
 *   1. dissected            — the learner removed this structure
 *   2. hidden               — the learner hid this structure
 *   3. peeled               — the structure's layer is peeled away
 *   4. layer hidden         — every layer it belongs to is hidden
 *   5. outside isolation    — ghosted as context, or hidden
 *   6. selected
 *   7. hovered
 *   8. highlighted
 *   9. isolated             — inside the isolated subtree, nothing else applies
 *  10. layer ghosted        — every layer it belongs to is ghosted
 *  11. ghosted              — the learner ghosted this structure
 *  12. default
 *
 * Rules 1, 2 and 3 apply to a structure AND everything beneath it: removing an
 * assembly that still showed its own parts would be incoherent.
 */

/** Everything a learner has done to the presentation of the current model. */
export interface ManipulationState {
  readonly hiddenIds: ReadonlySet<SemanticId>;
  readonly ghostedIds: ReadonlySet<SemanticId>;
  /** Ordered: the last entry is the most recent dissection. */
  readonly dissectedIds: readonly SemanticId[];
  readonly isolatedId: SemanticId | null;
  readonly hiddenLayerIds: ReadonlySet<string>;
  readonly ghostedLayerIds: ReadonlySet<string>;
  /** How many layers of the peel sequence have been removed. */
  readonly peelLevel: number;
  readonly exploded: boolean;
}

export const INITIAL_MANIPULATION: ManipulationState = {
  hiddenIds: new Set(),
  ghostedIds: new Set(),
  dissectedIds: [],
  isolatedId: null,
  hiddenLayerIds: new Set(),
  ghostedLayerIds: new Set(),
  peelLevel: 0,
  exploded: false,
};

/** The semantic intents worth remembering. Never per-frame, never per-pixel. */
export const MANIPULATION_ACTIONS = [
  'hide',
  'show',
  'ghost',
  'isolate',
  'restore_isolation',
  'layer_hide',
  'layer_show',
  'layer_ghost',
  'layer_restore',
  'peel_next',
  'peel_previous',
  'peel_reset',
  'dissect',
  'restore_dissection',
  'reset_dissection',
  'explode',
  'implode',
  'reconstruct_step',
  'reconstruct_all',
  'reset',
] as const;
export type ManipulationAction = (typeof MANIPULATION_ACTIONS)[number];

/** True when nothing has been done to the model's presentation. */
export function isPristine(state: ManipulationState): boolean {
  return (
    state.hiddenIds.size === 0 &&
    state.ghostedIds.size === 0 &&
    state.dissectedIds.length === 0 &&
    state.isolatedId === null &&
    state.hiddenLayerIds.size === 0 &&
    state.ghostedLayerIds.size === 0 &&
    state.peelLevel === 0 &&
    !state.exploded
  );
}

// ---- peeling ---------------------------------------------------------------

/**
 * Which layers the current peel level has removed, and how.
 *
 * The number of steps comes from the model's own layer sequence, never from a
 * constant here: a model with two peelable layers has two peel steps.
 */
export function peeledLayers(
  layers: readonly SpatialLayer[],
  peelLevel: number,
): ReadonlyMap<string, SpatialLayer> {
  const sequence = peelSequence(layers);
  const removed = new Map<string, SpatialLayer>();
  const depth = Math.max(0, Math.min(peelLevel, sequence.length));

  for (let index = 0; index < depth; index += 1) {
    const layer = sequence[index];
    if (layer) removed.set(layer.id, layer);
  }
  return removed;
}

export function maxPeelLevel(layers: readonly SpatialLayer[]): number {
  return peelSequence(layers).length;
}

// ---- exploded view ---------------------------------------------------------

/** Where a structure moves to in an exploded view. */
export type OffsetResolver = (semanticId: SemanticId) => Vec3 | null;

/**
 * Displacements for an exploded view, by semantic id.
 *
 * An object's own declared offset wins. Otherwise, if it belongs to an
 * exploded group, it moves directly away from that group's centre — a
 * deterministic function of positions the model already has.
 *
 * A structure with neither gets no offset at all. VEO does not invent a
 * separation it has no basis for: a made-up explosion looks convincing and
 * teaches something false about how the thing comes apart.
 */
export function explodedOffsets(
  objects: ReadonlyMap<SemanticId, SpatialObject>,
  groups: readonly ExplodedGroup[],
  centerOf: OffsetResolver,
): ReadonlyMap<SemanticId, Vec3> {
  const offsets = new Map<SemanticId, Vec3>();

  for (const [semanticId, object] of objects) {
    const declared = object.explodedOffset;
    if (declared && declared.some((component) => component !== 0)) {
      offsets.set(semanticId, [declared[0], declared[1], declared[2]]);
    }
  }

  for (const group of groups) {
    const origin = group.center ?? groupCenter(group.objectIds, centerOf);
    if (!origin) continue;

    for (const semanticId of group.objectIds) {
      if (offsets.has(semanticId)) continue;

      const center = centerOf(semanticId);
      if (!center) continue;

      const delta: Vec3 = [
        center[0] - origin[0],
        center[1] - origin[1],
        center[2] - origin[2],
      ];
      const length = Math.hypot(delta[0], delta[1], delta[2]);

      // A part sitting exactly at the centre has no direction to move in.
      // Leaving it put is the honest answer; picking an axis would be a guess.
      if (length === 0) continue;

      const push = group.spacing / length;
      offsets.set(semanticId, [
        delta[0] * (group.scale - 1) + delta[0] * push,
        delta[1] * (group.scale - 1) + delta[1] * push,
        delta[2] * (group.scale - 1) + delta[2] * push,
      ]);
    }
  }

  return offsets;
}

function groupCenter(objectIds: readonly SemanticId[], centerOf: OffsetResolver): Vec3 | null {
  let count = 0;
  let x = 0;
  let y = 0;
  let z = 0;

  for (const semanticId of objectIds) {
    const center = centerOf(semanticId);
    if (!center) continue;
    x += center[0];
    y += center[1];
    z += center[2];
    count += 1;
  }

  return count === 0 ? null : [x / count, y / count, z / count];
}

// ---- reconstruction --------------------------------------------------------

/**
 * The order a step-by-step reconstruction puts a model back together.
 *
 * Most recent first, so reconstructing retraces the learner's own path in
 * reverse rather than jumping to an arbitrary intermediate state.
 */
export const RECONSTRUCTION_ORDER = [
  'dissection',
  'hidden',
  'peel',
  'isolation',
  'layers',
  'ghosted',
  'exploded',
] as const;
export type ReconstructionStage = (typeof RECONSTRUCTION_ORDER)[number];

/** The next thing a reconstruction step would undo, or null when whole. */
export function nextReconstructionStage(state: ManipulationState): ReconstructionStage | null {
  if (state.dissectedIds.length > 0) return 'dissection';
  if (state.hiddenIds.size > 0) return 'hidden';
  if (state.peelLevel > 0) return 'peel';
  if (state.isolatedId !== null) return 'isolation';
  if (state.hiddenLayerIds.size > 0) return 'layers';
  if (state.ghostedIds.size > 0 || state.ghostedLayerIds.size > 0) return 'ghosted';
  if (state.exploded) return 'exploded';
  return null;
}

/** Apply one reconstruction step. Returns the same object when already whole. */
export function reconstructOnce(state: ManipulationState): ManipulationState {
  switch (nextReconstructionStage(state)) {
    case 'dissection':
      return { ...state, dissectedIds: state.dissectedIds.slice(0, -1) };
    case 'hidden':
      return { ...state, hiddenIds: new Set() };
    case 'peel':
      return { ...state, peelLevel: state.peelLevel - 1 };
    case 'isolation':
      return { ...state, isolatedId: null };
    case 'layers':
      return { ...state, hiddenLayerIds: new Set() };
    case 'ghosted':
      return { ...state, ghostedIds: new Set(), ghostedLayerIds: new Set() };
    case 'exploded':
      return { ...state, exploded: false };
    default:
      return state;
  }
}

// ---- helpers ---------------------------------------------------------------

/**
 * True when `semanticId` is the subject of one of `roots`, or sits beneath one.
 *
 * Used for the three rules that apply to a whole subtree. Linear in the number
 * of roots rather than the number of objects, because the sets involved are
 * the learner's own actions — a handful, not a model.
 */
export function withinAny(
  semanticId: SemanticId,
  roots: ReadonlySet<SemanticId> | readonly SemanticId[],
): boolean {
  for (const root of roots) {
    if (semanticId === root || isDescendantOf(semanticId, root)) return true;
  }
  return false;
}
