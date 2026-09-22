import type { SemanticId } from '@/lib/semantic-id';
import {
  contextSemanticIds,
  type SpatialActionKind,
  type SpatialContext,
} from '../context/spatial-context';
import type {
  SourceStatus,
  TutorModelOutput,
  TutorResponse,
  ValidatedSpatialAction,
} from '../tutor/tutor-types';

/**
 * Grounding.
 *
 * A schema check proves the model returned the right SHAPE. It says nothing
 * about whether the content refers to anything real. This module is the second
 * check: every structure the model names must be one VEO actually put in front
 * of it, and every action it proposes must be one the scene can perform.
 *
 * ## Why ids are dropped rather than rejected
 *
 * A model asked about a ventricle may produce a good explanation and then
 * invent `veo.anatomy.heart.left_atrium_appendage` in its "related" list. Both
 * failing the whole turn and passing the id through are wrong: the first
 * throws away a correct answer, the second puts a button in the UI that
 * cannot resolve. So unknown ids are dropped, the drop is recorded, and the
 * explanation survives.
 *
 * ## Why sourceStatus is not taken at face value
 *
 * The model reports its own grounding, and a model is not a reliable witness
 * to its own confidence — it has every incentive to claim "grounded". VEO
 * already knows what it supplied, so it can hold the claim to the evidence:
 * a claim of `grounded` about a structure carrying no description at all is
 * downgraded here. The model may report worse than VEO measured, never better.
 */

export interface GroundingResult {
  readonly response: TutorResponse;
  /** What was removed and why. Rendered only in development. */
  readonly notices: readonly string[];
}

/** Which actions carry a structure, which carry a layer, which carry neither. */
const ACTION_TARGET: Record<SpatialActionKind, 'structure' | 'layer' | 'none'> = {
  FOCUS_STRUCTURE: 'structure',
  SELECT_STRUCTURE: 'structure',
  ISOLATE_STRUCTURE: 'structure',
  SHOW_LAYER: 'layer',
  HIDE_LAYER: 'layer',
  RESET_VIEW: 'none',
};

/**
 * Hold the model's self-reported grounding to what VEO measured.
 *
 * `bare` context means VEO supplied a name and a position in a tree. No
 * answer built on that is `grounded`, whatever the model believes.
 */
function reconcileSourceStatus(
  claimed: SourceStatus,
  context: SpatialContext,
): { readonly status: SourceStatus; readonly downgraded: boolean } {
  const ceiling: SourceStatus =
    context.grounding === 'rich'
      ? 'grounded'
      : context.grounding === 'structural'
        ? 'partially-grounded'
        : 'insufficient-context';

  const rank: Record<SourceStatus, number> = {
    'insufficient-context': 0,
    'partially-grounded': 1,
    grounded: 2,
  };

  if (rank[claimed] > rank[ceiling]) {
    return { status: ceiling, downgraded: true };
  }
  return { status: claimed, downgraded: false };
}

/**
 * Validate a model reply against the context it was given.
 *
 * Returns a response whose every semantic id resolves in the current model,
 * so the UI can make each one clickable without a further existence check.
 */
export function groundResponse(
  output: TutorModelOutput,
  context: SpatialContext,
): GroundingResult {
  const notices: string[] = [];
  const known = contextSemanticIds(context);
  const knownLayers = new Set(context.state.layers.map((layer) => layer.id));
  const permittedActions = new Set<SpatialActionKind>(context.availableActions);

  // ---- related structures -------------------------------------------------

  const seen = new Set<SemanticId>();
  const relatedStructures: TutorResponse['relatedStructures'] = (output.relatedStructures ?? [])
    .flatMap((candidate) => {
      const id = candidate.semanticId as SemanticId;

      if (!known.has(id)) {
        notices.push(`Dropped related structure "${candidate.semanticId}": not in this model.`);
        return [];
      }
      if (seen.has(id)) return [];
      seen.add(id);

      // Use VEO's own name, not the model's. If they disagree, VEO is right,
      // and a renamed structure in the UI is a structure the learner cannot
      // find again in the tree.
      const canonical = canonicalName(id, context) ?? candidate.name;

      return [{ semanticId: id, name: canonical, reason: candidate.reason ?? null }];
    });

  // ---- spatial actions ----------------------------------------------------

  const spatialActions: ValidatedSpatialAction[] = (output.spatialActions ?? []).flatMap(
    (candidate): ValidatedSpatialAction[] => {
      const kind = candidate.kind;

      if (!permittedActions.has(kind)) {
        notices.push(`Dropped action ${kind}: this model does not support it right now.`);
        return [];
      }

      const target = ACTION_TARGET[kind];

      if (target === 'structure') {
        const id = candidate.semanticId as SemanticId | undefined;
        if (!id || !known.has(id)) {
          notices.push(`Dropped action ${kind}: "${candidate.semanticId ?? 'none'}" is not in this model.`);
          return [];
        }
        return [{ kind, semanticId: id, layerId: null, label: candidate.label }];
      }

      if (target === 'layer') {
        const layerId = candidate.layerId;
        if (!layerId || !knownLayers.has(layerId)) {
          notices.push(`Dropped action ${kind}: "${layerId ?? 'none'}" is not a layer of this model.`);
          return [];
        }
        return [{ kind, semanticId: null, layerId, label: candidate.label }];
      }

      return [{ kind, semanticId: null, layerId: null, label: candidate.label }];
    },
  );

  // ---- source status ------------------------------------------------------

  const { status, downgraded } = reconcileSourceStatus(output.sourceStatus, context);
  if (downgraded) {
    notices.push(
      `Downgraded sourceStatus from "${output.sourceStatus}" to "${status}": the model supplies ${context.grounding === 'bare' ? 'no descriptive content' : 'only structural facts'} for this structure.`,
    );
  }

  return {
    notices,
    response: {
      message: output.message,
      title: output.title ?? null,
      keyPoints: output.keyPoints ?? [],
      selectedStructure: {
        semanticId: context.subject.semanticId,
        name: context.subject.name,
      },
      relatedStructures,
      suggestedQuestions: output.suggestedQuestions ?? [],
      spatialActions,
      sourceStatus: status,
      confidence: output.confidence ?? null,
      notices,
    },
  };
}

/** VEO's own name for an id present in the context. */
function canonicalName(id: SemanticId, context: SpatialContext): string | null {
  if (context.subject.semanticId === id) return context.subject.name;

  for (const structure of context.related) {
    if (structure.semanticId === id) return structure.name;
  }
  for (const child of context.hierarchy.children) {
    if (child.semanticId === id) return child.name;
  }
  for (const ancestor of context.hierarchy.ancestors) {
    if (ancestor.semanticId === id) return ancestor.name;
  }
  if (context.hierarchy.parent?.semanticId === id) return context.hierarchy.parent.name;
  for (const relationship of context.relationships) {
    if (relationship.targetId === id) return relationship.targetName;
  }
  return null;
}
