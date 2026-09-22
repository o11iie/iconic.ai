import { isDescendantOf, type SemanticId } from '@/lib/semantic-id';
import type {
  BoundingBox,
  SpatialCapabilities,
  SpatialLayer,
  SpatialModelGraph,
  SpatialObject,
  Vec3,
} from '@/types/domain/spatial';
import type { Relationship, RelationshipKind } from '@/types/domain/spatial';
import {
  AnnotationRegistry,
  anchorPosition,
  defaultLabelsFor,
  type PositionedAnnotation,
  type SpatialLabel,
} from './annotations';
import { resolveCapabilities } from './capabilities';
import { layerMembershipIndex } from './layers';
import {
  INITIAL_MANIPULATION,
  explodedOffsets,
  isPristine,
  maxPeelLevel,
  nextReconstructionStage,
  peeledLayers,
  reconstructOnce,
  type ManipulationAction,
  type ManipulationState,
} from './manipulation';
import { ManipulationHistory } from './manipulation-history';
import { SpatialObjectRegistry, type SceneNode } from './object-registry';
import { SpatialSearchIndex, type SearchResult } from './search';
import {
  INITIAL_LIFECYCLE,
  modelLifecycleReducer,
  type ModelLifecycleEvent,
  type ModelLifecycleState,
} from './model-lifecycle';
import { NON_RENDERING_STATES, type FlyToOptions, type SceneVisualState, type VisualState } from './types';
import { resolveVisualState } from './visual-state';

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
  /** Everything the learner has done to the model's presentation. */
  readonly manipulation: ManipulationState;
  /** What the loaded model can actually be asked to do. */
  readonly capabilities: SpatialCapabilities;
  /** Peel steps available on this model. 0 means the model does not peel. */
  readonly peelSteps: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
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

  readonly history = new ManipulationHistory();

  private selectedId: SemanticId | null = null;
  private hoveredId: SemanticId | null = null;
  private highlightedIds = new Set<SemanticId>();

  /**
   * One value holding every manipulation.
   *
   * Isolation, peel level and layer state are kept as what the learner asked
   * for rather than written into the hidden set when applied. The rendered
   * result is computed from all of them together, which is what makes each
   * one independently reversible.
   */
  private manipulation: ManipulationState = INITIAL_MANIPULATION;

  /** Every addressable object, and the layers each belongs to. */
  private objectIds: readonly SemanticId[] = [];
  /** Same set, indexed — selection validates on every call and must be O(1). */
  private objectIdSet = new Set<SemanticId>();
  private layerMembership = new Map<SemanticId, readonly string[]>();

  private lifecycle: ModelLifecycleState = INITIAL_LIFECYCLE;
  private graph: SpatialModelGraph | null = null;
  private boundsResolver: BoundsResolver | null = null;
  private layers: readonly SpatialLayer[] = [];
  private labelsEnabled = false;
  private capabilities: SpatialCapabilities = resolveCapabilities(null);

  /**
   * Exploded displacements, computed once per explosion.
   *
   * A group-derived offset is a function of where its members ARE, so reading
   * it again once they have moved would compound: each read would push them
   * further out. Computing on the first read after entering the view — while
   * every node is still at its base transform — and caching until the view is
   * left makes the displacement a property of the model rather than of how
   * many times the renderer happened to ask.
   */
  private offsetCache: ReadonlyMap<SemanticId, Vec3> | null = null;

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

    const manipulation = this.manipulation;
    const visual = this.resolveVisual(manipulation);

    this.snapshot = {
      visual: { ...visual, exploded: manipulation.exploded },
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      camera: this.cameraCommand,
      lifecycle: this.lifecycle,
      manipulation,
      capabilities: this.capabilities,
      peelSteps: maxPeelLevel(this.layers),
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      revision: this.revision,
    };

    return this.snapshot;
  };

  /** Resolve presentation for a candidate manipulation state. */
  private resolveVisual(manipulation: ManipulationState): SceneVisualState {
    const peeled = new Map<string, 'ghost' | 'hide'>();
    for (const [layerId, layer] of peeledLayers(this.layers, manipulation.peelLevel)) {
      peeled.set(layerId, layer.peelMode);
    }

    return resolveVisualState({
      objectIds: this.objectIds,
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      highlightedIds: this.highlightedIds,
      hiddenIds: manipulation.hiddenIds,
      ghostedIds: manipulation.ghostedIds,
      dissectedIds: manipulation.dissectedIds,
      isolatedId: manipulation.isolatedId,
      hiddenLayerIds: manipulation.hiddenLayerIds,
      ghostedLayerIds: manipulation.ghostedLayerIds,
      peeledLayers: peeled,
      layerMembership: this.layerMembership,
      ghostContextOnIsolate: this.ghostContextOnIsolate,
    });
  }

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
    this.highlightedIds = intersect(this.highlightedIds, live);

    const manipulation = this.manipulation;
    this.manipulation = {
      ...manipulation,
      hiddenIds: intersect(manipulation.hiddenIds, live),
      ghostedIds: intersect(manipulation.ghostedIds, live),
      dissectedIds: manipulation.dissectedIds.filter((id) => live.has(id)),
      isolatedId:
        manipulation.isolatedId && live.has(manipulation.isolatedId)
          ? manipulation.isolatedId
          : null,
    };

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
      this.restore();
      this.registry.clear();
      this.searchIndex.clear();
      this.annotations.clear();
      this.graph = null;
      this.layers = [];
      this.capabilities = resolveCapabilities(null);
      this.objectIds = [];
      this.objectIdSet = new Set();
      this.layerMembership = new Map();
      this.history.clear();
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

  // ---- manipulation -------------------------------------------------------

  /**
   * Apply a manipulation and record it.
   *
   * Every manipulation goes through here, so there is one place that decides
   * what happens to the selection afterwards, one place that records history,
   * and one place that publishes. A component reaching past this to set state
   * directly is how a viewport ends up in a configuration nobody can explain.
   */
  private applyManipulation(
    action: ManipulationAction,
    next: ManipulationState,
    options: { readonly record?: boolean } = {},
  ): void {
    if (next.exploded !== this.manipulation.exploded) this.offsetCache = null;
    this.manipulation = next;

    // Emphasis on something that is no longer drawn communicates nothing, and
    // leaves the context panel describing an invisible structure.
    const states = this.resolveVisual(next).states;
    if (this.selectedId && isRemoved(states.get(this.selectedId))) this.selectedId = null;
    if (this.hoveredId && isRemoved(states.get(this.hoveredId))) this.hoveredId = null;

    if (options.record !== false) {
      this.history.push({ action, state: next, selectedId: this.selectedId });
    }
    this.invalidate();
  }

  getManipulation(): ManipulationState {
    return this.manipulation;
  }

  /** What the loaded model can actually be asked to do. */
  getCapabilities(): SpatialCapabilities {
    return this.capabilities;
  }

  // ---- object visibility --------------------------------------------------

  /**
   * Hide structures.
   *
   * Applies to the subtree: hiding an assembly hides what it contains. The
   * semantic objects stay registered, related and queryable throughout — a
   * hidden structure is one that is not being drawn, not one that has stopped
   * existing.
   */
  hide(semanticIds: readonly SemanticId[]): void {
    const hiddenIds = new Set(this.manipulation.hiddenIds);
    const ghostedIds = new Set(this.manipulation.ghostedIds);
    for (const id of semanticIds) {
      hiddenIds.add(id);
      ghostedIds.delete(id);
    }
    this.applyManipulation('hide', { ...this.manipulation, hiddenIds, ghostedIds });
  }

  show(semanticIds: readonly SemanticId[]): void {
    const hiddenIds = new Set(this.manipulation.hiddenIds);
    const ghostedIds = new Set(this.manipulation.ghostedIds);
    for (const id of semanticIds) {
      hiddenIds.delete(id);
      ghostedIds.delete(id);
    }
    this.applyManipulation('show', { ...this.manipulation, hiddenIds, ghostedIds });
  }

  ghost(semanticIds: readonly SemanticId[]): void {
    const hiddenIds = new Set(this.manipulation.hiddenIds);
    const ghostedIds = new Set(this.manipulation.ghostedIds);
    for (const id of semanticIds) {
      ghostedIds.add(id);
      hiddenIds.delete(id);
    }
    this.applyManipulation('ghost', { ...this.manipulation, hiddenIds, ghostedIds });
  }

  hideObject(semanticId: SemanticId): boolean {
    if (!this.objectIdSet.has(semanticId)) return false;
    this.hide([semanticId]);
    return true;
  }

  showObject(semanticId: SemanticId): boolean {
    if (!this.objectIdSet.has(semanticId)) return false;
    this.show([semanticId]);
    return true;
  }

  toggleObjectVisibility(semanticId: SemanticId): boolean {
    if (!this.objectIdSet.has(semanticId)) return false;
    return this.manipulation.hiddenIds.has(semanticId)
      ? this.showObject(semanticId)
      : this.hideObject(semanticId);
  }

  ghostObject(semanticId: SemanticId): boolean {
    if (!this.objectIdSet.has(semanticId)) return false;
    this.ghost([semanticId]);
    return true;
  }

  // ---- isolation ----------------------------------------------------------

  /**
   * Isolate a subtree.
   *
   * Nothing is unregistered and nothing is disposed: the surroundings are
   * ghosted so the learner keeps their bearings, because losing orientation
   * defeats the point of a spatial tool. Isolation is stored as the id alone,
   * so restoring it cannot erase a structure hidden by hand beforehand.
   */
  isolate(semanticId: SemanticId): boolean {
    if (this.objectIdSet.size > 0 && !this.objectIdSet.has(semanticId)) return false;
    this.applyManipulation('isolate', { ...this.manipulation, isolatedId: semanticId });
    return true;
  }

  isolateObject(semanticId: SemanticId, options: FlyToOptions = {}): boolean {
    if (!this.select(semanticId)) return false;
    if (!this.isolate(semanticId)) return false;
    this.fitToSelection(options);
    return true;
  }

  restoreIsolation(): void {
    if (this.manipulation.isolatedId === null) return;
    this.applyManipulation('restore_isolation', { ...this.manipulation, isolatedId: null });
  }

  getIsolatedId(): SemanticId | null {
    return this.manipulation.isolatedId;
  }

  /**
   * Clear every emphasis at once.
   *
   * The blunt instrument: selection included. `resetScene` is what a learner
   * reaches for; this exists for callers that want a clean slate without
   * touching the camera or history.
   */
  restore(): void {
    this.offsetCache = null;
    this.selectedId = null;
    this.hoveredId = null;
    this.highlightedIds = new Set();
    this.manipulation = INITIAL_MANIPULATION;
    this.invalidate();
  }

  // ---- layers -------------------------------------------------------------

  getLayers(): readonly SpatialLayer[] {
    return this.layers;
  }

  /** The layer's current state, resolved from hidden and ghosted sets. */
  getLayerState(layerId: string): 'visible' | 'hidden' | 'ghosted' {
    if (this.manipulation.hiddenLayerIds.has(layerId)) return 'hidden';
    if (this.manipulation.ghostedLayerIds.has(layerId)) return 'ghosted';
    return 'visible';
  }

  showLayer(layerId: string): void {
    const hiddenLayerIds = new Set(this.manipulation.hiddenLayerIds);
    const ghostedLayerIds = new Set(this.manipulation.ghostedLayerIds);
    hiddenLayerIds.delete(layerId);
    ghostedLayerIds.delete(layerId);
    this.applyManipulation('layer_show', { ...this.manipulation, hiddenLayerIds, ghostedLayerIds });
  }

  hideLayer(layerId: string): void {
    const hiddenLayerIds = new Set(this.manipulation.hiddenLayerIds);
    const ghostedLayerIds = new Set(this.manipulation.ghostedLayerIds);
    hiddenLayerIds.add(layerId);
    ghostedLayerIds.delete(layerId);
    this.applyManipulation('layer_hide', { ...this.manipulation, hiddenLayerIds, ghostedLayerIds });
  }

  ghostLayer(layerId: string): void {
    const hiddenLayerIds = new Set(this.manipulation.hiddenLayerIds);
    const ghostedLayerIds = new Set(this.manipulation.ghostedLayerIds);
    ghostedLayerIds.add(layerId);
    hiddenLayerIds.delete(layerId);
    this.applyManipulation('layer_ghost', { ...this.manipulation, hiddenLayerIds, ghostedLayerIds });
  }

  /** Cycles visible -> hidden -> visible. Ghosting is its own deliberate act. */
  toggleLayer(layerId: string): void {
    if (this.getLayerState(layerId) === 'visible') {
      this.hideLayer(layerId);
    } else {
      this.showLayer(layerId);
    }
  }

  restoreLayer(layerId: string): void {
    if (this.getLayerState(layerId) === 'visible') return;
    const hiddenLayerIds = new Set(this.manipulation.hiddenLayerIds);
    const ghostedLayerIds = new Set(this.manipulation.ghostedLayerIds);
    hiddenLayerIds.delete(layerId);
    ghostedLayerIds.delete(layerId);
    this.applyManipulation('layer_restore', {
      ...this.manipulation,
      hiddenLayerIds,
      ghostedLayerIds,
    });
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    if (visible) {
      this.showLayer(layerId);
    } else {
      this.hideLayer(layerId);
    }
  }

  isLayerVisible(layerId: string): boolean {
    return !this.manipulation.hiddenLayerIds.has(layerId);
  }

  // ---- peeling ------------------------------------------------------------

  /** How many peel steps this model offers. Comes from its own layers. */
  getPeelSteps(): number {
    return maxPeelLevel(this.layers);
  }

  getPeelLevel(): number {
    return this.manipulation.peelLevel;
  }

  /** The layers the current peel level has removed, outermost first. */
  getPeeledLayerIds(): readonly string[] {
    return [...peeledLayers(this.layers, this.manipulation.peelLevel).keys()];
  }

  nextPeel(): boolean {
    const steps = this.getPeelSteps();
    if (this.manipulation.peelLevel >= steps) return false;
    this.applyManipulation('peel_next', {
      ...this.manipulation,
      peelLevel: this.manipulation.peelLevel + 1,
    });
    return true;
  }

  previousPeel(): boolean {
    if (this.manipulation.peelLevel <= 0) return false;
    this.applyManipulation('peel_previous', {
      ...this.manipulation,
      peelLevel: this.manipulation.peelLevel - 1,
    });
    return true;
  }

  resetPeel(): void {
    if (this.manipulation.peelLevel === 0) return;
    this.applyManipulation('peel_reset', { ...this.manipulation, peelLevel: 0 });
  }

  // ---- dissection ---------------------------------------------------------

  /**
   * Remove a structure to reveal what sits beneath it.
   *
   * Visual only, and reversible in the order it was applied. The registry, the
   * hierarchy, the relationships and the metadata are all untouched: a
   * dissected structure can still be searched for, navigated to and described.
   */
  dissectObject(semanticId: SemanticId): boolean {
    if (this.objectIdSet.size > 0 && !this.objectIdSet.has(semanticId)) return false;
    if (this.manipulation.dissectedIds.includes(semanticId)) return true;

    this.applyManipulation('dissect', {
      ...this.manipulation,
      dissectedIds: [...this.manipulation.dissectedIds, semanticId],
    });
    return true;
  }

  /** Undo the most recent dissection. */
  restoreDissection(): SemanticId | null {
    const stack = this.manipulation.dissectedIds;
    const last = stack[stack.length - 1];
    if (last === undefined) return null;

    this.applyManipulation('restore_dissection', {
      ...this.manipulation,
      dissectedIds: stack.slice(0, -1),
    });
    return last;
  }

  resetDissection(): void {
    if (this.manipulation.dissectedIds.length === 0) return;
    this.applyManipulation('reset_dissection', { ...this.manipulation, dissectedIds: [] });
  }

  getDissectedIds(): readonly SemanticId[] {
    return this.manipulation.dissectedIds;
  }

  // ---- exploded view ------------------------------------------------------

  isExploded(): boolean {
    return this.manipulation.exploded;
  }

  enterExplodedView(): boolean {
    if (!this.capabilities.supportsExplosion || this.manipulation.exploded) return false;
    this.applyManipulation('explode', { ...this.manipulation, exploded: true });
    return true;
  }

  exitExplodedView(): void {
    if (!this.manipulation.exploded) return;
    this.applyManipulation('implode', { ...this.manipulation, exploded: false });
  }

  resetExplodedView(): void {
    this.exitExplodedView();
  }

  /**
   * Displacements for the current view, by semantic id.
   *
   * Empty when not exploded, which is what lets the 3D layer restore every
   * transform to its authored value exactly rather than by subtracting an
   * offset it has to remember.
   */
  getExplodedOffsets(): ReadonlyMap<SemanticId, Vec3> {
    if (!this.manipulation.exploded || !this.graph) return EMPTY_OFFSETS;
    if (this.offsetCache) return this.offsetCache;

    this.offsetCache = explodedOffsets(
      this.graph.objects,
      this.graph.explosion ?? [],
      (semanticId) => this.getObjectCenter(semanticId),
    );
    return this.offsetCache;
  }

  // ---- reconstruction -----------------------------------------------------

  /** What the next reconstruction step would put back, or null when whole. */
  getNextReconstructionStage(): ReturnType<typeof nextReconstructionStage> {
    return nextReconstructionStage(this.manipulation);
  }

  /** Put back the most recent removal. Returns false when already whole. */
  reconstructStep(): boolean {
    const next = reconstructOnce(this.manipulation);
    if (next === this.manipulation) return false;
    this.applyManipulation('reconstruct_step', next);
    return true;
  }

  /**
   * Put the model back together in one move.
   *
   * Leaves the camera and the selection where they are: a learner who has
   * worked their way down to one structure wants it whole again, not to lose
   * their place as well.
   */
  reconstructAll(): void {
    if (isPristine(this.manipulation)) return;
    this.applyManipulation('reconstruct_all', INITIAL_MANIPULATION);
  }

  // ---- reset --------------------------------------------------------------

  /**
   * Return the scene to the state a model loads in.
   *
   * Visibility, ghosting, isolation, peel, dissection and the exploded view
   * all go back to their documented defaults, the camera reframes the model,
   * and the history is cleared — a reset is a fresh start, not a step that can
   * itself be undone.
   *
   * Idempotent by construction: it assigns a constant rather than reversing
   * whatever happened to be in force, so calling it twice cannot differ from
   * calling it once.
   */
  resetScene(options: FlyToOptions = {}): void {
    this.offsetCache = null;
    this.manipulation = INITIAL_MANIPULATION;
    this.selectedId = null;
    this.hoveredId = null;
    this.highlightedIds = new Set();
    this.history.clear();
    this.fitToModel(options);
  }

  /** The reconstruction vocabulary's name for `resetScene`. */
  resetToOriginal(options: FlyToOptions = {}): void {
    this.resetScene(options);
  }

  // ---- history ------------------------------------------------------------

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  undoManipulation(): boolean {
    const entry = this.history.undo();
    if (entry === null) return false;
    this.offsetCache = null;

    if (entry === 'pristine') {
      this.manipulation = INITIAL_MANIPULATION;
    } else {
      this.manipulation = entry.state;
      if (entry.selectedId === null || this.objectIdSet.has(entry.selectedId)) {
        this.selectedId = entry.selectedId;
      }
    }
    this.invalidate();
    return true;
  }

  redoManipulation(): boolean {
    const entry = this.history.redo();
    if (entry === null) return false;
    this.offsetCache = null;

    this.manipulation = entry.state;
    if (entry.selectedId === null || this.objectIdSet.has(entry.selectedId)) {
      this.selectedId = entry.selectedId;
    }
    this.invalidate();
    return true;
  }

  /** Descendants of an id that are currently registered. */
  descendantsOf(semanticId: SemanticId): SemanticId[] {
    return this.objectIds.filter((id) => isDescendantOf(id, semanticId));
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
    this.offsetCache = null;

    if (!graph) {
      this.registry.setDescriptors(new Map());
      this.searchIndex.clear();
      this.annotations.clear();
      this.layers = [];
      this.capabilities = resolveCapabilities(null);
      this.setObjects([]);
      return;
    }

    this.registry.setDescriptors(graph.objects);
    this.searchIndex.build(graph.objects.values());
    this.layers = graph.layers;
    this.capabilities = resolveCapabilities(graph);

    /*
     * Layer membership comes from the layers themselves, with each object's
     * own `layerIds` folded in. A model may express membership either way and
     * both are authoritative; indexing once here is what keeps a layer
     * operation a set lookup rather than a walk over every object.
     */
    const layerMembership = new Map<SemanticId, readonly string[]>(
      layerMembershipIndex(graph.layers),
    );
    for (const [id, object] of graph.objects) {
      if (object.layerIds.length === 0) continue;
      const declared = layerMembership.get(id);
      layerMembership.set(
        id,
        declared ? [...new Set([...declared, ...object.layerIds])] : object.layerIds,
      );
    }

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

  // ---- labels -------------------------------------------------------------

  /**
   * Whether labels are drawn at all.
   *
   * Off by default. A dense model with every structure labelled is unreadable,
   * and a learner who cannot see the anatomy for the text has been given
   * nothing. Turning them on is a deliberate act.
   */
  setLabelsEnabled(enabled: boolean): void {
    if (this.labelsEnabled === enabled) return;
    this.labelsEnabled = enabled;
    this.invalidate();
  }

  areLabelsEnabled(): boolean {
    return this.labelsEnabled;
  }

  toggleLabels(): void {
    this.setLabelsEnabled(!this.labelsEnabled);
  }

  /**
   * Labels to draw right now, resolved to world positions.
   *
   * Filtered by what is actually on screen: a label belonging to a structure
   * that has been hidden, dissected or peeled away is not shown, because a
   * name floating over nothing is worse than no name. Ghosted structures keep
   * their labels — they are still there, just faint, and that is often exactly
   * what a learner is orienting by.
   *
   * The budget keeps a dense model readable. Priority decides who survives it,
   * and the selected structure always does.
   */
  getVisibleLabels(budget = DEFAULT_LABEL_BUDGET): readonly PositionedAnnotation<SpatialLabel>[] {
    if (!this.labelsEnabled) return EMPTY_LABELS;

    const states = this.getSnapshot().visual.states;
    const positioned: PositionedAnnotation<SpatialLabel>[] = [];

    for (const label of this.annotations.visibleLabels()) {
      const state = states.get(label.semanticId);
      if (state !== undefined && NON_RENDERING_STATES.has(state)) continue;
      if (state === 'peeled') continue;

      const position = this.getObjectWorldPosition(label.semanticId, label.anchor);
      if (!position) continue;

      positioned.push({ annotation: label, position });
    }

    // The selected structure is the one the learner is looking at; losing its
    // label to a budget would be the one omission they would notice.
    positioned.sort((a, b) => {
      const aSelected = a.annotation.semanticId === this.selectedId ? 1 : 0;
      const bSelected = b.annotation.semanticId === this.selectedId ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      return b.annotation.priority - a.annotation.priority;
    });

    return positioned.slice(0, Math.max(0, budget));
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

function intersect(
  source: ReadonlySet<SemanticId>,
  live: ReadonlySet<SemanticId>,
): Set<SemanticId> {
  const next = new Set<SemanticId>();
  for (const id of source) if (live.has(id)) next.add(id);
  return next;
}

const EMPTY_OFFSETS: ReadonlyMap<SemanticId, Vec3> = new Map();
const EMPTY_LABELS: readonly PositionedAnnotation<SpatialLabel>[] = [];

/**
 * How many labels a viewport draws at once.
 *
 * Chosen to stay readable rather than to be generous: past roughly a dozen,
 * labels overlap each other faster than they inform, and the model disappears
 * behind its own annotation.
 */
export const DEFAULT_LABEL_BUDGET = 12;

/**
 * True when a state means the object is not drawn.
 *
 * Selection and hover both invalidate against this rather than against a list
 * of state names, so a state added later is covered by construction.
 */
function isRemoved(state: VisualState | undefined): boolean {
  return state !== undefined && NON_RENDERING_STATES.has(state);
}
