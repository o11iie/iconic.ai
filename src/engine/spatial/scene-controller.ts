import { isDescendantOf, type SemanticId } from '@/lib/semantic-id';
import { SpatialObjectRegistry, type SceneNode } from './object-registry';
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

export class SceneController<TNode extends SceneNode = SceneNode> {
  readonly registry = new SpatialObjectRegistry<TNode>();

  private selectedId: SemanticId | null = null;
  private hoveredId: SemanticId | null = null;
  private highlightedIds = new Set<SemanticId>();
  private hiddenIds = new Set<SemanticId>();
  private ghostedIds = new Set<SemanticId>();
  private isolatedId: SemanticId | null = null;
  private hiddenLayerIds = new Set<string>();

  /** Every addressable object, and the layers each belongs to. */
  private objectIds: readonly SemanticId[] = [];
  private layerMembership = new Map<SemanticId, readonly string[]>();

  private lifecycle: ModelLifecycleState = INITIAL_LIFECYCLE;

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
      this.objectIds = [];
      this.layerMembership = new Map();
    }

    this.invalidate();
    return next;
  }

  getLifecycle(): ModelLifecycleState {
    return this.lifecycle;
  }

  // ---- selection and emphasis --------------------------------------------

  select(semanticId: SemanticId | null): void {
    if (this.selectedId === semanticId) return;
    this.selectedId = semanticId;
    this.invalidate();
  }

  setHovered(semanticId: SemanticId | null): void {
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
