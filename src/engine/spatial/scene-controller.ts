import { isDescendantOf, type SemanticId } from '@/lib/semantic-id';
import type { BoundingBox, SpatialModelGraph, SpatialObject, Vec3 } from '@/types/domain/spatial';
import type { Relationship, RelationshipKind } from '@/types/domain/spatial';
import { AnnotationRegistry, anchorPosition, defaultLabelsFor } from './annotations';
import { SpatialObjectRegistry, type SceneNode } from './object-registry';
import { SpatialSearchIndex, type SearchResult } from './search';
import {
  INITIAL_LIFECYCLE,
  modelLifecycleReducer,
  type ModelLifecycleEvent,
  type ModelLifecycleState,
} from './model-lifecycle';
import type { FlyToOptions, SceneVisualState } from './types';
import { computeIsolationSets, resolveVisualState } from './visual-state';

/**
 * Scene Controller
 * ================
 *
 * The single owner of scene state: what is selected, hovered, hidden, ghosted
 * or isolated, which layers are off, where the camera has been asked to go,
 * and where the model is in its lifecycle.
 *
 * There is exactly one implementation of these rules in VEO.
 * `BaseSceneGraphProvider` delegates to this rather than keeping a parallel
 * copy, and React binds to it through `useSyncExternalStore`. Duplicating
 * selection into component state or a second store is what turns a viewport
 * into something nobody can reason about.
 *
 * Domain-agnostic by construction: it deals in semantic ids and scene nodes,
 * and knows nothing about anatomy, chemistry or any other subject.
 */

export interface CameraCommand {
  readonly version: number;
  readonly kind: 'fly_to' | 'reset' | 'fit_selection' | 'fit_model';
  readonly targetId: SemanticId | null;
  readonly options: FlyToOptions;
}

export interface SceneSnapshot {
  readonly visual: SceneVisualState;
  readonly selectedId: SemanticId | null;
  readonly hoveredId: SemanticId | null;
  readonly camera: CameraCommand | null;
  readonly lifecycle: ModelLifecycleState;
  /** Bumped on every change; lets consumers detect a new snapshot cheaply. */
  readonly revision: number;
}

export interface SceneControllerOptions {
  /** Ghost surrounding geometry on isolate instead of hiding it. */
  readonly ghostContextOnIsolate?: boolean;
}

/**
 * Resolves live world bounds for a structure.
 *
 * Injected by the 3D layer so this module stays free of three.js and remains
 * testable without a WebGL context. Returns null when the structure has no
 * geometry, which callers must handle rather than assuming an origin box.
 */
export type BoundsResolver = (semanticId: SemanticId) => BoundingBox | null;

export class SceneController<TNode extends SceneNode = SceneNode> {
  readonly registry = new SpatialObjectRegistry<TNode>();
  readonly annotations = new AnnotationRegistry();
  readonly searchIndex = new SpatialSearchIndex();

  private selectedId: SemanticId | null = null;
  private hoveredId: SemanticId | null = null;
  private highlightedIds = new Set<SemanticId>();
  private hiddenIds = new Set<SemanticId>();
  private ghostedIds = new Set<SemanticId>();
  private isolatedId: SemanticId | null = null;
  private hiddenLayerIds = new Set<string>();

  /** Every addressable object, and the layers each belongs to. */
  private objectIds: readonly SemanticId[] = [];
  /** Same set, indexed — selection validates on every call and must be O(1). */
  private objectIdSet = new Set<SemanticId>();
  private layerMembership = new Map<SemanticId, readonly string[]>();

  private lifecycle: ModelLifecycleState = INITIAL_LIFECYCLE;
  private graph: SpatialModelGraph | null = null;
  private boundsResolver: BoundsResolver | null = null;

  private cameraCommand: CameraCommand | null = null;
  private cameraVersion = 0;
  private revision = 0;

  private listeners = new Set<() => void>();
  private snapshot: SceneSnapshot | null = null;
  private readonly ghostContextOnIsolate: boolean;

  constructor(options: SceneControllerOptions = {}) {
    this.ghostContextOnIsolate = options.ghostContextOnIsolate ?? true;
  }

  // ---- React binding ------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between changes, as `useSyncExternalStore` requires. */
  getSnapshot = (): SceneSnapshot => {
    if (this.snapshot) return this.snapshot;

    this.snapshot = {
      visual: resolveVisualState({
        objectIds: this.objectIds,
        selectedId: this.selectedId,
        hoveredId: this.hoveredId,
        highlightedIds: this.highlightedIds,
        hiddenIds: this.hiddenIds,
        ghostedIds: this.ghostedIds,
        isolatedId: this.isolatedId,
        hiddenLayerIds: this.hiddenLayerIds,
        layerMembership: this.layerMembership,
      }),
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      camera: this.cameraCommand,
      lifecycle: this.lifecycle,
      revision: this.revision,
    };

    return this.snapshot;
  };

  private invalidate(): void {
    this.revision += 1;
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  // ---- scene contents -----------------------------------------------------

  /**
   * Declare the addressable universe. Visual state can only be resolved for
   * objects the controller knows exist.
   */
  setObjects(
    objectIds: readonly SemanticId[],
    layerMembership?: ReadonlyMap<SemanticId, readonly string[]>,
  ): void {
    this.objectIds = objectIds;
    this.objectIdSet = new Set(objectIds);
    this.layerMembership = new Map(layerMembership ?? []);

    // Drop emphasis referring to objects that no longer exist. Without this a
    // model swap leaves a selection pointing at geometry that is gone.
    const live = new Set(objectIds);
    if (this.selectedId && !live.has(this.selectedId)) this.selectedId = null;
    if (this.hoveredId && !live.has(this.hoveredId)) this.hoveredId = null;
    if (this.isolatedId && !live.has(this.isolatedId)) this.isolatedId = null;
    this.highlightedIds = intersect(this.highlightedIds, live);
    this.hiddenIds = intersect(this.hiddenIds, live);
    this.ghostedIds = intersect(this.ghostedIds, live);

    this.invalidate();
  }

  getObjectIds(): readonly SemanticId[] {
    return this.objectIds;
  }

  // ---- lifecycle ----------------------------------------------------------

  dispatchLifecycle(event: ModelLifecycleEvent): ModelLifecycleState {
    const next = modelLifecycleReducer(this.lifecycle, event);
    if (next === this.lifecycle) return next;

    this.lifecycle = next;

    // Leaving a loaded model behind means its selection is meaningless.
    if (event.type === 'unload' || event.type === 'dispose' || event.type === 'load') {
      this.clearEmphasis();
      this.registry.clear();
      this.searchIndex.clear();
      this.annotations.clear();
      this.graph = null;
      this.objectIds = [];
      this.objectIdSet = new Set();
      this.layerMembership = new Map();
    }

    this.invalidate();
    return next;
  }

  getLifecycle(): ModelLifecycleState {
    return this.lifecycle;
  }

  // ---- selection and emphasis --------------------------------------------

  /**
   * Select a structure.
   *
   * Rejects an id the current model does not contain, which is what makes it
   * safe to pass one straight from a URL parameter, a saved note or a stale
   * link. Returns whether the selection was accepted.
   */
  select(semanticId: SemanticId | null): boolean {
    if (semanticId !== null && this.objectIdSet.size > 0 && !this.objectIdSet.has(semanticId)) {
      return false;
    }
    if (this.selectedId === semanticId) return true;

    this.selectedId = semanticId;
    this.invalidate();
    return true;
  }

  /** True when the id names a structure in the current model. */
  isSelectable(semanticId: SemanticId | null): semanticId is SemanticId {
    return semanticId !== null && this.objectIdSet.has(semanticId);
  }

  /**
   * Select a structure and bring the camera to it.
   *
   * The single entry point used by search results, relationship navigation and
   * breadcrumbs, so every route to a structure behaves identically.
   */
  focusObject(semanticId: SemanticId, options: FlyToOptions = {}): boolean {
    if (!this.select(semanticId)) return false;
    this.flyTo(semanticId, options);
    return true;
  }

  setHovered(semanticId: SemanticId | null): void {
    if (semanticId !== null && this.objectIdSet.size > 0 && !this.objectIdSet.has(semanticId)) {
      return;
    }
    if (this.hoveredId === semanticId) return;
    this.hoveredId = semanticId;
    this.invalidate();
  }

  highlight(semanticIds: readonly SemanticId[]): void {
    this.highlightedIds = new Set(semanticIds);
    this.invalidate();
  }

  hide(semanticIds: readonly SemanticId[]): void {
    for (const id of semanticIds) {
      this.hiddenIds.add(id);
      this.ghostedIds.delete(id);
    }

    // A hidden structure cannot be seen, so leaving it selected would leave
    // the context panel describing something invisible. Selection and hover
    // both invalidate.
    if (this.selectedId && this.hiddenIds.has(this.selectedId)) this.selectedId = null;
    if (this.hoveredId && this.hiddenIds.has(this.hoveredId)) this.hoveredId = null;

    this.invalidate();
  }

  show(semanticIds: readonly SemanticId[]): void {
    for (const id of semanticIds) {
      this.hiddenIds.delete(id);
      this.ghostedIds.delete(id);
    }
    this.invalidate();
  }

  ghost(semanticIds: readonly SemanticId[]): void {
    for (const id of semanticIds) {
      this.ghostedIds.add(id);
      this.hiddenIds.delete(id);
    }
    this.invalidate();
  }

  /**
   * Isolate a subtree.
   *
   * Context is ghosted rather than deleted so the learner keeps their spatial
   * bearings — losing orientation defeats the point of a spatial tool.
   */
  isolate(semanticId: SemanticId): void {
    const { hidden, ghosted } = computeIsolationSets(
      this.objectIds,
      semanticId,
      this.ghostContextOnIsolate,
    );
    this.isolatedId = semanticId;
    this.hiddenIds = hidden;
    this.ghostedIds = ghosted;
    this.invalidate();
  }

  restore(): void {
    this.clearEmphasis();
    this.invalidate();
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    if (visible) {
      this.hiddenLayerIds.delete(layerId);
    } else {
      this.hiddenLayerIds.add(layerId);
    }
    this.invalidate();
  }

  isLayerVisible(layerId: string): boolean {
    return !this.hiddenLayerIds.has(layerId);
  }

  /** Descendants of an id that are currently registered. */
  descendantsOf(semanticId: SemanticId): SemanticId[] {
    return this.objectIds.filter((id) => isDescendantOf(id, semanticId));
  }

  private clearEmphasis(): void {
    this.selectedId = null;
    this.hoveredId = null;
    this.highlightedIds = new Set();
    this.hiddenIds = new Set();
    this.ghostedIds = new Set();
    this.isolatedId = null;
    this.hiddenLayerIds = new Set();
  }

  // ---- semantic model -----------------------------------------------------

  /**
   * Begin binding a freshly rendered scene to the current model.
   *
   * Drops the previous generation's render nodes — invalidating every
   * reference handed out for them — and immediately re-attaches the current
   * model's descriptors.
   *
   * That second step is the important one. Registration happens inside the
   * canvas, which is a separate React tree that commits on its own schedule,
   * while the model is published from the page tree. Neither can assume it
   * runs first. Clearing render nodes previously discarded the model's
   * descriptors as a side effect, so whenever registration committed last the
   * model silently lost its hierarchy, its groups and its search entries.
   *
   * Geometry and meaning have different lifetimes. This is the seam that keeps
   * them from being confused for one another, and it makes the result the same
   * in either order.
   */
  beginRegistration(): void {
    this.registry.clear();
    if (this.graph) this.registry.setDescriptors(this.graph.objects);
  }

  /**
   * Publish the loaded model's semantic graph.
   *
   * This is the single entry point for both content paths — a manifest-loaded
   * asset and the diagnostic scene — so everything downstream (registry
   * descriptors, search index, labels, hierarchy) is built once, in one place,
   * from one shape.
   */
  setGraph(graph: SpatialModelGraph | null): void {
    this.graph = graph;

    if (!graph) {
      this.registry.setDescriptors(new Map());
      this.searchIndex.clear();
      this.annotations.clear();
      this.setObjects([]);
      return;
    }

    this.registry.setDescriptors(graph.objects);
    this.searchIndex.build(graph.objects.values());

    const layerMembership = new Map<SemanticId, readonly string[]>();
    for (const [id, object] of graph.objects) layerMembership.set(id, object.layerIds);

    this.setObjects([...graph.objects.keys()], layerMembership);

    // Labels are seeded hidden: the learner turns them on. Rendering every
    // label by default makes a dense model unreadable.
    this.annotations.setLabels(
      defaultLabelsFor(
        [...graph.objects.values()].map((object) => ({
          semanticId: object.semanticId,
          name: object.name,
          depth: this.registry.getAncestors(object.semanticId).length,
        })),
      ),
    );
    this.annotations.pruneTo(new Set(graph.objects.keys()));
  }

  getGraph(): SpatialModelGraph | null {
    return this.graph;
  }

  /** The domain descriptor for a structure in the CURRENT model. */
  getObject(semanticId: SemanticId): SpatialObject | null {
    return this.registry.resolveFromSemanticId(semanticId);
  }

  /** The selected structure's descriptor, or null. */
  getSelectedObject(): SpatialObject | null {
    return this.selectedId ? this.getObject(this.selectedId) : null;
  }

  /**
   * Relationships touching a structure.
   *
   * Filtered to targets that exist in the current model, so the interface
   * never offers navigation to something that cannot be selected.
   */
  getRelationships(
    semanticId: SemanticId,
    kinds?: readonly RelationshipKind[],
  ): readonly Relationship[] {
    if (!this.graph) return [];
    const kindFilter = kinds && kinds.length > 0 ? new Set<string>(kinds) : null;

    return this.graph.relationships.filter((relationship) => {
      const touches =
        relationship.sourceId === semanticId ||
        (relationship.bidirectional && relationship.targetId === semanticId);
      if (!touches) return false;
      if (kindFilter !== null && !kindFilter.has(relationship.kind)) return false;
      return this.registry.isValid(relationship.targetId);
    });
  }

  search(query: string, limit?: number): readonly SearchResult[] {
    // Results are filtered against the registry, so a stale index can never
    // hand back something unselectable.
    return this.searchIndex.search(query, limit).filter((r) => this.registry.isValid(r.semanticId));
  }

  // ---- geometry (semantic API) --------------------------------------------

  /**
   * Install the live bounds resolver.
   *
   * The 3D layer owns geometry; this module owns meaning. Injecting the
   * resolver keeps three.js out of the semantic layer entirely.
   */
  setBoundsResolver(resolver: BoundsResolver | null): void {
    this.boundsResolver = resolver;
  }

  /** Live world bounds, or null when the structure has no geometry. */
  getObjectBounds(semanticId: SemanticId): BoundingBox | null {
    if (!this.registry.isValid(semanticId)) return null;

    const live = this.boundsResolver?.(semanticId) ?? null;
    if (live) return live;

    // Fall back to bounds declared by the model, for a structure that is
    // described but not currently rendered.
    const declared = this.getObject(semanticId)?.boundingBox ?? null;
    if (declared) return declared;

    /*
     * A grouping structure — a system, a region, an assembly — usually owns no
     * geometry of its own; its extent is the extent of what it contains.
     * Without this, framing a system would have nothing to frame, and the
     * camera would simply ignore the request.
     */
    return this.unionOfDescendants(semanticId);
  }

  private unionOfDescendants(semanticId: SemanticId): BoundingBox | null {
    let min: [number, number, number] | null = null;
    let max: [number, number, number] | null = null;

    for (const childId of this.registry.getDescendants(semanticId)) {
      const box = this.boundsResolver?.(childId) ?? this.getObject(childId)?.boundingBox ?? null;
      if (!box) continue;

      if (!min || !max) {
        min = [box.min[0], box.min[1], box.min[2]];
        max = [box.max[0], box.max[1], box.max[2]];
        continue;
      }
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis] as number, box.min[axis] as number);
        max[axis] = Math.max(max[axis] as number, box.max[axis] as number);
      }
    }

    return min && max ? { min, max } : null;
  }

  getObjectCenter(semanticId: SemanticId): Vec3 | null {
    const box = this.getObjectBounds(semanticId);
    if (!box) return null;
    return [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ];
  }

  /** World position of a structure. Its centre, unless an anchor is given. */
  getObjectWorldPosition(semanticId: SemanticId, anchor: 'center' | 'top' | 'bottom' | 'front' = 'center'): Vec3 | null {
    const box = this.getObjectBounds(semanticId);
    return box ? anchorPosition(box, anchor) : null;
  }

  /** Radius of the sphere enclosing the structure. Used for camera framing. */
  getObjectRadius(semanticId: SemanticId): number | null {
    const box = this.getObjectBounds(semanticId);
    if (!box) return null;

    const half: Vec3 = [
      (box.max[0] - box.min[0]) / 2,
      (box.max[1] - box.min[1]) / 2,
      (box.max[2] - box.min[2]) / 2,
    ];
    return Math.hypot(half[0], half[1], half[2]);
  }

  // ---- camera intents -----------------------------------------------------

  private issueCamera(
    kind: CameraCommand['kind'],
    targetId: SemanticId | null,
    options: FlyToOptions,
  ): void {
    this.cameraVersion += 1;
    this.cameraCommand = { version: this.cameraVersion, kind, targetId, options };
    this.invalidate();
  }

  flyTo(semanticId: SemanticId, options: FlyToOptions = {}): void {
    this.issueCamera('fly_to', semanticId, options);
  }

  resetCamera(options: FlyToOptions = {}): void {
    this.issueCamera('reset', null, options);
  }

  fitToModel(options: FlyToOptions = {}): void {
    this.issueCamera('fit_model', null, options);
  }

  fitToSelection(options: FlyToOptions = {}): void {
    this.issueCamera('fit_selection', this.selectedId, options);
  }

  getCameraCommand(): CameraCommand | null {
    return this.cameraCommand;
  }

  // ---- teardown -----------------------------------------------------------

  dispose(): void {
    this.dispatchLifecycle({ type: 'dispose' });
    this.listeners.clear();
    this.snapshot = null;
  }
}

function intersect(source: Set<SemanticId>, live: ReadonlySet<SemanticId>): Set<SemanticId> {
  const next = new Set<SemanticId>();
  for (const id of source) if (live.has(id)) next.add(id);
  return next;
}
