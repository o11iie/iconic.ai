import type { SemanticId } from '@/lib/semantic-id';
import { isSemanticId, semanticIdAncestors } from '@/lib/semantic-id';
import type {
  Relationship,
  SpatialCapabilities,
  SpatialModelGraph,
  SpatialObject,
  SpatialObjectKind,
} from '@/types/domain/spatial';

/**
 * The AI-readable view of the spatial model.
 *
 * This is the ONLY thing the tutor ever sees of a model. It is semantic: names,
 * hierarchy, relationships, and what the learner has currently done to the
 * scene. No geometry, no glTF, no three.js object, no renderer state, no
 * arbitrary client state.
 *
 * That boundary is not tidiness. A language model cannot read a vertex buffer,
 * so sending one spends tokens to convey nothing — and every field that does
 * cross this line is a field VEO has to defend against prompt injection.
 *
 * ## Grounding is computed here, not guessed downstream
 *
 * The builder records which substantive fields the model actually supplied.
 * A structure with a name and a parent, and nothing else, gives the tutor
 * almost nothing to teach from — and the honest response to "explain this" is
 * then to say what is known and stop. Deciding that here, from the data, is
 * what stops it being decided later by a model's confidence.
 *
 * ## Determinism
 *
 * Same graph plus same selection plus same state must produce a byte-identical
 * context. Everything derived from a Map is sorted before it is emitted, so
 * insertion order can never leak into a prompt. Tests depend on this, and so
 * does any future response cache.
 */

/** How much the model itself supplied about a structure. */
export const GROUNDING_LEVELS = ['rich', 'structural', 'bare'] as const;
export type GroundingLevel = (typeof GROUNDING_LEVELS)[number];

/** Spatial operations the tutor is permitted to propose. */
export const SPATIAL_ACTION_KINDS = [
  'FOCUS_STRUCTURE',
  'SELECT_STRUCTURE',
  'SHOW_LAYER',
  'HIDE_LAYER',
  'ISOLATE_STRUCTURE',
  'RESET_VIEW',
] as const;
export type SpatialActionKind = (typeof SPATIAL_ACTION_KINDS)[number];

/** A structure as the tutor sees it. Fields absent from the model are omitted. */
export interface ContextStructure {
  readonly semanticId: SemanticId;
  readonly name: string;
  readonly kind: SpatialObjectKind;
  readonly system?: string;
  readonly region?: string;
  readonly synonyms?: readonly string[];
  readonly description?: string;
  /** What the structure does, when the model says. Never inferred. */
  readonly function?: string;
}

export interface ContextRelationship {
  readonly kind: string;
  readonly targetId: SemanticId;
  readonly targetName: string;
  readonly label?: string;
  readonly bidirectional: boolean;
}

export interface ContextHierarchy {
  /** Human-readable path from the model root down to the subject. */
  readonly path: readonly string[];
  readonly parent?: ContextStructure;
  readonly ancestors: readonly ContextStructure[];
  readonly children: readonly ContextStructure[];
  /** Depth below the subject, so the tutor can say "this contains 12 things". */
  readonly descendantCount: number;
}

/** What the learner has currently done to the scene. */
export interface ContextState {
  readonly isSelected: boolean;
  readonly visibility: 'visible' | 'hidden' | 'ghosted';
  readonly isolated: boolean;
  /** Set when something *else* is isolated, which is why this may be dimmed. */
  readonly isolatedElsewhere?: SemanticId;
  readonly layers: readonly ContextLayerState[];
}

export interface ContextLayerState {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
}

/** What the bounding step dropped, stated rather than silently discarded. */
export interface ContextTruncation {
  readonly children: number;
  readonly relationships: number;
  readonly related: number;
  readonly any: boolean;
}

export interface SpatialContext {
  readonly modelName: string;
  readonly domain: string;
  /**
   * True when this model is controlled test content rather than a subject
   * model. It travels into the prompt so the tutor can never describe a
   * fixture as though it were the real thing.
   */
  readonly isFixture: boolean;
  readonly subject: ContextStructure;
  readonly hierarchy: ContextHierarchy;
  readonly relationships: readonly ContextRelationship[];
  readonly related: readonly ContextStructure[];
  readonly state: ContextState;
  readonly capabilities: readonly (keyof SpatialCapabilities)[];
  readonly availableActions: readonly SpatialActionKind[];
  readonly grounding: GroundingLevel;
  readonly truncation: ContextTruncation;
}

/** Why a context could not be built. Never a thrown error: this is expected. */
export const CONTEXT_ERRORS = [
  'no_model',
  'malformed_semantic_id',
  'unknown_structure',
] as const;
export type ContextErrorCode = (typeof CONTEXT_ERRORS)[number];

export interface ContextError {
  readonly code: ContextErrorCode;
  readonly message: string;
}

/**
 * Context limits.
 *
 * A whole-body model has tens of thousands of structures. Sending the graph
 * would blow the context window, cost real money per question and bury the one
 * structure the learner actually asked about. These caps keep a question about
 * one structure proportional to one structure.
 */
export interface ContextLimits {
  readonly maxChildren: number;
  readonly maxRelationships: number;
  readonly maxRelated: number;
  readonly maxAncestors: number;
  readonly maxDescriptionChars: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxChildren: 12,
  maxRelationships: 10,
  maxRelated: 6,
  maxAncestors: 6,
  maxDescriptionChars: 600,
};

/** Live scene state the builder needs but must not reach into the engine for. */
export interface SceneStateView {
  readonly selectedId: SemanticId | null;
  readonly isolatedId: SemanticId | null;
  readonly hiddenIds: ReadonlySet<SemanticId>;
  readonly ghostedIds: ReadonlySet<SemanticId>;
  readonly visibleLayerIds: ReadonlySet<string>;
  readonly capabilities: SpatialCapabilities;
}

export interface BuildContextInput {
  readonly graph: SpatialModelGraph | null;
  readonly semanticId: string;
  readonly scene: SceneStateView;
  readonly limits?: Partial<ContextLimits>;
  /** Marks controlled test content. Defaults to false. */
  readonly isFixture?: boolean;
}

// ---------------------------------------------------------------------------

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  // Cut at a word boundary so a truncated sentence does not end mid-term.
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Read a string from a model's free-form metadata.
 *
 * Metadata is authored by whoever produced the manifest, so it is read
 * defensively: a non-string, an empty string or a missing key all mean "the
 * model did not say", which is materially different from "the answer is empty".
 */
function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toContextStructure(object: SpatialObject, limits: ContextLimits): ContextStructure {
  const description = object.description?.trim();
  const fn = metadataString(object.metadata, 'function');

  return {
    semanticId: object.semanticId,
    name: object.name,
    kind: object.kind,
    ...(object.system ? { system: object.system } : {}),
    ...(object.region ? { region: object.region } : {}),
    ...(object.synonyms.length > 0 ? { synonyms: [...object.synonyms].sort() } : {}),
    ...(description ? { description: clamp(description, limits.maxDescriptionChars) } : {}),
    ...(fn ? { function: clamp(fn, limits.maxDescriptionChars) } : {}),
  };
}

/**
 * A compact form for structures that are merely mentioned.
 *
 * A neighbour needs enough for the tutor to name it and for the learner to
 * click it. Its full description belongs to the question about *it*.
 */
function toReference(object: SpatialObject): ContextStructure {
  return {
    semanticId: object.semanticId,
    name: object.name,
    kind: object.kind,
    ...(object.system ? { system: object.system } : {}),
    ...(object.region ? { region: object.region } : {}),
  };
}

function assessGrounding(subject: ContextStructure, relationships: number): GroundingLevel {
  const hasProse = Boolean(subject.description) || Boolean(subject.function);
  if (hasProse) return 'rich';
  // Structural facts alone: real, teachable, but not a description of anything.
  if (relationships > 0 || subject.system || subject.region) return 'structural';
  return 'bare';
}

/**
 * Which actions make sense right now.
 *
 * Derived from the model's capabilities and the current state, so the tutor is
 * never offered an action the scene would refuse. A model without layers does
 * not get SHOW_LAYER, and RESET_VIEW only appears when there is something to
 * reset — otherwise the tutor can propose a button that visibly does nothing.
 */
function availableActions(
  scene: SceneStateView,
  graph: SpatialModelGraph,
  subjectId: SemanticId,
): SpatialActionKind[] {
  const actions: SpatialActionKind[] = [];
  const caps = scene.capabilities;

  if (caps.supportsSelection) {
    actions.push('SELECT_STRUCTURE', 'FOCUS_STRUCTURE');
  }
  if (caps.supportsLayers && graph.layers.length > 0) {
    actions.push('SHOW_LAYER', 'HIDE_LAYER');
  }
  if (caps.supportsIsolation) {
    actions.push('ISOLATE_STRUCTURE');
  }

  const dirty =
    scene.isolatedId !== null ||
    scene.hiddenIds.size > 0 ||
    scene.ghostedIds.size > 0 ||
    scene.isolatedId === subjectId;
  if (dirty) actions.push('RESET_VIEW');

  return actions.sort();
}

function enabledCapabilities(caps: SpatialCapabilities): (keyof SpatialCapabilities)[] {
  return (Object.keys(caps) as (keyof SpatialCapabilities)[])
    .filter((key) => caps[key])
    .sort();
}

/**
 * Build the tutor's view of one selected structure.
 *
 * Returns a typed error rather than a partial context: a prompt built from an
 * id the model does not contain would produce a confident answer about
 * something that is not there, which is the single worst failure this system
 * can have.
 */
export function buildSpatialContext(
  input: BuildContextInput,
): { readonly ok: true; readonly context: SpatialContext } | { readonly ok: false; readonly error: ContextError } {
  const limits: ContextLimits = { ...DEFAULT_CONTEXT_LIMITS, ...input.limits };
  const { graph, scene } = input;

  if (!graph) {
    return {
      ok: false,
      error: { code: 'no_model', message: 'No spatial model is currently loaded.' },
    };
  }

  // Validate the id's SHAPE before trusting it as a key. A client may send
  // anything; this is the point at which arbitrary text stops being an id.
  if (!isSemanticId(input.semanticId)) {
    return {
      ok: false,
      error: {
        code: 'malformed_semantic_id',
        message: 'That is not a valid VEO semantic identifier.',
      },
    };
  }

  const semanticId = input.semanticId;
  const subjectObject = graph.objects.get(semanticId);

  // And validate it against THIS model. A well-formed id from another model is
  // still not something this model can be asked about.
  if (!subjectObject) {
    return {
      ok: false,
      error: {
        code: 'unknown_structure',
        message: 'That structure is not part of the model currently loaded.',
      },
    };
  }

  const subject = toContextStructure(subjectObject, limits);

  // ---- hierarchy ----------------------------------------------------------

  /*
   * Root first.
   *
   * `semanticIdAncestors` returns nearest first, which is the opposite of how
   * a path reads. Reversing before truncating matters twice over: it puts the
   * path in the order a learner would say it, and it makes `slice(-N)` keep
   * the NEAREST ancestors when a deep model exceeds the limit. Truncating the
   * other way would drop the immediate parent — the one piece of hierarchy
   * that is always relevant — and keep the model root, which rarely is.
   */
  const ancestorIds = semanticIdAncestors(semanticId)
    .filter((id) => graph.objects.has(id))
    .reverse()
    .slice(-limits.maxAncestors);
  const ancestors = ancestorIds
    .map((id) => graph.objects.get(id))
    .filter((o): o is SpatialObject => o !== undefined)
    .map(toReference);

  const parentObject = subjectObject.parentId
    ? graph.objects.get(subjectObject.parentId)
    : undefined;

  const allChildren = [...subjectObject.childIds]
    .sort()
    .map((id) => graph.objects.get(id))
    .filter((o): o is SpatialObject => o !== undefined);
  const children = allChildren.slice(0, limits.maxChildren).map(toReference);

  const descendantCount = countDescendants(graph, semanticId);

  const hierarchy: ContextHierarchy = {
    path: [...ancestors.map((a) => a.name), subject.name],
    ...(parentObject ? { parent: toReference(parentObject) } : {}),
    ancestors,
    children,
    descendantCount,
  };

  // ---- relationships ------------------------------------------------------

  const allRelationships = graph.relationships
    .filter(
      (r) =>
        r.sourceId === semanticId || (r.bidirectional && r.targetId === semanticId),
    )
    .filter((r) => graph.objects.has(relationshipOther(r, semanticId)))
    // Deterministic: authored order is not guaranteed stable across loads.
    .sort((a, b) =>
      a.kind === b.kind
        ? relationshipOther(a, semanticId).localeCompare(relationshipOther(b, semanticId))
        : a.kind.localeCompare(b.kind),
    );

  const relationships: ContextRelationship[] = allRelationships
    .slice(0, limits.maxRelationships)
    .map((r) => {
      const otherId = relationshipOther(r, semanticId);
      const other = graph.objects.get(otherId);
      return {
        kind: r.kind,
        targetId: otherId,
        targetName: other?.name ?? otherId,
        ...(r.label ? { label: r.label } : {}),
        bidirectional: r.bidirectional,
      };
    });

  // ---- related structures -------------------------------------------------
  //
  // Neighbours worth offering as "explore this next": relationship targets
  // first, because the model asserted the connection, then siblings, which are
  // merely nearby in the tree. Both are real ids in this graph.

  const relatedIds = new Set<SemanticId>();
  for (const relationship of relationships) relatedIds.add(relationship.targetId);

  if (relatedIds.size < limits.maxRelated && subjectObject.parentId) {
    const parent = graph.objects.get(subjectObject.parentId);
    for (const siblingId of [...(parent?.childIds ?? [])].sort()) {
      if (siblingId === semanticId) continue;
      if (relatedIds.size >= limits.maxRelated) break;
      if (graph.objects.has(siblingId)) relatedIds.add(siblingId);
    }
  }

  const relatedAll = [...relatedIds];
  const related = relatedAll
    .slice(0, limits.maxRelated)
    .map((id) => graph.objects.get(id))
    .filter((o): o is SpatialObject => o !== undefined)
    .map(toReference);

  // ---- current scene state ------------------------------------------------

  const visibility: ContextState['visibility'] = scene.hiddenIds.has(semanticId)
    ? 'hidden'
    : scene.ghostedIds.has(semanticId)
      ? 'ghosted'
      : 'visible';

  const state: ContextState = {
    isSelected: scene.selectedId === semanticId,
    visibility,
    isolated: scene.isolatedId === semanticId,
    ...(scene.isolatedId !== null && scene.isolatedId !== semanticId
      ? { isolatedElsewhere: scene.isolatedId }
      : {}),
    layers: [...graph.layers]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: scene.visibleLayerIds.has(layer.id),
      })),
  };

  const truncation: ContextTruncation = {
    children: Math.max(0, allChildren.length - children.length),
    relationships: Math.max(0, allRelationships.length - relationships.length),
    related: Math.max(0, relatedAll.length - related.length),
    get any() {
      return this.children > 0 || this.relationships > 0 || this.related > 0;
    },
  };

  return {
    ok: true,
    context: {
      modelName: graph.model.name,
      domain: graph.model.domain,
      isFixture: input.isFixture ?? false,
      subject,
      hierarchy,
      relationships,
      related,
      state,
      capabilities: enabledCapabilities(scene.capabilities),
      availableActions: availableActions(scene, graph, semanticId),
      grounding: assessGrounding(subject, relationships.length),
      truncation: {
        children: truncation.children,
        relationships: truncation.relationships,
        related: truncation.related,
        any:
          truncation.children > 0 || truncation.relationships > 0 || truncation.related > 0,
      },
    },
  };
}

/** The end of a relationship that is not the subject. */
function relationshipOther(relationship: Relationship, subject: SemanticId): SemanticId {
  return relationship.sourceId === subject ? relationship.targetId : relationship.sourceId;
}

/** Count everything beneath a node, bounded so a cycle cannot hang the server. */
function countDescendants(graph: SpatialModelGraph, root: SemanticId): number {
  const seen = new Set<SemanticId>([root]);
  const queue: SemanticId[] = [root];
  let count = 0;

  while (queue.length > 0 && seen.size < 10_000) {
    const current = queue.shift();
    if (current === undefined) break;
    const object = graph.objects.get(current);
    if (!object) continue;
    for (const childId of object.childIds) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      count += 1;
      queue.push(childId);
    }
  }

  return count;
}

/**
 * Every semantic id this context mentions.
 *
 * The response validator uses it to reject any structure the model names that
 * VEO did not put in front of it — the check that turns "related structures"
 * from prose into something the UI can safely make clickable.
 */
export function contextSemanticIds(context: SpatialContext): ReadonlySet<SemanticId> {
  const ids = new Set<SemanticId>([context.subject.semanticId]);
  for (const ancestor of context.hierarchy.ancestors) ids.add(ancestor.semanticId);
  if (context.hierarchy.parent) ids.add(context.hierarchy.parent.semanticId);
  for (const child of context.hierarchy.children) ids.add(child.semanticId);
  for (const relationship of context.relationships) ids.add(relationship.targetId);
  for (const structure of context.related) ids.add(structure.semanticId);
  return ids;
}
