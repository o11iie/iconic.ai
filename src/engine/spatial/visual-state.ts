import type { SemanticId } from '@/lib/semantic-id';
import { isDescendantOf } from '@/lib/semantic-id';
import { withinAny } from './manipulation';
import type { SceneVisualState, VisualState } from './types';

/**
 * Visual state resolution.
 *
 * A pure function of everything the learner has asked for. The renderer never
 * decides anything and never guesses, and every rule here is unit-testable
 * without a WebGL context.
 *
 * Precedence, highest first. The first rule that matches wins.
 *
 *   1. dissected         — removed by the learner (subtree)
 *   2. hidden            — hidden by the learner (subtree)
 *   3. peeled            — its layer has been peeled away (subtree)
 *   4. layer hidden      — every layer it belongs to is hidden
 *   5. outside isolation — ghosted as context, or hidden
 *   6. selected
 *   7. hovered
 *   8. highlighted
 *   9. isolated          — inside the isolated subtree
 *  10. layer ghosted     — every layer it belongs to is ghosted
 *  11. ghosted           — ghosted by the learner
 *  12. default
 *
 * Two principles decide that order, and they are worth stating because every
 * future addition has to fit them:
 *
 *   Removal beats emphasis. Highlighting something the learner cannot see
 *   communicates nothing, and a selected-but-invisible object is the kind of
 *   contradiction that makes a viewport impossible to reason about.
 *
 *   Explicit intent beats incidental consequence. A structure the learner hid
 *   by hand stays hidden when its layer is switched back on; otherwise turning
 *   a layer on would silently undo a decision they made deliberately.
 */

export interface VisualStateInput {
  readonly objectIds: readonly SemanticId[];
  readonly selectedId: SemanticId | null;
  readonly hoveredId: SemanticId | null;
  readonly highlightedIds: ReadonlySet<SemanticId>;
  readonly hiddenIds: ReadonlySet<SemanticId>;
  readonly ghostedIds: ReadonlySet<SemanticId>;
  readonly dissectedIds?: readonly SemanticId[];
  readonly isolatedId: SemanticId | null;
  readonly hiddenLayerIds: ReadonlySet<string>;
  readonly ghostedLayerIds?: ReadonlySet<string>;
  /** Layer id -> what peeling it does. Absent means nothing is peeled. */
  readonly peeledLayers?: ReadonlyMap<string, 'ghost' | 'hide'>;
  /** semantic id -> the layers it belongs to. */
  readonly layerMembership: ReadonlyMap<SemanticId, readonly string[]>;
  /**
   * Ghost the surroundings on isolate rather than hiding them.
   *
   * Defaults to false: this function resolves state, it does not choose
   * policy. The controller owns that choice and passes it in, so a caller
   * reasoning about the rules here is not also reasoning about a default
   * decided somewhere else.
   */
  readonly ghostContextOnIsolate?: boolean;
}

const NO_IDS: readonly SemanticId[] = [];
const NO_LAYERS: ReadonlySet<string> = new Set<string>();

export function resolveVisualState(input: VisualStateInput): SceneVisualState {
  const states = new Map<SemanticId, VisualState>();

  for (const id of input.objectIds) {
    states.set(id, resolveObjectVisualState(id, input));
  }

  return {
    states,
    isolatedId: input.isolatedId,
    hiddenLayerIds: input.hiddenLayerIds,
    ghostedLayerIds: input.ghostedLayerIds ?? NO_LAYERS,
    peelLevel: input.peeledLayers?.size ?? 0,
    dissectedIds: input.dissectedIds ?? NO_IDS,
    exploded: false,
  };
}

export function resolveObjectVisualState(id: SemanticId, input: VisualStateInput): VisualState {
  const dissected = input.dissectedIds ?? NO_IDS;

  // 1-2. Explicit removal, applied to the whole subtree. Removing an assembly
  // that still showed its own parts would be incoherent.
  if (dissected.length > 0 && withinAny(id, dissected)) return 'dissected';
  if (input.hiddenIds.size > 0 && withinAny(id, input.hiddenIds)) return 'hidden';

  const layers = input.layerMembership.get(id);

  // 3. Peeled away. The layer decides whether that means gone or faint.
  const peeled = input.peeledLayers;
  if (peeled && peeled.size > 0 && layers && layers.length > 0) {
    const modes = layers.map((layer) => peeled.get(layer)).filter(Boolean);
    if (modes.length === layers.length) {
      return modes.includes('hide') ? 'hidden' : 'peeled';
    }
  }

  // 4. Every layer it belongs to is off. An object in two layers stays visible
  // while either is on: a layer is a way of looking, not an owner.
  if (layers && layers.length > 0 && layers.every((layer) => input.hiddenLayerIds.has(layer))) {
    return 'hidden';
  }

  // 5. Outside the isolated subtree.
  if (input.isolatedId !== null) {
    const inIsolatedSubtree = id === input.isolatedId || isDescendantOf(id, input.isolatedId);
    if (!inIsolatedSubtree) {
      // Faint context is what stops a learner losing their bearings the moment
      // they isolate something. An explicit ghost keeps it visible either way.
      const ghostContext = input.ghostContextOnIsolate ?? false;
      return ghostContext || input.ghostedIds.has(id) ? 'ghosted' : 'hidden';
    }
  }

  // 6-8. Emphasis.
  if (input.selectedId === id) return 'selected';
  if (input.hoveredId === id) return 'hovered';
  if (input.highlightedIds.has(id)) return 'highlighted';

  // 9. The subject of isolation, when nothing more specific applies.
  if (input.isolatedId !== null) return 'isolated';

  // 10-11. De-emphasis.
  const ghostedLayers = input.ghostedLayerIds;
  if (
    ghostedLayers &&
    ghostedLayers.size > 0 &&
    layers &&
    layers.length > 0 &&
    layers.every((layer) => ghostedLayers.has(layer))
  ) {
    return 'ghosted';
  }
  if (input.ghostedIds.has(id)) return 'ghosted';

  return 'default';
}

/** Rendering parameters for each state. Consumed by the material layer. */
export interface VisualStyle {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly emissiveIntensity: number;
  readonly depthWrite: boolean;
  readonly visible: boolean;
  /** Design-token name resolved to a real colour by the renderer. */
  readonly colorToken: 'surface' | 'accent' | 'accentSecondary' | 'highlight' | 'muted';
}

export const VISUAL_STYLES: Record<VisualState, VisualStyle> = {
  default: {
    opacity: 1,
    transparent: false,
    emissiveIntensity: 0,
    depthWrite: true,
    visible: true,
    colorToken: 'surface',
  },
  hovered: {
    opacity: 1,
    transparent: false,
    emissiveIntensity: 0.28,
    depthWrite: true,
    visible: true,
    colorToken: 'accentSecondary',
  },
  selected: {
    opacity: 1,
    transparent: false,
    emissiveIntensity: 0.55,
    depthWrite: true,
    visible: true,
    colorToken: 'accent',
  },
  highlighted: {
    opacity: 1,
    transparent: false,
    emissiveIntensity: 0.35,
    depthWrite: true,
    visible: true,
    colorToken: 'highlight',
  },
  isolated: {
    // The subject of isolation reads as ordinary content, not as an effect.
    // Everything around it is already faint; emphasising it as well would
    // leave the learner looking at a glow rather than a structure.
    opacity: 1,
    transparent: false,
    emissiveIntensity: 0.1,
    depthWrite: true,
    visible: true,
    colorToken: 'surface',
  },
  ghosted: {
    opacity: 0.12,
    transparent: true,
    emissiveIntensity: 0,
    // Ghosted geometry must not occlude what sits behind it.
    depthWrite: false,
    visible: true,
    colorToken: 'muted',
  },
  peeled: {
    // Fainter than a ghost: a peeled layer is meant to be read as an outline
    // of what was there, not as content competing with what it revealed. Any
    // fainter and it disappears on a bright display, which would make peel and
    // hide indistinguishable.
    opacity: 0.06,
    transparent: true,
    emissiveIntensity: 0,
    depthWrite: false,
    visible: true,
    colorToken: 'muted',
  },
  dissected: {
    opacity: 0,
    transparent: true,
    emissiveIntensity: 0,
    depthWrite: false,
    visible: false,
    colorToken: 'muted',
  },
  hidden: {
    opacity: 0,
    transparent: true,
    emissiveIntensity: 0,
    depthWrite: false,
    visible: false,
    colorToken: 'muted',
  },
};

export function styleFor(state: VisualState): VisualStyle {
  return VISUAL_STYLES[state];
}

/**
 * Isolation helper kept for callers that want the sets up front.
 *
 * The controller does NOT use this: isolation is resolved from `isolatedId` at
 * render time rather than written into the hidden and ghosted sets, so
 * restoring it cannot erase a structure the learner hid by hand.
 */
export function computeIsolationSets(
  objectIds: readonly SemanticId[],
  isolatedId: SemanticId,
  ghostContext: boolean,
): { hidden: Set<SemanticId>; ghosted: Set<SemanticId> } {
  const hidden = new Set<SemanticId>();
  const ghosted = new Set<SemanticId>();

  for (const id of objectIds) {
    if (id === isolatedId || isDescendantOf(id, isolatedId)) continue;
    if (ghostContext) {
      ghosted.add(id);
    } else {
      hidden.add(id);
    }
  }

  return { hidden, ghosted };
}
