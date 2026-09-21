import type { SemanticId } from '@/lib/semantic-id';
import { completeLayer } from '@/engine/spatial/layers';
import type {
  ExplodedGroup,
  SpatialModel,
  SpatialModelGraph,
  SpatialObject,
} from '@/types/domain/spatial';
import type { AnatomyManifest, ManifestObject } from './manifest';

/**
 * Manifest → runtime graph.
 *
 * The one projection from VEO's authored contract into the shape the spatial
 * engine consumes. Both the asset-backed and the server-mediated providers use
 * it, so a model behaves identically however it was delivered — which is the
 * point of having a manifest at all.
 *
 * Every field here comes from the manifest. Nothing is derived, defaulted into
 * content, or filled in: a structure with no description arrives with none.
 */

export interface GraphProjectionOptions {
  /** The provider recorded on the model, for provenance. */
  readonly providerId: string;
  /** Base URL the asset and thumbnail are resolved against, when known. */
  readonly baseUrl: string | null;
}

/** Semantic ids of the manifest objects matching a predicate. */
export function objectIdsWhere(
  manifest: AnatomyManifest,
  predicate: (object: ManifestObject) => boolean,
): SemanticId[] {
  return manifest.objects.filter(predicate).map((object) => object.semanticId as SemanticId);
}

export function manifestToGraph(
  manifest: AnatomyManifest,
  options: GraphProjectionOptions,
): SpatialModelGraph {

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
      ...(object.explodedOffset ? { explodedOffset: object.explodedOffset } : {}),
      description: object.description,
      synonyms: object.synonyms,
      /*
       * Descriptive content passes through untouched, including its
       * references. VEO renders what the manifest's author wrote and
       * nothing more: a missing description stays missing rather than
       * being filled in from somewhere.
       */
      metadata: {
        officialName: object.officialName,
        latinName: object.latinName,
        laterality: object.laterality,
        function: object.function,
        clinicalNotes: object.clinicalNotes,
        references: object.references,
        educationalLevel: object.educationalLevel,
        externalIds: object.externalIds,
        providerId: object.providerId,
      },
    });
  }

  const model: SpatialModel = {
    id: manifest.modelId,
    domain: manifest.domain,
    name: manifest.name,
    description: manifest.description,
    thumbnailUrl:
      manifest.thumbnailPath && options.baseUrl ? `${options.baseUrl}/${manifest.thumbnailPath}` : null,
    provider: options.providerId,
    providerRef: manifest.assetPath,
    rootObjectId: manifest.rootObjectId as SemanticId,
    assetProfile: manifest.assetProfile,
    licence: manifest.licence,
    // Only restrictions reach the engine: it derives what is possible from
    // the graph and applies `false` from here on top.
    capabilities: manifest.capabilities,
    metadata: {
      modelVersion: manifest.modelVersion,
      manifestVersion: manifest.manifestVersion,
      formatVersion: manifest.formatVersion,
      body: manifest.body,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    model,
    objects,
    layers: manifest.layers.map((layer) =>
      completeLayer({
        id: layer.id,
        modelId: manifest.modelId,
        name: layer.name,
        description: layer.description,
        objectIds: objectIdsWhere(manifest, (object) => object.layers.includes(layer.id)),
        defaultVisible: layer.defaultVisible,
        order: layer.order,
        opacity: layer.opacity,
        peelable: layer.peelable,
        peelMode: layer.peelMode,
        colorToken: layer.colorToken,
      }),
    ),
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
      id: relationship.id ?? `${manifest.modelId}:rel:${index}`,
      sourceId: relationship.source as SemanticId,
      targetId: relationship.target as SemanticId,
      kind: relationship.kind,
      label: relationship.label,
      bidirectional: relationship.bidirectional,
      confidence: relationship.confidence,
      metadata: {},
    })),
    explosion: manifest.explosion.map(
      (group): ExplodedGroup => ({
        id: group.id,
        objectIds: group.objectIds as SemanticId[],
        center: group.center,
        scale: group.scale,
        spacing: group.spacing,
      }),
    ),
  };
}
