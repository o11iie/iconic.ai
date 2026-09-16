import { BaseSceneGraphProvider } from '@/engine/spatial/base-provider';
import { SpatialError } from '@/engine/spatial/errors';
import type {
  LoadModelOptions,
  SpatialProviderCapabilities,
  SpatialProviderStatus,
  SpatialResult,
} from '@/engine/spatial/provider';
import type { FlyToOptions, ObjectSummary } from '@/engine/spatial/types';
import { env } from '@/config/env';
import { err, ok } from '@/lib/result';
import type { SemanticId } from '@/lib/semantic-id';
import type {
  Relationship,
  SpatialLayer,
  SpatialModel,
  SpatialModelGraph,
  SpatialObject,
  SpatialRegion,
  Vec3,
} from '@/types/domain/spatial';
import {
  buildMeshMapping,
  parseManifest,
  type ManifestObject,
  type SpatialManifest,
} from '../mapping/manifest';
import type { AnatomyProvider, AnatomyStructureMetadata } from './anatomy-provider';
import {
  ANATOMY_REGIONS,
  ANATOMY_SYSTEMS,
  type AnatomyRegion,
  type AnatomyRelationshipKind,
  type AnatomySystem,
} from '../taxonomy';

/**
 * GLTF Asset Anatomy Provider
 * ===========================
 *
 * Loads LICENSED GLB/GLTF anatomy assets plus their semantic mapping manifest
 * and renders them through VEO's own React Three Fiber scene.
 *
 * This provider generates NO geometry of its own. If no licensed asset source
 * is configured it reports `ready: false` with an explicit reason, and every
 * anatomy surface in the product renders that reason instead of fabricating
 * something that looks like anatomy. Fake anatomy would be worse than no
 * anatomy: a learner cannot tell the difference, and the product's entire
 * promise is that what you see is true.
 *
 * Configure with:
 *   NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL=https://<licensed-asset-host>/models
 *
 * Expected layout at that base URL, per model:
 *   <base>/<modelRef>/manifest.json   validated by mapping/manifest.ts
 *   <base>/<modelRef>/<assetPath>     the licensed .glb/.gltf named in the manifest
 */
export class GltfAnatomyProvider extends BaseSceneGraphProvider implements AnatomyProvider {
  readonly id = 'gltf-asset';

  protected readonly capabilities: SpatialProviderCapabilities = {
    ownsRenderer: false,
    supportsPartialLoad: true,
    supportsGhosting: true,
    supportsIsolation: true,
    supportsCutPlanes: false,
    supportsExplodedView: false,
    supportsAnimation: false,
    providesHierarchy: true,
    providesRelationships: true,
  };

  private manifest: SpatialManifest | null = null;
  private meshMapping: Map<string, SemanticId> = new Map();
  private assetUrl: string | null = null;
  private baseUrl: string | null = null;
  private readonly configuredBaseUrl: string | undefined;

  /**
   * `baseUrl` overrides the environment. This exists so a deployment can serve
   * several licensed asset hosts from one build (and so the provider is
   * testable without global environment state).
   */
  constructor(options: { readonly baseUrl?: string } = {}) {
    super();
    this.configuredBaseUrl = options.baseUrl;
  }

  async initialize(): SpatialResult<SpatialProviderStatus> {
    const configured = this.configuredBaseUrl ?? env.NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL;

    if (!configured) {
      this.ready = false;
      this.notReadyReason =
        'No licensed spatial asset source is configured. Set NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL to the host serving your licensed GLB/GLTF anatomy assets.';
      return err(SpatialError.notConfigured(this.id));
    }

    this.baseUrl = configured.replace(/\/+$/, '');
    this.ready = true;
    this.notReadyReason = null;
    this.invalidate();

    return ok(this.getStatus());
  }

  getAssetUrl(): string | null {
    return this.assetUrl;
  }

  getMeshMapping(): ReadonlyMap<string, SemanticId> {
    return this.meshMapping;
  }

  async loadModel(modelRef: string, options?: LoadModelOptions): SpatialResult<SpatialModelGraph> {
    if (!this.ready || !this.baseUrl) {
      return err(SpatialError.notConfigured(this.id));
    }

    const manifestUrl = `${this.baseUrl}/${modelRef}/manifest.json`;
    options?.onProgress?.({
      ratio: null,
      loadedBytes: 0,
      totalBytes: null,
      phase: 'downloading',
    });

    let payload: unknown;
    try {
      const response = await fetch(manifestUrl, {
        signal: options?.signal ?? null,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        return err(
          SpatialError.modelUnavailable(
            modelRef,
            `manifest request failed with HTTP ${response.status}`,
          ),
        );
      }
      payload = await response.json();
    } catch (cause) {
      return err(SpatialError.assetLoadFailed(manifestUrl, cause));
    }

    options?.onProgress?.({ ratio: null, loadedBytes: 0, totalBytes: null, phase: 'mapping' });

    const parsed = parseManifest(payload);
    if (!parsed.ok) {
      return err(
        SpatialError.modelUnavailable(
          modelRef,
          `${parsed.error.message} ${parsed.error.issues.join('; ')}`,
        ),
      );
    }

    const manifest = parsed.value;
    this.manifest = manifest;
    this.meshMapping = buildMeshMapping(manifest);
    this.assetUrl = `${this.baseUrl}/${modelRef}/${manifest.assetPath}`;

    const graph = this.toGraph(manifest);
    this.graph = graph;
    this.invalidate();

    options?.onProgress?.({ ratio: 1, loadedBytes: 0, totalBytes: null, phase: 'ready' });
    return ok(graph);
  }

  // ---- AnatomyProvider ------------------------------------------------------

  async loadSystem(system: AnatomySystem, options?: LoadModelOptions): SpatialResult<SpatialLayer> {
    const layer = this.graph?.layers.find((candidate) => candidate.id === system);
    if (layer) return ok(layer);

    // Not a preloaded layer: synthesise one from the objects tagged with this
    // system. This is real grouping over real loaded data, not invented content.
    const objectIds = this.objectIdsWhere((object) => object.system === system);
    if (objectIds.length === 0) {
      return err(
        SpatialError.modelUnavailable(
          system,
          'the loaded model contains no structures tagged with this system',
        ),
      );
    }

    void options;
    return ok({
      id: system,
      modelId: this.graph?.model.id ?? '',
      name: system,
      description: null,
      objectIds,
      defaultVisible: true,
      order: 0,
      colorToken: null,
    });
  }

  async loadAnatomyRegion(
    region: AnatomyRegion,
    options?: LoadModelOptions,
  ): SpatialResult<SpatialRegion> {
    const existing = this.graph?.regions.find((candidate) => candidate.id === region);
    if (existing) return ok(existing);

    const objectIds = this.objectIdsWhere((object) => object.region === region);
    if (objectIds.length === 0) {
      return err(
        SpatialError.modelUnavailable(
          region,
          'the loaded model contains no structures tagged with this region',
        ),
      );
    }

    void options;
    return ok({
      id: region,
      modelId: this.graph?.model.id ?? '',
      semanticId: objectIds[0] as SemanticId,
      name: region,
      description: null,
      objectIds,
      boundingBox: null,
      providerRef: null,
    });
  }

  getStructure(semanticId: SemanticId): SpatialObject | null {
    return this.getObject(semanticId);
  }

  getStructureHierarchy(rootId?: SemanticId): readonly ObjectSummary[] {
    return this.getHierarchy(rootId);
  }

  getStructureMetadata(semanticId: SemanticId): AnatomyStructureMetadata | null {
    const object = this.getObject(semanticId);
    const source = this.manifest?.objects.find((entry) => entry.semanticId === semanticId);
    if (!object || !source) return null;

    return {
      semanticId,
      name: object.name,
      latinName: source.latinName,
      system: source.system,
      region: source.region,
      laterality: source.laterality,
      description: source.description,
      synonyms: source.synonyms,
      clinicalNotes: source.clinicalNotes,
      externalIds: source.externalIds,
    };
  }

  getRelatedStructures(
    semanticId: SemanticId,
    kinds?: readonly AnatomyRelationshipKind[],
  ): readonly Relationship[] {
    return this.getRelated(semanticId, kinds);
  }

  getStructurePosition(semanticId: SemanticId): Vec3 | null {
    return this.getPosition(semanticId);
  }

  /** Select, ghost the surrounding context, and fly the camera in. */
  focusStructure(semanticId: SemanticId, options: FlyToOptions = {}): void {
    this.select(semanticId);
    this.isolate(semanticId);
    this.flyTo(semanticId, options);
  }

  getAvailableSystems(): readonly AnatomySystem[] {
    if (!this.manifest) return [];
    const present = new Set<string>();
    for (const object of this.manifest.objects) {
      if (object.system) present.add(object.system);
    }
    return ANATOMY_SYSTEMS.filter((system) => present.has(system));
  }

  getAvailableRegions(): readonly AnatomyRegion[] {
    if (!this.manifest) return [];
    const present = new Set<string>();
    for (const object of this.manifest.objects) {
      if (object.region) present.add(object.region);
    }
    return ANATOMY_REGIONS.filter((region) => present.has(region));
  }

  // ---- internals ------------------------------------------------------------

  private objectIdsWhere(predicate: (object: ManifestObject) => boolean): SemanticId[] {
    if (!this.manifest) return [];
    return this.manifest.objects
      .filter(predicate)
      .map((object) => object.semanticId as SemanticId);
  }

  /** Project a validated manifest into the engine's runtime graph. */
  private toGraph(manifest: SpatialManifest): SpatialModelGraph {
    const now = new Date().toISOString();

    const childrenByParent = new Map<string, SemanticId[]>();
    for (const object of manifest.objects) {
      if (object.parentId === null) continue;
      const siblings = childrenByParent.get(object.parentId) ?? [];
      siblings.push(object.semanticId as SemanticId);
      childrenByParent.set(object.parentId, siblings);
    }

    const objects = new Map<SemanticId, SpatialObject>();
    for (const object of manifest.objects) {
      const semanticId = object.semanticId as SemanticId;
      objects.set(semanticId, {
        id: semanticId,
        modelId: manifest.modelId,
        semanticId,
        name: object.name,
        kind: object.kind,
        parentId: object.parentId as SemanticId | null,
        childIds: childrenByParent.get(object.semanticId) ?? [],
        system: object.system,
        region: object.region,
        layerIds: object.layers,
        providerMeshNames: object.meshes,
        boundingBox: object.boundingBox,
        description: object.description,
        synonyms: object.synonyms,
        metadata: {
          latinName: object.latinName,
          laterality: object.laterality,
          clinicalNotes: object.clinicalNotes,
          externalIds: object.externalIds,
        },
      });
    }

    const model: SpatialModel = {
      id: manifest.modelId,
      domain: manifest.domain,
      name: manifest.name,
      description: manifest.description,
      thumbnailUrl:
        manifest.thumbnailPath && this.baseUrl ? `${this.baseUrl}/${manifest.thumbnailPath}` : null,
      provider: this.id,
      providerRef: manifest.assetPath,
      rootObjectId: manifest.rootObjectId as SemanticId,
      assetProfile: manifest.assetProfile,
      licence: manifest.licence,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    return {
      model,
      objects,
      layers: manifest.layers.map((layer) => ({
        id: layer.id,
        modelId: manifest.modelId,
        name: layer.name,
        description: layer.description,
        objectIds: this.objectIdsWhere((object) => object.layers.includes(layer.id)),
        defaultVisible: layer.defaultVisible,
        order: layer.order,
        colorToken: layer.colorToken,
      })),
      regions: manifest.regions.map((region) => ({
        id: region.id,
        modelId: manifest.modelId,
        semanticId: region.semanticId as SemanticId,
        name: region.name,
        description: region.description,
        objectIds: region.objectIds as SemanticId[],
        boundingBox: region.boundingBox,
        providerRef: region.assetPath,
      })),
      relationships: manifest.relationships.map((relationship, index) => ({
        id: `${manifest.modelId}:rel:${index}`,
        sourceId: relationship.source as SemanticId,
        targetId: relationship.target as SemanticId,
        kind: relationship.kind,
        label: relationship.label,
        bidirectional: relationship.bidirectional,
        confidence: relationship.confidence,
        metadata: {},
      })),
    };
  }
}
