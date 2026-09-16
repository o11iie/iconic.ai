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
import type { FlyToOptions, ObjectSummary, SceneVisualState } from './types';
import { computeIsolationSets, resolveVisualState } from './visual-state';

/**
 * Camera commands are queued rather than executed, because the provider does
 * not own the camera — the React Three Fiber controller does. `version` lets
 * the controller detect a new command without deep comparison.
 */
export interface CameraCommand {
  readonly version: number;
  readonly kind: 'fly_to' | 'reset' | 'fit_selection';
  readonly targetId: SemanticId | null;
  readonly options: FlyToOptions;
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

export interface ProviderSnapshot {
  readonly visual: SceneVisualState;
  readonly selectedId: SemanticId | null;
  readonly hoveredId: SemanticId | null;
  readonly camera: CameraCommand | null;
  readonly graph: SpatialModelGraph | null;
  readonly revision: number;
}

/**
 * Shared implementation of every non-transport concern a scene-graph provider
 * needs: hierarchy queries, relationship lookup, visual state, isolation,
 * camera intents and change notification.
 *
 * A concrete provider therefore only has to implement *loading* — which is the
 * part that actually differs between a licensed asset set, a licensed SDK and a
 * future VEO-owned pipeline.
 */
export abstract class BaseSceneGraphProvider implements SceneGraphProvider {
  readonly rendersIntoVeoScene = true as const;

  abstract readonly id: string;
  protected abstract readonly capabilities: SpatialProviderCapabilities;

  protected graph: SpatialModelGraph | null = null;
  protected ready = false;
  protected notReadyReason: string | null = 'Provider has not been initialised.';

  private selectedId: SemanticId | null = null;
  private hoveredId: SemanticId | null = null;
  private highlightedIds = new Set<SemanticId>();
  private hiddenIds = new Set<SemanticId>();
  private ghostedIds = new Set<SemanticId>();
  private isolatedId: SemanticId | null = null;
  private hiddenLayerIds = new Set<string>();

  private cameraCommand: CameraCommand | null = null;
  private cameraVersion = 0;
  private revision = 0;

  private listeners = new Set<() => void>();
  private snapshot: ProviderSnapshot | null = null;

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
    this.listeners.clear();
  }

  unloadModel(): void {
    this.graph = null;
    this.restore();
    this.invalidate();
  }

  // ---- React integration ---------------------------------------------------
  /** Subscribe for `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable snapshot for `useSyncExternalStore`; only changes on invalidate. */
  getSnapshot = (): ProviderSnapshot => {
    if (this.snapshot) return this.snapshot;

    const objectIds = this.graph ? [...this.graph.objects.keys()] : [];
    const layerMembership = new Map<SemanticId, readonly string[]>();
    if (this.graph) {
      for (const [id, object] of this.graph.objects) {
        layerMembership.set(id, object.layerIds);
      }
    }

    this.snapshot = {
      visual: resolveVisualState({
        objectIds,
        selectedId: this.selectedId,
        hoveredId: this.hoveredId,
        highlightedIds: this.highlightedIds,
        hiddenIds: this.hiddenIds,
        ghostedIds: this.ghostedIds,
        isolatedId: this.isolatedId,
        hiddenLayerIds: this.hiddenLayerIds,
        layerMembership,
      }),
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      camera: this.cameraCommand,
      graph: this.graph,
      revision: this.revision,
    };

    return this.snapshot;
  };

  protected invalidate(): void {
    this.revision += 1;
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  // ---- partial loading -----------------------------------------------------
  async loadRegion(regionId: string): SpatialResult<SpatialRegion> {
    const region = this.graph?.regions.find((candidate) => candidate.id === regionId);
    if (!region) {
      return { ok: false, error: SpatialError.objectNotFound(regionId) };
    }
    return { ok: true, value: region };
  }

  async loadLayer(layerId: string): SpatialResult<SpatialLayer> {
    const layer = this.graph?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      return { ok: false, error: SpatialError.objectNotFound(layerId) };
    }
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

  getRelated(
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
      const haystack = [object.name, object.semanticId, ...object.synonyms]
        .join(' ')
        .toLowerCase();
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

  // ---- presentation intents ------------------------------------------------
  select(semanticId: SemanticId | null): void {
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
   * Isolate a subtree. Context geometry is ghosted rather than deleted so the
   * learner keeps their spatial bearings — this is a learning product, and
   * losing orientation defeats the purpose.
   */
  isolate(semanticId: SemanticId): void {
    if (!this.graph) return;
    const { hidden, ghosted } = computeIsolationSets(
      [...this.graph.objects.keys()],
      semanticId,
      this.capabilities.supportsGhosting,
    );
    this.isolatedId = semanticId;
    this.hiddenIds = hidden;
    this.ghostedIds = ghosted;
    this.invalidate();
  }

  restore(): void {
    this.selectedId = null;
    this.hoveredId = null;
    this.highlightedIds = new Set();
    this.hiddenIds = new Set();
    this.ghostedIds = new Set();
    this.isolatedId = null;
    this.hiddenLayerIds = new Set();
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

  // ---- camera intents ------------------------------------------------------
  flyTo(semanticId: SemanticId, options: FlyToOptions = {}): void {
    this.cameraVersion += 1;
    this.cameraCommand = {
      version: this.cameraVersion,
      kind: 'fly_to',
      targetId: semanticId,
      options,
    };
    this.invalidate();
  }

  resetCamera(options: FlyToOptions = {}): void {
    this.cameraVersion += 1;
    this.cameraCommand = { version: this.cameraVersion, kind: 'reset', targetId: null, options };
    this.invalidate();
  }

  fitToSelection(options: FlyToOptions = {}): void {
    this.cameraVersion += 1;
    this.cameraCommand = {
      version: this.cameraVersion,
      kind: 'fit_selection',
      targetId: this.selectedId,
      options,
    };
    this.invalidate();
  }
}
