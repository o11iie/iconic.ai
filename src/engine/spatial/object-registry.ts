import { isDescendantOf, parseSemanticId, semanticIdParent, type SemanticId } from '@/lib/semantic-id';
import type { SpatialObject } from '@/types/domain/spatial';

/**
 * Semantic Object Registry
 * ========================
 *
 * The bridge between rendered geometry and VEO's semantic identity.
 *
 * The renderer draws nodes. The learner selects *structures*. A rendered mesh
 * is never the source of truth — the `SpatialObject` is — and this registry is
 * the single place that maps one to the other. Nothing downstream inspects a
 * mesh name or reads `userData` directly.
 *
 * Written against a minimal structural `SceneNode` rather than
 * `THREE.Object3D`, so every resolution rule is unit-testable without a WebGL
 * context. Any three.js object satisfies this shape.
 *
 * ## Generation safety
 *
 * Every registration is stamped with the registry's current generation, which
 * increments on `clear()`. A node left over from a previous model still
 * carries its tag, but resolving it returns null because its generation no
 * longer matches. This is what makes "a stale object reference can never
 * resolve as a valid current object" a property of the design rather than a
 * hope.
 */

/** The narrow slice of a scene-graph node the registry needs. */
export interface SceneNode {
  readonly name: string;
  parent: SceneNode | null;
  readonly children: readonly SceneNode[];
  userData: Record<string, unknown>;
  readonly isMesh?: boolean;
  visible?: boolean;
}

/** Key under which semantic identity is stamped onto a node. */
export const SEMANTIC_KEY = 'veoSemanticId';
/** Key under which the registry generation is stamped onto a node. */
export const GENERATION_KEY = 'veoGeneration';

export interface RegistryEntry<TNode extends SceneNode = SceneNode> {
  readonly semanticId: SemanticId;
  /** The node that owns this identity. May be a group or a single mesh. */
  readonly node: TNode;
  /** Every mesh beneath (and including) the node. */
  readonly meshes: readonly TNode[];
  /** Domain descriptor, when the model supplied one. */
  readonly descriptor: SpatialObject | null;
  /** Registry generation this entry belongs to. */
  readonly generation: number;
}

/**
 * Stamp identity onto a node.
 *
 * Kept separate from `register` because loaders tag nodes during traversal,
 * before the registry entry exists.
 */
export function tagNode(node: SceneNode, semanticId: SemanticId | null): void {
  node.userData[SEMANTIC_KEY] = semanticId;
}

export function readTag(node: SceneNode): SemanticId | null {
  const value = node.userData[SEMANTIC_KEY];
  return typeof value === 'string' ? (value as SemanticId) : null;
}

/**
 * Resolve the structure a raycast hit belongs to.
 *
 * Walks from the hit node upward and returns the FIRST tagged ancestor,
 * including the node itself. That ordering is the important part: when a
 * selectable child sits inside a tagged group, the child wins. Returning the
 * outermost match instead would mean every click selected the whole model,
 * which is the classic failure mode of naive scene picking.
 *
 * Returns null when nothing on the path is selectable, so a click on unmapped
 * geometry or a helper clears selection rather than selecting something
 * arbitrary.
 */
export function resolveSelectable(node: SceneNode | null, maxDepth = 64): SemanticId | null {
  let current: SceneNode | null = node;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tag = readTag(current);
    if (tag !== null) return tag;
    current = current.parent;
    depth += 1;
  }

  return null;
}

export class SpatialObjectRegistry<TNode extends SceneNode = SceneNode> {
  private readonly entries = new Map<SemanticId, RegistryEntry<TNode>>();
  /** Nodes encountered with no semantic mapping, surfaced for manifest authoring. */
  private readonly unmapped = new Set<string>();
  /** Domain descriptors for the current model, keyed by semantic id. */
  private descriptors: ReadonlyMap<SemanticId, SpatialObject> = new Map();

  private currentGeneration = 0;

  get size(): number {
    return this.entries.size;
  }

  /** Increments whenever the registry is cleared for a new model. */
  get generation(): number {
    return this.currentGeneration;
  }

  /**
   * True when the id names a structure in the CURRENT model.
   *
   * Deliberately broader than "has geometry". A model routinely declares
   * structures that render as grouping nodes with no mesh of their own — a
   * system, a region, an assembly. Those are first-class semantic objects:
   * they appear in the hierarchy, in search and in the breadcrumb, and a
   * learner can select one. Treating geometry as the test for existence would
   * silently delete them from the model, which is exactly the mistake of
   * letting the rendered mesh be the source of truth.
   */
  has(semanticId: SemanticId): boolean {
    return this.entries.has(semanticId) || this.descriptors.has(semanticId);
  }

  /** True when the structure is backed by a live render node. */
  hasGeometry(semanticId: SemanticId): boolean {
    return this.entries.has(semanticId);
  }

  get(semanticId: SemanticId): RegistryEntry<TNode> | null {
    return this.entries.get(semanticId) ?? null;
  }

  /** Ids backed by live geometry. */
  ids(): SemanticId[] {
    return [...this.entries.keys()];
  }

  /**
   * Every structure the current model contains, rendered or not.
   *
   * This is the semantic universe hierarchy and search work against.
   */
  objectIds(): SemanticId[] {
    if (this.descriptors.size === 0) return this.ids();
    const all = new Set<SemanticId>(this.descriptors.keys());
    for (const id of this.entries.keys()) all.add(id);
    return [...all];
  }

  all(): RegistryEntry<TNode>[] {
    return [...this.entries.values()];
  }

  unmappedNames(): string[] {
    return [...this.unmapped];
  }

  /**
   * Attach the model's domain descriptors.
   *
   * Called before registration so entries can carry their `SpatialObject`.
   * Descriptors are authoritative for hierarchy; the semantic-id path is only
   * a fallback for models that supply geometry without a declared tree.
   */
  setDescriptors(descriptors: ReadonlyMap<SemanticId, SpatialObject>): void {
    this.descriptors = descriptors;

    // Re-attach to entries registered before the graph arrived.
    for (const [semanticId, entry] of this.entries) {
      const descriptor = descriptors.get(semanticId) ?? null;
      if (descriptor !== entry.descriptor) {
        this.entries.set(semanticId, { ...entry, descriptor });
      }
    }
  }

  /**
   * Register a node under a semantic id.
   *
   * Rejects malformed ids rather than accepting them silently: an unparseable
   * id would be unreachable by every query that follows.
   */
  register(semanticId: SemanticId, node: TNode, meshes: readonly TNode[] = []): boolean {
    if (!parseSemanticId(semanticId).ok) return false;

    tagNode(node, semanticId);
    node.userData[GENERATION_KEY] = this.currentGeneration;

    this.entries.set(semanticId, {
      semanticId,
      node,
      meshes: meshes.length > 0 ? meshes : collectMeshes(node),
      descriptor: this.descriptors.get(semanticId) ?? null,
      generation: this.currentGeneration,
    });
    return true;
  }

  /** Remove one structure, e.g. when a region is unloaded. */
  unregister(semanticId: SemanticId): boolean {
    const entry = this.entries.get(semanticId);
    if (!entry) return false;

    // Untag so the node cannot resolve through a raycast any more.
    tagNode(entry.node, null);
    delete entry.node.userData[GENERATION_KEY];
    return this.entries.delete(semanticId);
  }

  recordUnmapped(name: string): void {
    if (name) this.unmapped.add(name);
  }

  /** Every mesh belonging to a structure, for material and visibility work. */
  meshesFor(semanticId: SemanticId): readonly TNode[] {
    return this.entries.get(semanticId)?.meshes ?? [];
  }

  /** Every registered mesh, across all structures. */
  allMeshes(): TNode[] {
    const seen = new Set<TNode>();
    for (const entry of this.entries.values()) {
      for (const mesh of entry.meshes) seen.add(mesh);
    }
    return [...seen];
  }

  // ---- resolution ----------------------------------------------------------

  /**
   * Resolve a hit node to the id of the structure that owns it.
   *
   * Rejects three things: an id this registry does not hold, a node whose
   * stamped generation predates the current model, and an entry left over from
   * an earlier generation.
   */
  resolve(node: TNode | null): SemanticId | null {
    const id = resolveSelectable(node);
    if (id === null) return null;

    const entry = this.entries.get(id);
    if (!entry || entry.generation !== this.currentGeneration) return null;

    // A node tagged during a previous model still carries its id; its
    // generation stamp is what gives it away.
    const stamped = node?.userData[GENERATION_KEY];
    if (typeof stamped === 'number' && stamped !== this.currentGeneration) return null;

    return id;
  }

  /** Resolve a hit node all the way to its domain descriptor. */
  resolveFromObject(node: TNode | null): SpatialObject | null {
    const id = this.resolve(node);
    return id === null ? null : this.resolveFromSemanticId(id);
  }

  /**
   * Resolve a semantic id to its descriptor.
   *
   * Returns null for an id the current model does not contain, which is what
   * makes it safe to pass an id from a URL or a saved note straight in.
   */
  resolveFromSemanticId(semanticId: SemanticId): SpatialObject | null {
    const entry = this.entries.get(semanticId);
    if (entry) {
      if (entry.generation !== this.currentGeneration) return null;
      return entry.descriptor ?? this.descriptors.get(semanticId) ?? null;
    }

    // Declared but not rendered. The descriptor map belongs to the current
    // model — `clear()` empties it — so this cannot leak a previous model.
    return this.descriptors.get(semanticId) ?? null;
  }

  /**
   * True when the id names a structure in the CURRENT model.
   *
   * The gate every externally supplied id passes through: a URL parameter, a
   * saved note, a deep link. An id from a previous model fails it, because
   * `clear()` drops both the entries and the descriptors of that model.
   */
  isValid(semanticId: SemanticId | null): semanticId is SemanticId {
    if (semanticId === null) return false;
    const entry = this.entries.get(semanticId);
    if (entry) return entry.generation === this.currentGeneration;
    return this.descriptors.has(semanticId);
  }

  // ---- hierarchy -----------------------------------------------------------

  /**
   * The parent structure.
   *
   * Prefers the declared `parentId`; falls back to the semantic-id path so a
   * model that ships geometry without a declared tree still navigates.
   */
  getParent(semanticId: SemanticId): SemanticId | null {
    const declared = this.resolveFromSemanticId(semanticId)?.parentId ?? null;
    if (declared && this.has(declared)) return declared;

    const fromPath = semanticIdParent(semanticId);
    return fromPath && this.has(fromPath) ? fromPath : null;
  }

  getChildren(semanticId: SemanticId): SemanticId[] {
    const declared = this.resolveFromSemanticId(semanticId)?.childIds ?? [];
    const present = declared.filter((id) => this.has(id));
    if (present.length > 0) return present;

    // Fall back to direct descendants by path depth.
    return this.objectIds().filter((id) => this.getParent(id) === semanticId);
  }

  /** Nearest first, up to the root. */
  getAncestors(semanticId: SemanticId): SemanticId[] {
    const ancestors: SemanticId[] = [];
    const seen = new Set<SemanticId>([semanticId]);

    let current = this.getParent(semanticId);
    while (current && !seen.has(current)) {
      ancestors.push(current);
      seen.add(current);
      current = this.getParent(current);
    }
    return ancestors;
  }

  /** Every structure beneath this one, at any depth. */
  getDescendants(semanticId: SemanticId): SemanticId[] {
    const descendants: SemanticId[] = [];
    const queue = [...this.getChildren(semanticId)];
    const seen = new Set<SemanticId>();

    while (queue.length > 0) {
      const id = queue.shift() as SemanticId;
      if (seen.has(id)) continue;
      seen.add(id);
      descendants.push(id);
      queue.push(...this.getChildren(id));
    }

    // A model with no declared tree still yields path descendants.
    if (descendants.length === 0) {
      return this.objectIds().filter((id) => isDescendantOf(id, semanticId));
    }
    return descendants;
  }

  // ---- teardown ------------------------------------------------------------

  /**
   * Clear for a new model.
   *
   * Bumping the generation is what invalidates every reference handed out
   * before this point, including tags still sitting on disposed nodes.
   */
  clear(): void {
    for (const entry of this.entries.values()) {
      tagNode(entry.node, null);
      delete entry.node.userData[GENERATION_KEY];
    }
    this.entries.clear();
    this.unmapped.clear();
    this.descriptors = new Map();
    this.currentGeneration += 1;
  }
}

/** Depth-first mesh collection, including the root when it is itself a mesh. */
export function collectMeshes<TNode extends SceneNode>(root: TNode): TNode[] {
  const found: TNode[] = [];
  const stack: TNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop() as TNode;
    if (node.isMesh) found.push(node);
    for (const child of node.children) stack.push(child as TNode);
  }

  return found;
}

/**
 * Build a registry from a loaded scene using a vendor-mesh-name mapping.
 *
 * Several vendor meshes routinely map to one semantic structure, so meshes are
 * grouped by identity rather than assumed one-to-one.
 */
export function buildRegistryFromMapping<TNode extends SceneNode>(
  root: TNode,
  mapping: ReadonlyMap<string, SemanticId>,
): SpatialObjectRegistry<TNode> {
  const registry = new SpatialObjectRegistry<TNode>();
  const grouped = new Map<SemanticId, TNode[]>();

  for (const mesh of collectMeshes(root)) {
    const semanticId = mapping.get(mesh.name);
    if (!semanticId) {
      tagNode(mesh, null);
      registry.recordUnmapped(mesh.name);
      continue;
    }

    tagNode(mesh, semanticId);
    const bucket = grouped.get(semanticId) ?? [];
    bucket.push(mesh);
    grouped.set(semanticId, bucket);
  }

  for (const [semanticId, meshes] of grouped) {
    // The first mesh stands as the entry node; all of them carry the identity.
    registry.register(semanticId, meshes[0] as TNode, meshes);
  }

  return registry;
}
