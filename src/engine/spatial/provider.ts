import type { Result } from '@/lib/result';
import type { SemanticId } from '@/lib/semantic-id';
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
import type { SpatialError } from './errors';
import type { FlyToOptions, LoadProgress, ObjectSummary } from './types';

/**
 * SpatialProvider
 * ===============
 *
 * The seam between VEO and whatever actually supplies 3D content.
 *
 * Three provider families must be able to sit behind this one interface:
 *   1. licensed third-party SDKs/APIs (vendor owns the renderer and hierarchy)
 *   2. licensed GLB/GLTF assets rendered by VEO's own engine
 *   3. future VEO-owned models
 *
 * Because (1) may own its own canvas while (2) and (3) render through VEO's
 * React Three Fiber scene, every visual operation is expressed as an *intent*
 * ("ghost this object") rather than a direct scene-graph mutation. A provider
 * that owns its renderer forwards the intent to its SDK; VEO's own renderer
 * resolves it through the visual-state reducer.
 *
 * Nothing in this interface is anatomy-specific.
 */

export type SpatialResult<T> = Promise<Result<T, SpatialError>>;

/** What a provider can actually do. The UI reads this to avoid dead controls. */
export interface SpatialProviderCapabilities {
  /** Provider draws into its own canvas rather than VEO's scene graph. */
  readonly ownsRenderer: boolean;
  readonly supportsPartialLoad: boolean;
  readonly supportsGhosting: boolean;
  readonly supportsIsolation: boolean;
  readonly supportsCutPlanes: boolean;
  readonly supportsExplodedView: boolean;
  readonly supportsAnimation: boolean;
  readonly providesHierarchy: boolean;
  readonly providesRelationships: boolean;
}

export interface SpatialProviderStatus {
  readonly id: string;
  readonly ready: boolean;
  /** Human-readable reason when `ready` is false. Surfaced to the user. */
  readonly reason: string | null;
  readonly capabilities: SpatialProviderCapabilities;
}

export interface LoadModelOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LoadProgress) => void;
}

/**
 * The core provider contract.
 *
 * Read operations are synchronous where the data is already resolved in the
 * graph, and asynchronous where they may hit the network.
 */
export interface SpatialProvider {
  readonly id: string;

  // ---- lifecycle ----------------------------------------------------------
  initialize(): SpatialResult<SpatialProviderStatus>;
  getStatus(): SpatialProviderStatus;
  dispose(): void;

  // ---- loading ------------------------------------------------------------
  /** Load a full model and its semantic graph. */
  loadModel(modelRef: string, options?: LoadModelOptions): SpatialResult<SpatialModelGraph>;
  /** Load only a named sub-volume, when the provider supports partial loading. */
  loadRegion(regionId: string, options?: LoadModelOptions): SpatialResult<SpatialRegion>;
  /** Load one toggleable slice (a "system" in anatomy, a subassembly elsewhere). */
  loadLayer(layerId: string, options?: LoadModelOptions): SpatialResult<SpatialLayer>;
  unloadModel(): void;

  // ---- structure queries --------------------------------------------------
  getModel(): SpatialModel | null;
  getObject(semanticId: SemanticId): SpatialObject | null;
  getHierarchy(rootId?: SemanticId): readonly ObjectSummary[];
  getObjectMetadata(semanticId: SemanticId): Readonly<Record<string, unknown>> | null;
  getRelated(
    semanticId: SemanticId,
    kinds?: readonly RelationshipKind[],
  ): readonly Relationship[];
  search(query: string, limit?: number): readonly ObjectSummary[];

  // ---- geometry queries ---------------------------------------------------
  getBoundingBox(semanticId: SemanticId): BoundingBox | null;
  getPosition(semanticId: SemanticId): Vec3 | null;

  // ---- presentation intents ----------------------------------------------
  select(semanticId: SemanticId | null): void;
  highlight(semanticIds: readonly SemanticId[]): void;
  hide(semanticIds: readonly SemanticId[]): void;
  show(semanticIds: readonly SemanticId[]): void;
  ghost(semanticIds: readonly SemanticId[]): void;
  isolate(semanticId: SemanticId): void;
  /** Return every object to its default visual state. */
  restore(): void;

  // ---- camera intents -----------------------------------------------------
  flyTo(semanticId: SemanticId, options?: FlyToOptions): void;
  resetCamera(options?: FlyToOptions): void;
  fitToSelection(options?: FlyToOptions): void;
}

/**
 * Providers that render into VEO's own scene expose the asset URL and mapping
 * so the React Three Fiber layer can mount it. SDK-owned providers do not
 * implement this and instead mount their own component.
 */
export interface SceneGraphProvider extends SpatialProvider {
  readonly rendersIntoVeoScene: true;
  /** Resolved URL of the GLB/GLTF asset to mount. */
  getAssetUrl(): string | null;
  /** Vendor mesh name -> VEO semantic id. */
  getMeshMapping(): ReadonlyMap<string, SemanticId>;
}

export function isSceneGraphProvider(
  provider: SpatialProvider,
): provider is SceneGraphProvider {
  return (provider as SceneGraphProvider).rendersIntoVeoScene === true;
}

/** A provider factory, registered by id. */
export interface SpatialProviderFactory {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  create(): SpatialProvider;
}
