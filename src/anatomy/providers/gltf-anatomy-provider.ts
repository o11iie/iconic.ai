import { BaseSceneGraphProvider } from '@/engine/spatial/base-provider';
import { SpatialError } from '@/engine/spatial/errors';
import { completeLayer } from '@/engine/spatial/layers';
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
  SpatialCapabilities,
  SpatialLayer,
  SpatialModelGraph,
  SpatialObject,
  SpatialRegion,
  Vec3,
} from '@/types/domain/spatial';
import { resolveCapabilities } from '@/engine/spatial/capabilities';
import {
  buildMeshMapping,
  buildProviderMapping,
  type AnatomyManifest,
} from '../mapping/manifest';
import { parseManifest } from '../mapping/validation';
import { manifestToGraph, objectIdsWhere } from '../mapping/graph';
import {
  normalizeHierarchy,
  regionsPresent,
  systemsPresent,
  type HierarchyNode,
} from '../mapping/hierarchy';
import type {
  AnatomyModelVersion,
  AnatomyProvider,
  AnatomyStructureMetadata,
} from './anatomy-provider';
import { ANATOMY_DOMAIN } from '../taxonomy';
import type {
  AnatomyRegion,
  AnatomyRelationshipKind,
  AnatomySystem,
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
    // VEO's own engine performs the exploded view, using the displacements the
    // manifest declares. Reported true because this provider renders through
    // that engine; a provider owning its renderer would report its own answer.
    supportsExplodedView: true,
    supportsAnimation: false,
    providesHierarchy: true,
    providesRelationships: true,
  };

  private manifest: AnatomyManifest | null = null;
  private meshMapping: Map<string, SemanticId> = new Map();
  /** Provider object id -> VEO identity. Unused by this provider; see below. */
  private providerMapping: Map<string, SemanticId> = new Map();
  private hierarchy: HierarchyNode | null = null;
  private assetUrl: string | null = null;
  private baseUrl: string | null = null;
  /** The model currently loaded, so partial assets resolve against it. */
  private modelRef: string | null = null;
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
    this.touch();

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

    // Entering the lifecycle bumps the generation, so a load already in
    // flight for a different model cannot complete into this one.
    const { generation } = this.scene.dispatchLifecycle({ type: 'load', modelRef });

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
        const failure = SpatialError.modelUnavailable(
          modelRef,
          `manifest request failed with HTTP ${response.status}`,
        );
        this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
        return err(failure);
      }
      payload = await response.json();
    } catch (cause) {
      const failure = SpatialError.assetLoadFailed(manifestUrl, cause);
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    options?.onProgress?.({ ratio: null, loadedBytes: 0, totalBytes: null, phase: 'mapping' });

    const parsed = parseManifest(payload);
    if (!parsed.ok) {
      const failure = SpatialError.modelUnavailable(
        modelRef,
        `${parsed.error.message} ${parsed.error.issues.join('; ')}`,
      );
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    const manifest = parsed.value;

    /*
     * A manifest written for another provider describes objects this one
     * cannot address. Loading it anyway would render geometry under labels
     * that were never meant for it — the exact silent mislabelling the
     * manifest contract exists to prevent.
     */
    /*
     * This is the ANATOMY provider. A manifest from another domain describes
     * structures that are not body structures, and loading one here would put
     * them in front of a learner inside the anatomy workspace. Diagnostic
     * content has its own clearly-labelled path and does not come through here.
     */
    if (manifest.domain !== ANATOMY_DOMAIN) {
      const failure = SpatialError.modelUnavailable(
        modelRef,
        `manifest declares domain "${manifest.domain}"; the anatomy provider loads only anatomy`,
      );
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    if (manifest.provider !== this.id) {
      const failure = SpatialError.modelUnavailable(
        modelRef,
        `manifest is written for provider "${manifest.provider}", not "${this.id}"`,
      );
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    this.manifest = manifest;
    this.meshMapping = buildMeshMapping(manifest);
    this.providerMapping = buildProviderMapping(manifest);
    this.hierarchy = normalizeHierarchy(manifest);
    this.modelRef = modelRef;
    this.assetUrl = `${this.baseUrl}/${modelRef}/${manifest.assetPath}`;

    const graph = manifestToGraph(manifest, { providerId: this.id, baseUrl: this.baseUrl });
    // publishGraph tells the scene controller which objects now exist, which
    // is what makes selection and visual state resolvable.
    this.publishGraph(graph);
    this.scene.dispatchLifecycle({ type: 'loaded', generation });

    options?.onProgress?.({ ratio: 1, loadedBytes: 0, totalBytes: null, phase: 'ready' });
    return ok(graph);
  }

  // ---- AnatomyProvider ------------------------------------------------------

  /**
   * Load one body system.
   *
   * A manifest may declare a separate asset per system, which is how a whole
   * body becomes loadable at all: downloading every system to look at the
   * skeleton would cost a learner minutes and a phone its memory. When such an
   * asset is declared, it is fetched and its URL becomes the one the viewport
   * mounts. When it is not, the system is a grouping over structures already
   * loaded — real data, narrower view.
   */
  async loadSystem(system: AnatomySystem, options?: LoadModelOptions): SpatialResult<SpatialLayer> {
    const declared = this.manifest?.systems.find((candidate) => candidate.id === system);

    if (declared?.assetPath && this.baseUrl && this.modelRef) {
      const url = `${this.baseUrl}/${this.modelRef}/${declared.assetPath}`;
      const reachable = await this.confirmAsset(url, options?.signal ?? null);
      if (!reachable.ok) return reachable;
      this.assetUrl = url;
      this.touch();
    }

    const layer = this.graph?.layers.find((candidate) => candidate.id === system);
    if (layer) return ok(layer);

    // Not a preloaded layer: synthesise one from the objects tagged with this
    // system. This is real grouping over real loaded data, not invented content.
    const objectIds = this.manifest ? objectIdsWhere(this.manifest, (o) => o.system === system) : [];
    if (objectIds.length === 0) {
      return err(
        SpatialError.modelUnavailable(
          system,
          'the loaded model contains no structures tagged with this system',
        ),
      );
    }

    void options;
    return ok(
      completeLayer({
        id: system,
        modelId: this.graph?.model.id ?? '',
        name: system,
        description: null,
        objectIds,
        defaultVisible: true,
        order: 0,
        colorToken: null,
      }),
    );
  }

  /**
   * Load one body region.
   *
   * The same progressive path as `loadSystem`, cutting the model the other
   * way: a learner studying the thorax should not wait for the lower limb.
   */
  async loadAnatomyRegion(
    region: AnatomyRegion,
    options?: LoadModelOptions,
  ): SpatialResult<SpatialRegion> {
    const declared = this.manifest?.regions.find((candidate) => candidate.id === region);

    if (declared?.assetPath && this.baseUrl && this.modelRef) {
      const url = `${this.baseUrl}/${this.modelRef}/${declared.assetPath}`;
      const reachable = await this.confirmAsset(url, options?.signal ?? null);
      if (!reachable.ok) return reachable;
      this.assetUrl = url;
      this.touch();
    }

    const existing = this.graph?.regions.find((candidate) => candidate.id === region);
    if (existing) return ok(existing);

    const objectIds = this.manifest ? objectIdsWhere(this.manifest, (o) => o.region === region) : [];
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
    return this.manifest ? systemsPresent(this.manifest) : [];
  }

  getAvailableRegions(): readonly AnatomyRegion[] {
    return this.manifest ? regionsPresent(this.manifest) : [];
  }

  getNormalizedHierarchy(): HierarchyNode | null {
    return this.hierarchy;
  }

  getManifest(): AnatomyManifest | null {
    return this.manifest;
  }

  /**
   * What can be done to the loaded model.
   *
   * The engine derives this from the graph and narrows it by what the manifest
   * permits; this narrows it again by what the PROVIDER can actually drive. A
   * provider that owns its own renderer and cannot ghost reports no ghosting,
   * whatever the data would allow.
   */
  getCapabilities(): SpatialCapabilities {
    const derived = resolveCapabilities(this.scene.getGraph());

    return {
      ...derived,
      supportsGhosting: derived.supportsGhosting && this.capabilities.supportsGhosting,
      supportsIsolation: derived.supportsIsolation && this.capabilities.supportsIsolation,
      supportsExplosion: derived.supportsExplosion && this.capabilities.supportsExplodedView,
      supportsRelationships:
        derived.supportsRelationships && this.capabilities.providesRelationships,
    };
  }

  /**
   * Confirm a partial asset exists before pointing the viewport at it.
   *
   * A HEAD request, so a missing file is an error the learner can read rather
   * than a viewport that mounts a URL and renders nothing. Cheap enough to be
   * worth it; the alternative is a blank canvas with no explanation.
   */
  private async confirmAsset(url: string, signal: AbortSignal | null): SpatialResult<true> {
    try {
      const response = await fetch(url, { method: 'HEAD', signal });
      if (!response.ok) {
        return err(
          SpatialError.modelUnavailable(
            url,
            `the licensed asset host returned HTTP ${response.status} for this part of the model`,
          ),
        );
      }
      return ok(true);
    } catch (cause) {
      return err(SpatialError.assetLoadFailed(url, cause));
    }
  }

  getModelVersion(): AnatomyModelVersion | null {
    if (!this.manifest) return null;
    return {
      provider: this.manifest.provider,
      modelId: this.manifest.modelId,
      modelVersion: this.manifest.modelVersion,
      manifestVersion: this.manifest.manifestVersion,
      formatVersion: this.manifest.formatVersion,
    };
  }

}
