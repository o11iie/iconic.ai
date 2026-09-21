import { BaseSceneGraphProvider } from '@/engine/spatial/base-provider';
import { SpatialError } from '@/engine/spatial/errors';
import { resolveCapabilities } from '@/engine/spatial/capabilities';
import { completeLayer } from '@/engine/spatial/layers';
import type {
  LoadModelOptions,
  SpatialProviderCapabilities,
  SpatialProviderStatus,
  SpatialResult,
} from '@/engine/spatial/provider';
import type { FlyToOptions, ObjectSummary } from '@/engine/spatial/types';
import { err, ok } from '@/lib/result';
import type { SemanticId } from '@/lib/semantic-id';
import type {
  Relationship,
  SpatialCapabilities,
  SpatialLayer,
  SpatialObject,
  SpatialRegion,
  Vec3,
} from '@/types/domain/spatial';
import { manifestToGraph, objectIdsWhere } from '../mapping/graph';
import {
  normalizeHierarchy,
  regionsPresent,
  systemsPresent,
  type HierarchyNode,
} from '../mapping/hierarchy';
import {
  buildMeshMapping,
  buildProviderMapping,
  type AnatomyManifest,
} from '../mapping/manifest';
import { parseManifest } from '../mapping/validation';
import type {
  AnatomyModelVersion,
  AnatomyProvider,
  AnatomyStructureMetadata,
} from './anatomy-provider';
import type { AnatomyRegion, AnatomyRelationshipKind, AnatomySystem } from '../taxonomy';

/**
 * Hosted Anatomy Provider
 * =======================
 *
 * For licensed anatomy that authenticates.
 *
 * The browser never holds a provider credential and never talks to the vendor.
 * It asks VEO's own server, which holds the key, fetches and validates the
 * manifest, and returns it with a URL for the geometry that is time-limited
 * when the licence requires it:
 *
 *     browser  →  /api/anatomy/<modelRef>  →  licensed provider
 *
 * That indirection is what makes a signed-URL or token-authenticated licence
 * usable at all, and it is the same path whether or not the licence needs it.
 * A secure path only exercised in production is a path nobody has tested.
 *
 * This provider renders through VEO's own engine, so everything Gates 5–7
 * built — selection, layers, peel, dissection, exploded view — applies
 * unchanged. A vendor that owns its renderer would instead implement
 * `SpatialProvider` without `rendersIntoVeoScene` and mount its own component;
 * that is a different adapter, and deliberately not this one.
 *
 * ## Status
 *
 * This adapter is complete and exercised by the conformance suite. It has NOT
 * been run against a commercial anatomy vendor, because no licence or
 * credential exists in this environment. Vendor-specific request shaping —
 * whatever a particular provider's API expects — belongs in the server route,
 * not here, and is the one piece that a real integration still has to write.
 */
export class HostedAnatomyProvider extends BaseSceneGraphProvider implements AnatomyProvider {
  readonly id = 'hosted';

  protected readonly capabilities: SpatialProviderCapabilities = {
    ownsRenderer: false,
    supportsPartialLoad: true,
    supportsGhosting: true,
    supportsIsolation: true,
    supportsCutPlanes: false,
    supportsExplodedView: true,
    supportsAnimation: false,
    providesHierarchy: true,
    providesRelationships: true,
  };

  private manifest: AnatomyManifest | null = null;
  private meshMapping: Map<string, SemanticId> = new Map();
  private providerMapping: Map<string, SemanticId> = new Map();
  private hierarchy: HierarchyNode | null = null;
  private assetUrl: string | null = null;

  private readonly endpoint: string;

  /**
   * `endpoint` overrides VEO's own route. Exists so the conformance suite can
   * drive this provider against a controlled fixture without a live server.
   */
  constructor(options: { readonly endpoint?: string } = {}) {
    super();
    this.endpoint = (options.endpoint ?? '/api/anatomy').replace(/\/+$/, '');
  }

  /**
   * Ask the server whether anatomy can be served here.
   *
   * The reason for "no" comes from the server in the words a learner will
   * read, rather than being reconstructed in the browser from flags.
   */
  async initialize(): SpatialResult<SpatialProviderStatus> {
    try {
      const response = await fetch(this.endpoint, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        this.ready = false;
        this.notReadyReason = `VEO's anatomy service returned HTTP ${response.status}.`;
        return err(SpatialError.notConfigured(this.id));
      }

      const body = (await response.json()) as { configured?: boolean; reason?: string | null };

      if (!body.configured) {
        this.ready = false;
        this.notReadyReason =
          body.reason ?? 'No licensed anatomy source is configured for this deployment.';
        return err(SpatialError.notConfigured(this.id));
      }

      this.ready = true;
      this.notReadyReason = null;
      this.touch();
      return ok(this.getStatus());
    } catch {
      this.ready = false;
      this.notReadyReason = "VEO's anatomy service could not be reached.";
      return err(SpatialError.notConfigured(this.id));
    }
  }

  getAssetUrl(): string | null {
    return this.assetUrl;
  }

  getMeshMapping(): ReadonlyMap<string, SemanticId> {
    return this.meshMapping;
  }

  /** Provider object id -> VEO identity, for a vendor that addresses by id. */
  resolveProviderId(providerId: string): SemanticId | null {
    return this.providerMapping.get(providerId) ?? null;
  }

  async loadModel(modelRef: string, options?: LoadModelOptions) {
    if (!this.ready) return err(SpatialError.notConfigured(this.id));

    const { generation } = this.scene.dispatchLifecycle({ type: 'load', modelRef });
    options?.onProgress?.({ ratio: null, loadedBytes: 0, totalBytes: null, phase: 'downloading' });

    let payload: {
      manifest?: unknown;
      assetUrl?: string;
      message?: string;
      issues?: string[];
    };

    try {
      const response = await fetch(`${this.endpoint}/${encodeURIComponent(modelRef)}`, {
        signal: options?.signal ?? null,
        headers: { accept: 'application/json' },
      });
      payload = (await response.json()) as typeof payload;

      if (!response.ok) {
        const failure = SpatialError.modelUnavailable(
          modelRef,
          payload.message ?? `VEO's anatomy service returned HTTP ${response.status}`,
        );
        this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
        return err(failure);
      }
    } catch (cause) {
      const failure = SpatialError.assetLoadFailed(`${this.endpoint}/${modelRef}`, cause);
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    options?.onProgress?.({ ratio: null, loadedBytes: 0, totalBytes: null, phase: 'mapping' });

    /*
     * The server validated this manifest already. It is validated again here
     * because a client that trusts a response shape it did not verify is one
     * proxy away from rendering someone else's data under VEO's labels.
     */
    const parsed = parseManifest(payload.manifest);
    if (!parsed.ok) {
      const failure = SpatialError.modelUnavailable(
        modelRef,
        `${parsed.error.message} ${parsed.error.issues.join('; ')}`,
      );
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    const manifest = parsed.value;
    if (manifest.provider !== this.id && manifest.provider !== 'gltf-asset') {
      const failure = SpatialError.modelUnavailable(
        modelRef,
        `manifest is written for provider "${manifest.provider}", which this adapter cannot render`,
      );
      this.scene.dispatchLifecycle({ type: 'fail', error: failure.message, generation });
      return err(failure);
    }

    this.manifest = manifest;
    this.meshMapping = buildMeshMapping(manifest);
    this.providerMapping = buildProviderMapping(manifest);
    this.hierarchy = normalizeHierarchy(manifest);
    this.assetUrl = payload.assetUrl ?? null;

    const graph = manifestToGraph(manifest, { providerId: this.id, baseUrl: null });
    this.publishGraph(graph);
    this.scene.dispatchLifecycle({ type: 'loaded', generation });

    options?.onProgress?.({ ratio: 1, loadedBytes: 0, totalBytes: null, phase: 'ready' });
    return ok(graph);
  }

  // ---- AnatomyProvider ------------------------------------------------------

  async loadSystem(system: AnatomySystem): SpatialResult<SpatialLayer> {
    const layer = this.graph?.layers.find((candidate) => candidate.id === system);
    if (layer) return ok(layer);

    const objectIds = this.manifest
      ? objectIdsWhere(this.manifest, (object) => object.system === system)
      : [];

    if (objectIds.length === 0) {
      return err(
        SpatialError.modelUnavailable(
          system,
          'the loaded model contains no structures tagged with this system',
        ),
      );
    }

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

  async loadAnatomyRegion(region: AnatomyRegion): SpatialResult<SpatialRegion> {
    const existing = this.graph?.regions.find((candidate) => candidate.id === region);
    if (existing) return ok(existing);

    const objectIds = this.manifest
      ? objectIdsWhere(this.manifest, (object) => object.region === region)
      : [];

    if (objectIds.length === 0) {
      return err(
        SpatialError.modelUnavailable(
          region,
          'the loaded model contains no structures tagged with this region',
        ),
      );
    }

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

  override dispose(): void {
    this.manifest = null;
    this.meshMapping = new Map();
    this.providerMapping = new Map();
    this.hierarchy = null;
    this.assetUrl = null;
    super.dispose();
  }
}
