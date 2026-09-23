import type { SemanticId } from '@/lib/semantic-id';
import type { SpatialModelGraph } from '@/types/domain/spatial';
import type { ContentSourceStatus, LearningObjectiveType } from '@/types/domain/learning';
import {
  buildSpatialContext,
  contextSemanticIds,
  type ContextError,
  type ContextStructure,
  type SceneStateView,
  type SpatialContext,
} from '../context/spatial-context';

/**
 * The view of a structure that learning content is generated from.
 *
 * Built on Gate 10's `SpatialContext` rather than beside it. The tutor and the
 * content generator must agree about what a structure IS — two independently
 * assembled views of the same model would eventually disagree, and the first
 * symptom would be a flashcard contradicting the explanation the learner just
 * read about the same structure.
 *
 * What this adds on top of the spatial context is the material a question can
 * legitimately be built from, separated by whether VEO actually has it:
 *
 *   - `facts`      — statements VEO can support, each traceable to a field.
 *   - `distractorPool` — real structures nearby, for plausible wrong answers.
 *   - `supports`   — which objectives the available material can carry.
 *
 * That last one is the point. A structure with no description cannot support a
 * DEFINE question, and a structure with no relationships cannot support
 * RELATE. Deciding that HERE, from the data, is what stops the model being
 * asked to produce a question it can only answer by inventing something.
 */

/** A statement VEO can support, with the field it came from. */
export interface GroundedFact {
  /** Which part of the model this came from. Never prose VEO composed. */
  readonly source:
    | 'name'
    | 'synonyms'
    | 'description'
    | 'function'
    | 'system'
    | 'region'
    | 'parent'
    | 'children'
    | 'relationship';
  readonly statement: string;
  /** Structures this fact involves, for validating what the model produces. */
  readonly involves: readonly SemanticId[];
}

export interface LearningContext {
  readonly modelName: string;
  readonly domain: string;
  /** True when this is controlled test content rather than a subject model. */
  readonly isFixture: boolean;

  readonly subject: ContextStructure;
  /** Human-readable path, root first. */
  readonly path: readonly string[];

  /** Everything VEO can support about this structure. */
  readonly facts: readonly GroundedFact[];

  /**
   * Real structures a wrong answer may name.
   *
   * Siblings and relationship targets, because a distractor must be WRONG
   * according to the supplied context rather than invented — a made-up
   * structure is not a plausible wrong answer, it is a second thing to unlearn.
   */
  readonly distractorPool: readonly ContextStructure[];

  /** Objectives the available material can actually carry. */
  readonly supports: readonly LearningObjectiveType[];

  /** How well VEO's data supports content about this structure at all. */
  readonly sourceStatus: ContentSourceStatus;

  /** Every id this context mentions. The allowlist for generated references. */
  readonly knownIds: readonly SemanticId[];
}

export interface BuildLearningContextInput {
  readonly graph: SpatialModelGraph | null;
  readonly semanticId: string;
  readonly isFixture?: boolean;
  /** Distractor pool cap. More than a handful wastes tokens on unused options. */
  readonly maxDistractors?: number;
}

export type LearningContextResult =
  | { readonly ok: true; readonly context: LearningContext }
  | { readonly ok: false; readonly error: ContextError };

/**
 * Scene state for content generation.
 *
 * Deliberately NEUTRAL. What a learner has currently hidden is a fact about
 * this moment, not about the structure — and a flashcard that said "this is
 * currently isolated" would be wrong for every learner who ever saw it again.
 * Questions outlive the viewport, so the viewport's state is not an input.
 */
const NEUTRAL_SCENE: SceneStateView = {
  selectedId: null,
  isolatedId: null,
  hiddenIds: new Set(),
  ghostedIds: new Set(),
  visibleLayerIds: new Set(),
  capabilities: {
    supportsSelection: true,
    supportsLabels: false,
    supportsRelationships: true,
    supportsLayers: false,
    supportsIsolation: false,
    supportsGhosting: false,
    supportsPeeling: false,
    supportsDissection: false,
    supportsExplosion: false,
    supportsReconstruction: false,
  },
};

export const DEFAULT_MAX_DISTRACTORS = 6;

export function buildLearningContext(
  input: BuildLearningContextInput,
): LearningContextResult {
  const spatial = buildSpatialContext({
    graph: input.graph,
    semanticId: input.semanticId,
    scene: NEUTRAL_SCENE,
    ...(input.isFixture === undefined ? {} : { isFixture: input.isFixture }),
  });

  if (!spatial.ok) return { ok: false, error: spatial.error };

  const context = spatial.context;
  const facts = extractFacts(context);
  const supports = supportedObjectives(context, facts);

  const distractorPool = [...context.related, ...context.hierarchy.children]
    .filter((structure) => structure.semanticId !== context.subject.semanticId)
    .filter(
      (structure, index, all) =>
        all.findIndex((other) => other.semanticId === structure.semanticId) === index,
    )
    .slice(0, input.maxDistractors ?? DEFAULT_MAX_DISTRACTORS);

  return {
    ok: true,
    context: {
      modelName: context.modelName,
      domain: context.domain,
      isFixture: context.isFixture,
      subject: context.subject,
      path: context.hierarchy.path,
      facts,
      distractorPool,
      supports,
      sourceStatus: sourceStatusFor(context),
      knownIds: [...contextSemanticIds(context)].sort(),
    },
  };
}

/**
 * Turn the model's fields into statements, one per field that exists.
 *
 * Each carries the field it came from, so a later check can ask "which part of
 * the model supports this?" and get an answer rather than a shrug. A generator
 * handed a flat blob of prose can produce a question about anything in it; a
 * generator handed labelled facts can be held to them.
 */
function extractFacts(context: SpatialContext): GroundedFact[] {
  const subject = context.subject;
  const facts: GroundedFact[] = [];
  const id = subject.semanticId;

  facts.push({
    source: 'name',
    statement: `The structure is called "${subject.name}".`,
    involves: [id],
  });

  if (subject.synonyms && subject.synonyms.length > 0) {
    facts.push({
      source: 'synonyms',
      statement: `It is also known as: ${subject.synonyms.join(', ')}.`,
      involves: [id],
    });
  }

  if (subject.description) {
    facts.push({ source: 'description', statement: subject.description, involves: [id] });
  }

  if (subject.function) {
    facts.push({ source: 'function', statement: subject.function, involves: [id] });
  }

  if (subject.system) {
    facts.push({
      source: 'system',
      statement: `It belongs to the "${subject.system}" system.`,
      involves: [id],
    });
  }

  if (subject.region) {
    facts.push({
      source: 'region',
      statement: `It is located in the "${subject.region}" region.`,
      involves: [id],
    });
  }

  const parent = context.hierarchy.parent;
  if (parent) {
    facts.push({
      source: 'parent',
      statement: `It is part of "${parent.name}".`,
      involves: [id, parent.semanticId],
    });
  }

  const children = context.hierarchy.children;
  if (children.length > 0) {
    facts.push({
      source: 'children',
      statement: `It contains: ${children.map((c) => `"${c.name}"`).join(', ')}.`,
      involves: [id, ...children.map((c) => c.semanticId)],
    });
  }

  for (const relationship of context.relationships) {
    facts.push({
      source: 'relationship',
      statement: `"${subject.name}" ${relationship.kind.replace(/_/g, ' ')} "${relationship.targetName}".`,
      involves: [id, relationship.targetId],
    });
  }

  return facts;
}

/**
 * Which objectives the available material can carry.
 *
 * The check that prevents the most damaging failure mode in this whole gate:
 * asking a model to write a FUNCTION question about a structure whose function
 * VEO does not know. The model would oblige — plausibly, fluently, and wrongly.
 */
function supportedObjectives(
  context: SpatialContext,
  facts: readonly GroundedFact[],
): LearningObjectiveType[] {
  const has = (source: GroundedFact['source']) => facts.some((f) => f.source === source);
  const supported: LearningObjectiveType[] = [];

  // A structure with a name can always be identified.
  supported.push('IDENTIFY');

  if (has('description')) supported.push('DEFINE');
  if (has('function')) supported.push('FUNCTION');
  if (has('relationship') || has('parent') || has('children')) supported.push('RELATE');

  // Distinguishing needs something to distinguish it FROM, and something to
  // distinguish it BY.
  if (
    context.related.length > 0 &&
    (has('description') || has('function') || has('system') || has('region'))
  ) {
    supported.push('DISTINGUISH');
  }

  if (has('parent') || has('system') || has('region')) supported.push('LOCATE');

  return supported;
}

/**
 * Content-level grounding.
 *
 * Stricter than the tutor's, on purpose. A tutor answering "I don't have much
 * on this" is being helpful; a FLASHCARD that says so is a card the learner
 * will see again in three days and again in a week. Content that cannot be
 * supported should not be made, so `insufficient-context` is a refusal here
 * rather than a caveat.
 */
function sourceStatusFor(context: SpatialContext): ContentSourceStatus {
  switch (context.grounding) {
    case 'rich':
      return 'grounded';
    case 'structural':
      return 'partially-grounded';
    case 'bare':
      return 'insufficient-context';
  }
}

/** Whether an objective can be generated from this context at all. */
export function supportsObjective(
  context: LearningContext,
  objective: LearningObjectiveType,
): boolean {
  return context.supports.includes(objective);
}

/** Why an objective is unavailable, in words an operator can act on. */
export function explainUnsupported(
  context: LearningContext,
  objective: LearningObjectiveType,
): string {
  const reasons: Record<LearningObjectiveType, string> = {
    IDENTIFY: 'this structure has no name in the model',
    DEFINE: 'the model supplies no description for this structure',
    FUNCTION: 'the model supplies no function for this structure',
    RELATE: 'the model declares no relationships or hierarchy for this structure',
    DISTINGUISH: 'the model supplies no nearby structures, or nothing to tell them apart by',
    LOCATE: 'the model supplies no parent, system or region for this structure',
  };

  return `VEO cannot generate a ${objective} question about "${context.subject.name}" because ${reasons[objective]}.`;
}
