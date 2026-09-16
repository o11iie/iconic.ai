import { err, ok, type Result } from '@/lib/result';

/**
 * VEO Semantic Identity
 * =====================
 *
 * A mesh name inside a vendor's GLB file ("Heart_LV_001", "mesh_0442") is an
 * artefact of that vendor's export pipeline. It changes between asset
 * revisions, differs between vendors, and carries no meaning. VEO therefore
 * never treats it as identity.
 *
 * Instead every addressable thing in a spatial model carries a VEO semantic id:
 *
 *     veo.anatomy.heart.left_ventricle
 *     veo.chemistry.benzene.carbon_1
 *     veo.engineering.turbofan.fan_blade
 *     ^^^ ^^^^^^^ ^^^^^^^^^^^^^^^^^^^^
 *      |     |            └── one or more path segments, general -> specific
 *      |     └── knowledge domain
 *      └── namespace root
 *
 * Stability contract:
 *   * A semantic id is permanent. Provider meshes are re-mapped onto it.
 *   * Learning content (questions, flashcards, notes, memory state) references
 *     semantic ids, so swapping the underlying 3D asset vendor never
 *     invalidates a single thing a learner has studied.
 *   * The path is hierarchical, so ancestry is computable without a database.
 */

export const SEMANTIC_ID_NAMESPACE = 'veo' as const;
export const SEMANTIC_ID_SEPARATOR = '.' as const;

/** Segment grammar: lowercase alphanumerics, underscore-delimited words. */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Branded string. A value only becomes a `SemanticId` by passing validation,
 * so any function accepting one can trust its shape.
 */
export type SemanticId = string & { readonly __brand: 'VeoSemanticId' };

export interface ParsedSemanticId {
  readonly id: SemanticId;
  readonly namespace: typeof SEMANTIC_ID_NAMESPACE;
  /** Knowledge domain, e.g. "anatomy". Validated against the domain registry separately. */
  readonly domain: string;
  /** Path segments below the domain, general -> specific. Always at least one. */
  readonly path: readonly string[];
  /** The most specific segment, e.g. "left_ventricle". */
  readonly leaf: string;
}

export type SemanticIdErrorReason =
  | 'empty'
  | 'not_a_string'
  | 'bad_namespace'
  | 'too_few_segments'
  | 'invalid_segment'
  | 'uppercase';

export class SemanticIdError extends Error {
  readonly reason: SemanticIdErrorReason;
  readonly input: string;

  constructor(reason: SemanticIdErrorReason, input: string, message: string) {
    super(message);
    this.name = 'SemanticIdError';
    this.reason = reason;
    this.input = input;
  }
}

/** Parse and validate. Returns a Result rather than throwing. */
export function parseSemanticId(value: unknown): Result<ParsedSemanticId, SemanticIdError> {
  if (typeof value !== 'string') {
    return err(new SemanticIdError('not_a_string', String(value), 'Semantic id must be a string.'));
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return err(new SemanticIdError('empty', value, 'Semantic id must not be empty.'));
  }

  if (trimmed !== trimmed.toLowerCase()) {
    return err(
      new SemanticIdError(
        'uppercase',
        value,
        `Semantic id must be lowercase: "${trimmed}". Identity must not depend on casing.`,
      ),
    );
  }

  const segments = trimmed.split(SEMANTIC_ID_SEPARATOR);

  if (segments.length < 3) {
    return err(
      new SemanticIdError(
        'too_few_segments',
        value,
        `Semantic id requires at least namespace, domain and one path segment: "${trimmed}".`,
      ),
    );
  }

  const [namespace, domain, ...path] = segments;

  if (namespace !== SEMANTIC_ID_NAMESPACE) {
    return err(
      new SemanticIdError(
        'bad_namespace',
        value,
        `Semantic id must start with "${SEMANTIC_ID_NAMESPACE}." but got "${namespace}".`,
      ),
    );
  }

  for (const segment of [domain, ...path]) {
    if (segment === undefined || !SEGMENT_PATTERN.test(segment)) {
      return err(
        new SemanticIdError(
          'invalid_segment',
          value,
          `Invalid segment "${segment ?? ''}" in "${trimmed}". Segments must match ${String(SEGMENT_PATTERN)}.`,
        ),
      );
    }
  }

  // `domain` and `leaf` are provably present: segments.length >= 3 and every
  // segment passed the pattern check above.
  return ok({
    id: trimmed as SemanticId,
    namespace: SEMANTIC_ID_NAMESPACE,
    domain: domain as string,
    path: path as readonly string[],
    leaf: path[path.length - 1] as string,
  });
}

/** Type guard usable in filters and conditionals. */
export function isSemanticId(value: unknown): value is SemanticId {
  return parseSemanticId(value).ok;
}

/**
 * Build an id from parts. Throws on invalid input because callers are source
 * code, not user input — a malformed literal is a bug that must fail loudly.
 */
export function buildSemanticId(domain: string, ...path: string[]): SemanticId {
  const candidate = [SEMANTIC_ID_NAMESPACE, domain, ...path].join(SEMANTIC_ID_SEPARATOR);
  const parsed = parseSemanticId(candidate);
  if (!parsed.ok) throw parsed.error;
  return parsed.value.id;
}

/** The immediate parent, or null when already at `veo.<domain>.<leaf>`. */
export function semanticIdParent(id: SemanticId): SemanticId | null {
  const segments = id.split(SEMANTIC_ID_SEPARATOR);
  if (segments.length <= 3) return null;
  return segments.slice(0, -1).join(SEMANTIC_ID_SEPARATOR) as SemanticId;
}

/** Every ancestor, nearest first. */
export function semanticIdAncestors(id: SemanticId): SemanticId[] {
  const ancestors: SemanticId[] = [];
  let current = semanticIdParent(id);
  while (current) {
    ancestors.push(current);
    current = semanticIdParent(current);
  }
  return ancestors;
}

/** Depth below the domain. `veo.anatomy.heart` is 1. */
export function semanticIdDepth(id: SemanticId): number {
  return id.split(SEMANTIC_ID_SEPARATOR).length - 2;
}

/** True when `candidate` sits beneath `ancestor`. Not reflexive. */
export function isDescendantOf(candidate: SemanticId, ancestor: SemanticId): boolean {
  return candidate !== ancestor && candidate.startsWith(`${ancestor}${SEMANTIC_ID_SEPARATOR}`);
}

/** The knowledge domain portion, without re-parsing the whole id. */
export function semanticIdDomain(id: SemanticId): string {
  return id.split(SEMANTIC_ID_SEPARATOR)[1] as string;
}

/**
 * Turn an arbitrary provider string ("Heart_LV 001", "mesh-0442") into a legal
 * segment. Used by mapping tooling to *propose* ids for human review — never to
 * mint production identity automatically.
 */
export function toSemanticSegment(raw: string): string | null {
  const segment = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return SEGMENT_PATTERN.test(segment) ? segment : null;
}

/** Human-readable label derived from the leaf, e.g. "Left Ventricle". */
export function semanticIdToLabel(id: SemanticId): string {
  const parsed = parseSemanticId(id);
  const leaf = parsed.ok ? parsed.value.leaf : id;
  return leaf
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
