import { parseSemanticId, type SemanticId } from '@/lib/semantic-id';

/**
 * Spatial Object Registry
 * =======================
 *
 * The bridge between rendered geometry and VEO's semantic identity.
 *
 * The renderer draws nodes. The learner selects *structures*. This registry is
 * what turns one into the other, and it is deliberately the only place that
 * knows the mapping — nothing downstream ever inspects a mesh name.
 *
 * Written against a minimal structural `SceneNode` rather than `THREE.Object3D`
 * so the resolution rules can be unit-tested without a WebGL context. Any
 * three.js object satisfies this shape.
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

export interface RegistryEntry<TNode extends SceneNode = SceneNode> {
  readonly semanticId: SemanticId;
  /** The node that owns this identity. May be a group or a single mesh. */
  readonly node: TNode;
  /** Every mesh beneath (and including) the node. */
  readonly meshes: readonly TNode[];
}

/**
 * Stamp identity onto a node.
 *
 * Kept separate from `register` because provider loaders tag nodes during
 * their traversal, before the registry exists.
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
 * geometry clears selection rather than selecting something arbitrary.
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

  get size(): number {
    return this.entries.size;
  }

  has(semanticId: SemanticId): boolean {
    return this.entries.has(semanticId);
  }

  get(semanticId: SemanticId): RegistryEntry<TNode> | null {
    return this.entries.get(semanticId) ?? null;
  }

  ids(): SemanticId[] {
    return [...this.entries.keys()];
  }

  all(): RegistryEntry<TNode>[] {
    return [...this.entries.values()];
  }

  unmappedNames(): string[] {
    return [...this.unmapped];
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
    this.entries.set(semanticId, {
      semanticId,
      node,
      meshes: meshes.length > 0 ? meshes : collectMeshes(node),
    });
    return true;
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

  /** Resolve a hit node to the structure that owns it. */
  resolve(node: TNode | null): SemanticId | null {
    const id = resolveSelectable(node);
    // Only report identities this registry actually knows about; a stale tag
    // left on a node from a previous model must not resolve.
    return id !== null && this.entries.has(id) ? id : null;
  }

  clear(): void {
    this.entries.clear();
    this.unmapped.clear();
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
