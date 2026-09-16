import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, KnowledgeDomain, Metadata, Timestamped, UUID } from './primitives';

/**
 * Domain-agnostic spatial model types.
 *
 * NOTHING in this file is anatomy-specific. A `SpatialModel` describes a heart,
 * a benzene ring, a turbofan, a cathedral or a stellar interior equally well.
 * Anatomy-specific concepts (body systems, planes, laterality) are expressed
 * through `metadata` and the anatomy layer in `src/anatomy`.
 */

/** Which implementation can load and drive a given model. */
export type SpatialProviderId = string;

/** Right-handed, Y-up, metres. Matches glTF's coordinate convention. */
export type Vec3 = readonly [x: number, y: number, z: number];

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface SpatialTransform {
  readonly position: Vec3;
  /** Euler angles in radians, XYZ order. */
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export const IDENTITY_TRANSFORM: SpatialTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/**
 * A loadable spatial asset plus the semantic structure layered over it.
 *
 * `provider` + `providerRef` tell the provider layer how to fetch geometry.
 * `rootObjectId` is a VEO semantic id, so learning content never references
 * vendor mesh names.
 */
export interface SpatialModel extends Timestamped {
  readonly id: UUID;
  readonly domain: KnowledgeDomain;
  readonly name: string;
  readonly description: string | null;
  readonly thumbnailUrl: string | null;
  readonly provider: SpatialProviderId;
  /** Opaque handle the provider understands (asset path, SDK model key, ...). */
  readonly providerRef: string;
  readonly rootObjectId: SemanticId;
  /** Declared level of detail / file weight, used to plan loading strategy. */
  readonly assetProfile: SpatialAssetProfile;
  readonly licence: SpatialLicence;
  readonly metadata: Metadata;
}

export interface SpatialAssetProfile {
  /** Approximate download size in bytes, when known. Drives loading UX. */
  readonly approximateBytes: number | null;
  readonly triangleCount: number | null;
  readonly hasDracoCompression: boolean;
  readonly hasKtx2Textures: boolean;
}

/**
 * Licensing is first-class. VEO must never render a model it is not entitled
 * to, and must be able to say precisely why something is unavailable.
 */
export interface SpatialLicence {
  readonly holder: string;
  readonly kind: 'licensed_sdk' | 'licensed_asset' | 'veo_owned' | 'open_source';
  readonly expiresAt: ISODateString | null;
  readonly attributionRequired: boolean;
}

/** Node types a spatial model can contain, independent of subject matter. */
export const SPATIAL_OBJECT_KINDS = [
  'group', // organisational node with no geometry of its own
  'structure', // an addressable, selectable thing with geometry
  'surface', // a boundary or interface
  'cavity', // an enclosed void
  'conduit', // a tube/channel/path
  'field', // a volumetric field or region of influence
  'annotation', // a non-geometric marker
] as const;
export type SpatialObjectKind = (typeof SPATIAL_OBJECT_KINDS)[number];

/**
 * A single addressable node in a model's semantic hierarchy.
 *
 * `semanticId` is permanent VEO identity. `providerMeshNames` is the *mutable*
 * mapping down to whatever the current asset vendor happens to call these
 * meshes — deliberately plural, because one semantic structure often maps to
 * several meshes, and deliberately separate, because it changes when an asset
 * is re-exported while the semantic id must not.
 */
export interface SpatialObject {
  readonly id: UUID;
  readonly modelId: UUID;
  readonly semanticId: SemanticId;
  readonly name: string;
  readonly kind: SpatialObjectKind;
  readonly parentId: SemanticId | null;
  readonly childIds: readonly SemanticId[];
  /** Domain grouping, e.g. an anatomical system or a chemical functional group. */
  readonly system: string | null;
  /** Spatial grouping, e.g. an anatomical region or an assembly zone. */
  readonly region: string | null;
  readonly layerIds: readonly string[];
  readonly providerMeshNames: readonly string[];
  readonly boundingBox: BoundingBox | null;
  readonly description: string | null;
  readonly synonyms: readonly string[];
  readonly metadata: Metadata;
}

/** A named sub-volume of a model that can be loaded or focused independently. */
export interface SpatialRegion {
  readonly id: string;
  readonly modelId: UUID;
  readonly semanticId: SemanticId;
  readonly name: string;
  readonly description: string | null;
  /** Objects belonging to this region, by semantic id. */
  readonly objectIds: readonly SemanticId[];
  readonly boundingBox: BoundingBox | null;
  /** Provider handle for loading just this region, when supported. */
  readonly providerRef: string | null;
}

/**
 * An independently toggleable slice of a model — anatomical systems, chemical
 * orbital shells, engineering subassemblies, geological strata.
 */
export interface SpatialLayer {
  readonly id: string;
  readonly modelId: UUID;
  readonly name: string;
  readonly description: string | null;
  readonly objectIds: readonly SemanticId[];
  readonly defaultVisible: boolean;
  /** Paint order for ghosting/transparency. Lower renders first. */
  readonly order: number;
  readonly colorToken: string | null;
}

/**
 * A typed, directed edge between two semantic entities.
 *
 * Relationship *kinds* are open strings so each domain contributes its own
 * vocabulary ("supplies", "innervates", "bonds_with", "drives", "orbits")
 * without the core type system needing to know about it.
 */
export interface Relationship {
  readonly id: UUID;
  readonly sourceId: SemanticId;
  readonly targetId: SemanticId;
  readonly kind: RelationshipKind;
  readonly label: string | null;
  readonly bidirectional: boolean;
  /** 0..1 confidence, for relationships derived by ingestion rather than authored. */
  readonly confidence: number;
  readonly metadata: Metadata;
}

export const STRUCTURAL_RELATIONSHIP_KINDS = [
  'contains',
  'part_of',
  'adjacent_to',
  'connects_to',
  'derived_from',
] as const;

export type RelationshipKind = (typeof STRUCTURAL_RELATIONSHIP_KINDS)[number] | (string & {});

/** The resolved, in-memory structure the viewer works against. */
export interface SpatialModelGraph {
  readonly model: SpatialModel;
  readonly objects: ReadonlyMap<SemanticId, SpatialObject>;
  readonly layers: readonly SpatialLayer[];
  readonly regions: readonly SpatialRegion[];
  readonly relationships: readonly Relationship[];
}
