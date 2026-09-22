import type { SceneController } from '@/engine/spatial/scene-controller';
import type { SemanticId } from '@/lib/semantic-id';
import type { SpatialActionKind } from '../context/spatial-context';
import type { ValidatedSpatialAction } from '../tutor/tutor-types';

/**
 * Dispatching a tutor-proposed action into the scene.
 *
 * The AI never touches three.js. It proposes an intent; this dispatcher
 * decides whether the intent is permissible right now, and if so expresses it
 * as a call on the SceneController — the same authority every other surface
 * goes through. The renderer is downstream of that and stays unaware the
 * request came from a model at all.
 *
 *     AI → validated SpatialAction → dispatcher → SceneController → renderer
 *
 * Gate 7 established that there is ONE source of truth for scene state. An AI
 * that mutated the scene directly would be a second one, and the first thing
 * it would break is undo.
 *
 * ## Validated twice, deliberately
 *
 * The server's grounding pass already dropped actions that were unsupported or
 * targeted unknown ids. This checks again, against the LIVE controller, because
 * the two checks answer different questions at different times: the server
 * checked what was true when the answer was generated, and this checks what is
 * true now. A learner can switch models while a response is in flight.
 */

export const ACTION_REJECTIONS = [
  'no_controller',
  'unsupported_capability',
  'unknown_structure',
  'unknown_layer',
  'missing_target',
] as const;
export type ActionRejection = (typeof ACTION_REJECTIONS)[number];

export type DispatchResult =
  | { readonly ok: true; readonly kind: SpatialActionKind }
  | { readonly ok: false; readonly reason: ActionRejection; readonly message: string };

const REJECTION_MESSAGES: Record<ActionRejection, string> = {
  no_controller: 'No model is open.',
  unsupported_capability: 'This model does not support that.',
  unknown_structure: 'That structure is not in the model currently open.',
  unknown_layer: 'That layer is not part of the model currently open.',
  missing_target: 'That action needs a target VEO did not receive.',
};

function reject(reason: ActionRejection): DispatchResult {
  return { ok: false, reason, message: REJECTION_MESSAGES[reason] };
}

export interface DispatchOptions {
  /** Animation duration. Zero when the learner prefers reduced motion. */
  readonly durationMs?: number;
}

/**
 * Perform one validated action.
 *
 * Returns a result rather than throwing: an action the scene cannot perform is
 * an expected outcome — the model proposed something reasonable that no longer
 * applies — and the UI shows it as a disabled control, not an error.
 */
export function dispatchSpatialAction(
  controller: SceneController | null,
  action: ValidatedSpatialAction,
  options: DispatchOptions = {},
): DispatchResult {
  if (!controller) return reject('no_controller');

  const capabilities = controller.getCapabilities();
  const duration = options.durationMs ?? 600;

  switch (action.kind) {
    case 'SELECT_STRUCTURE': {
      if (!capabilities.supportsSelection) return reject('unsupported_capability');
      const id = requireStructure(controller, action.semanticId);
      if (!id) return reject('unknown_structure');
      controller.select(id);
      return { ok: true, kind: action.kind };
    }

    case 'FOCUS_STRUCTURE': {
      if (!capabilities.supportsSelection) return reject('unsupported_capability');
      const id = requireStructure(controller, action.semanticId);
      if (!id) return reject('unknown_structure');
      // Select as well as fly: focusing something without selecting it leaves
      // the context panel describing a structure the camera has left behind.
      controller.select(id);
      controller.focusObject(id, { durationMs: duration });
      return { ok: true, kind: action.kind };
    }

    case 'ISOLATE_STRUCTURE': {
      if (!capabilities.supportsIsolation) return reject('unsupported_capability');
      const id = requireStructure(controller, action.semanticId);
      if (!id) return reject('unknown_structure');
      controller.isolateObject(id, { durationMs: duration });
      return { ok: true, kind: action.kind };
    }

    case 'SHOW_LAYER':
    case 'HIDE_LAYER': {
      if (!capabilities.supportsLayers) return reject('unsupported_capability');
      if (!action.layerId) return reject('missing_target');
      const known = controller.getLayers().some((layer) => layer.id === action.layerId);
      if (!known) return reject('unknown_layer');

      if (action.kind === 'SHOW_LAYER') controller.showLayer(action.layerId);
      else controller.hideLayer(action.layerId);
      return { ok: true, kind: action.kind };
    }

    case 'RESET_VIEW': {
      controller.resetScene({ durationMs: duration });
      return { ok: true, kind: action.kind };
    }
  }
}

/**
 * Resolve a structure id against the live registry.
 *
 * `isSelectable` is the controller's own answer to "is this a thing a learner
 * can act on", so an id that is present in the graph but not selectable — a
 * grouping node with no geometry — is correctly refused here rather than
 * producing a select that silently does nothing.
 */
function requireStructure(
  controller: SceneController,
  semanticId: SemanticId | null,
): SemanticId | null {
  if (!semanticId) return null;
  return controller.isSelectable(semanticId) ? semanticId : null;
}

/**
 * Whether an action would currently succeed.
 *
 * Used by the UI to render a proposed action as available or unavailable
 * before the learner clicks it, so a dead control is never presented as a live
 * one. Runs the same checks as the dispatcher without performing anything.
 */
export function canDispatch(
  controller: SceneController | null,
  action: ValidatedSpatialAction,
): boolean {
  if (!controller) return false;
  const capabilities = controller.getCapabilities();

  switch (action.kind) {
    case 'SELECT_STRUCTURE':
    case 'FOCUS_STRUCTURE':
      return capabilities.supportsSelection && requireStructure(controller, action.semanticId) !== null;
    case 'ISOLATE_STRUCTURE':
      return capabilities.supportsIsolation && requireStructure(controller, action.semanticId) !== null;
    case 'SHOW_LAYER':
    case 'HIDE_LAYER':
      return (
        capabilities.supportsLayers &&
        action.layerId !== null &&
        controller.getLayers().some((layer) => layer.id === action.layerId)
      );
    case 'RESET_VIEW':
      return true;
  }
}
