import { isDescendantOf, type SemanticId } from '@/lib/semantic-id';
import type {
  BoundingBox,
  Relationship,
  RelationshipKind,
  SpatialLayer,
  SpatialModel,
  SpatialModelGraph,
  SpatialObject,
  SpatialRegion,
  Vec3,
} from '@/types/domain/spatial';
import { SpatialError } from './errors';
import type {
  LoadModelOptions,
  SceneGraphProvider,
  SpatialProviderCapabilities,
  SpatialProviderStatus,
  SpatialResult,
} from './provider';
import { SceneController, type CameraCommand, type SceneSnapshot } from './scene-controller';
import type { FlyToOptions, ObjectSummary, SceneVisualState } from './types';
import type { ModelLifecycleState } from './model-lifecycle';

export type { CameraCommand } from './scene-controller';

/**
 * Snapshot exposed to React.
 *
 * Composes the scene controller's state (selection, visual state, camera,
 * lifecycle) with the provider's own resolved graph.
 */
export interface ProviderSnapshot {
  readonly visual: SceneVisualState;
  readonly selectedId: SemanticId | null;
  readonly hoveredId: SemanticId | null;
  readonly camera: CameraCommand | null;
  readonly graph: SpatialModelGraph | null;
  readonly lifecycle: ModelLifecycleState;
  readonly revision: number;
}

/**
 * The observable surface a provider exposes to React.
 *
 * Kept separate from `SpatialProvider` because a provider that owns its own
 * renderer (a licensed SDK) may push updates through its own mechanism. React
 * binds through `useSyncExternalStore`, which needs exactly these two.
 */
export interface ObservableSpatialProvider {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ProviderSnapshot;
}

export function isObservableProvider(value: unknown): value is ObservableSpatialProvider {
  const candidate = value as Partial<ObservableSpatialProvider> | null;
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof candidate.subscribe === 'function' &&
    typeof candidate.getSnapshot === 'function'
  );
}

/**
 * Shared implementation of every non-transport concern a scene-graph provider
 * needs: hierarchy queries, relationship lookup, search, and delegation of all
 * scene state to a single `SceneController`.
 *
 * A concrete provider therefore only has to implement *loading* — which is the
 * part that actually differs between a licensed asset set, a licensed SDK and
 * a future VEO-owned pipeline.
 *
 * Scene state is NOT duplicated here. Selection, visibility, isolation and
 * camera intents all live in the controller, so the engine's renderer and the
 * provider API are two views of one truth rather than two copies of it.
 */
export abstract class BaseSceneGraphProvider implements SceneGraphProvider {
  readonly rendersIntoVeoScene = true as const;

  abstract readonly id: string;
  protected abstract readonly capabilities: SpatialProviderCapabilities;

  /** The single owner of scene state. Exposed so the renderer can bind to it. */
  readonly scene = new SceneController();

  protected graph: SpatialModelGraph | null = null;
  protected ready = false;
  protected notReadyReason: string | null = 'Provider has not been initialised.';

  private snapshot: ProviderSnapshot | null = null;
  private lastSceneSnapshot: SceneSnapshot | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    // Re-emit controller changes to provider subscribers, and drop the cached
    // composite snapshot so it is rebuilt from the new scene state.
    this.scene.subscribe(() => {
      this.snapshot = null;
      for (const listener of this.listeners) listener();
    });
  }

  // ---- subclass responsibilities -------------------------------------------
  abstract initialize(): SpatialResult<SpatialProviderStatus>;
  abstract loadModel(modelRef: string, options?: LoadModelOptions): SpatialResult<SpatialModelGraph>;
  abstract getAssetUrl(): string | null;
  abstract getMeshMapping(): ReadonlyMap<string, SemanticId>;

  // ---- lifecycle -----------------------------------------------------------
  getStatus(): SpatialProviderStatus {
    return {
      id: this.id,
      ready: this.ready,
      reason: this.notReadyReason,
      capabilities: this.capabilities,
    };
  }

  dispose(): void {
    this.unloadModel();
    this.scene.dispose();
    this.listeners.clear();
  }

  unloadModel(): void {
    this.graph = null;
    this.scene.dispatchLifecycle({ type: 'unload' });
  }

  /**
   * Publish a freshly resolved graph to the controller.
   *
   * Called by subclasses once loading succeeds. This is what tells the scene
   * which objects exist and which layers they belong to.
   */
  protected publishGraph(graph: SpatialModelGraph): void {
    this.graph = graph;

    const layerMembership = new Map<SemanticId, readonly string[]>();
    for (const [id, object] of graph.objects) layerMembership.set(id, object.layerIds);

    this.scene.setObjects([...graph.objects.keys()], layerMembership);
  }

  // ---- React integration ---------------------------------------------------
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProviderSnapshot => {
    const sceneSnapshot = this.scene.getSnapshot();

    // Rebuild only when the scene actually changed or the graph was replaced.
    if (this.snapshot && this.lastSceneSnapshot === sceneSnapshot) return this.snapshot;

    this.lastSceneSnapshot = sceneSnapshot;
    this.snapshot = {
      visual: sceneSnapshot.visual,
      selectedId: sceneSnapshot.selectedId,
      hoveredId: sceneSnapshot.hoveredId,
      camera: sceneSnapshot.camera,
      lifecycle: sceneSnapshot.lifecycle,
      revision: sceneSnapshot.revision,
      graph: this.graph,
    };

    return this.snapshot;
  };

  /**
   * Force a snapshot rebuild and notify subscribers.
   *
   * For changes outside scene state — provider readiness, for example — which
   * the controller does not own but consumers still re-read.
   */
  protected touch(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  // ---- partial loading -----------------------------------------------------
  async loadRegion(regionId: string): SpatialResult<SpatialRegion> {
    const region = this.graph?.regions.find((candidate) => candidate.id === regionId);
    if (!region) return { ok: false, error: SpatialError.objectNotFound(regionId) };
    return { ok: true, value: region };
  }

  async loadLayer(layerId: string): SpatialResult<SpatialLayer> {
    const layer = this.graph?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return { ok: false, error: SpatialError.objectNotFound(layerId) };
    return { ok: true, value: layer };
  }

  // ---- structure queries ---------------------------------------------------
  getModel(): SpatialModel | null {
    return this.graph?.model ?? null;
  }

  getObject(semanticId: SemanticId): SpatialObject | null {
    return this.graph?.objects.get(semanticId) ?? null;
  }

  getHierarchy(rootId?: SemanticId): readonly ObjectSummary[] {
    if (!this.graph) return [];

    const summaries: ObjectSummary[] = [];
    for (const object of this.graph.objects.values()) {
      if (rootId && object.semanticId !== rootId && !isDescendantOf(object.semanticId, rootId)) {
        continue;
      }
      summaries.push({
        semanticId: object.semanticId,
        name: object.name,
        parentId: object.parentId,
        childIds: object.childIds,
        boundingBox: object.boundingBox,
      });
    }
    return summaries;
  }

  getObjectMetadata(semanticId: SemanticId): Readonly<Record<string, unknown>> | null {
    return this.getObject(semanticId)?.metadata ?? null;
  }

  getRelated(semanticId: SemanticId, kinds?: readonly RelationshipKind[]): readonly Relationship[] {
    if (!this.graph) return [];
    const kindFilter = kinds && kinds.length > 0 ? new Set<string>(kinds) : null;

    return this.graph.relationships.filter((relationship) => {
      const touches =
        relationship.sourceId === semanticId ||
        (relationship.bidirectional && relationship.targetId === semanticId);
      if (!touches) return false;
      return kindFilter === null || kindFilter.has(relationship.kind);
    });
  }

  search(query: string, limit = 20): readonly ObjectSummary[] {
    if (!this.graph) return [];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const matches: ObjectSummary[] = [];
    for (const object of this.graph.objects.values()) {
      if (matches.length >= limit) break;
      const haystack = [object.name, object.semanticId, ...object.synonyms].join(' ').toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({
          semanticId: object.semanticId,
          name: object.name,
          parentId: object.parentId,
          childIds: object.childIds,
          boundingBox: object.boundingBox,
        });
      }
    }
    return matches;
  }

  // ---- geometry queries ----------------------------------------------------
  getBoundingBox(semanticId: SemanticId): BoundingBox | null {
    return this.getObject(semanticId)?.boundingBox ?? null;
  }

  getPosition(semanticId: SemanticId): Vec3 | null {
    const box = this.getBoundingBox(semanticId);
    if (!box) return null;
    return [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ];
  }

  // ---- presentation intents (delegated) ------------------------------------
  select(semanticId: SemanticId | null): void {
    this.scene.select(semanticId);
  }

  setHovered(semanticId: SemanticId | null): void {
    this.scene.setHovered(semanticId);
  }

  highlight(semanticIds: readonly SemanticId[]): void {
    this.scene.highlight(semanticIds);
  }

  hide(semanticIds: readonly SemanticId[]): void {
    this.scene.hide(semanticIds);
  }

  show(semanticIds: readonly SemanticId[]): void {
    this.scene.show(semanticIds);
  }

  ghost(semanticIds: readonly SemanticId[]): void {
    this.scene.ghost(semanticIds);
  }

  isolate(semanticId: SemanticId): void {
    if (!this.graph) return;
    this.scene.isolate(semanticId);
  }

  restore(): void {
    this.scene.restore();
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.scene.setLayerVisible(layerId, visible);
  }

  // ---- camera intents (delegated) ------------------------------------------
  flyTo(semanticId: SemanticId, options: FlyToOptions = {}): void {
    this.scene.flyTo(semanticId, options);
  }

  resetCamera(options: FlyToOptions = {}): void {
    this.scene.resetCamera(options);
  }

  fitToModel(options: FlyToOptions = {}): void {
    this.scene.fitToModel(options);
  }

  fitToSelection(options: FlyToOptions = {}): void {
    this.scene.fitToSelection(options);
  }
}
