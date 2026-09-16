import type { SemanticId } from '@/lib/semantic-id';
import { isDescendantOf } from '@/lib/semantic-id';
import type { SceneVisualState, VisualState } from './types';

/**
 * Visual state resolution.
 *
 * Keeping this a pure function of (selection, hover, highlight, hidden,
 * isolated, layers) means the renderer never has to guess, and the rules are
 * unit-testable without a WebGL context.
 *
 * Precedence, highest first:
 *   1. hidden           — explicitly hidden by the user
 *   2. isolation        — outside the isolated subtree: ghosted if explicitly
 *                         ghosted (context preserved), otherwise hidden
 *   3. layer visibility — object belongs to a hidden layer
 *   4. selected
 *   5. hovered
 *   6. highlighted      — e.g. related structures, search results
 *   7. ghosted          — de-emphasised context
 *   8. default
 */

export interface VisualStateInput {
  readonly objectIds: readonly SemanticId[];
  readonly selectedId: SemanticId | null;
  readonly hoveredId: SemanticId | null;
  readonly highlightedIds: ReadonlySet<SemanticId>;
  readonly hiddenIds: ReadonlySet<SemanticId>;
  readonly ghostedIds: ReadonlySet<SemanticId>;
  readonly isolatedId: SemanticId | null;
  readonly hiddenLayerIds: ReadonlySet<string>;
  /** semantic id -> the layers it belongs to. */
  readonly layerMembership: ReadonlyMap<SemanticId, readonly string[]>;
}

export function resolveVisualState(input: VisualStateInput): SceneVisualState {
  const states = new Map<SemanticId, VisualState>();

  for (const id of input.objectIds) {
    states.set(id, resolveObjectVisualState(id, input));
  }

  return {
    states,
    isolatedId: input.isolatedId,
    hiddenLayerIds: input.hiddenLayerIds,
  };
}

export function resolveObjectVisualState(
  id: SemanticId,
  input: VisualStateInput,
): VisualState {
  if (input.hiddenIds.has(id)) return 'hidden';

  if (input.isolatedId !== null) {
    const inIsolatedSubtree = id === input.isolatedId || isDescendantOf(id, input.isolatedId);
    if (!inIsolatedSubtree) {
      // Outside the isolated subtree. Ghost wins over hide when the object was
      // explicitly ghosted: keeping faint context is what stops a learner
      // losing their bearings the moment they isolate something.
      return input.ghostedIds.has(id) ? 'ghosted' : 'hidden';
    }
  }

  const layers = input.layerMembership.get(id);
  if (layers && layers.length > 0 && layers.every((layer) => input.hiddenLayerIds.has(layer))) {
    return 'hidden';
  }

  if (input.selectedId === id) return 'selected';
  if (input.hoveredId === id) return 'hovered';
  if (input.highlightedIds.has(id)) return 'highlighted';
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
  ghosted: {
    opacity: 0.12,
    transparent: true,
    emissiveIntensity: 0,
    // Ghosted geometry must not occlude what sits behind it.
    depthWrite: false,
    visible: true,
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
 * Isolation helper: everything that is NOT in the isolated subtree becomes
 * ghosted rather than hidden when `ghostContext` is true, which preserves
 * spatial orientation — you can still see where the structure sits.
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
