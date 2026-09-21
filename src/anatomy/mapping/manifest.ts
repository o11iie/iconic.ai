import { z } from 'zod';
import { parseSemanticId, type SemanticId } from '@/lib/semantic-id';
import { ANATOMY_REGIONS, ANATOMY_RELATIONSHIP_KINDS, ANATOMY_SYSTEMS } from '../taxonomy';

/**
 * VEO Anatomy Manifest
 * ====================
 *
 * The contract between a licensed anatomy source and VEO's permanent identity
 * system.
 *
 * A vendor asset contains meshes named "Heart_LV_001" or "mesh_0442"; a hosted
 * anatomy API returns object ids of its own. Both are export artefacts: they
 * change between revisions and differ between vendors. VEO therefore never
 * uses either as identity. Each licensed model ships a manifest declaring:
 *
 *     providerId "obj_88213"  ->  veo.anatomy.heart.left_ventricle
 *     mesh       "Heart_LV_001"  ->  veo.anatomy.heart.left_ventricle
 *
 * Swap the vendor, rewrite the manifest, and every question, flashcard, note
 * and memory record a learner has built stays valid. That is the whole point:
 * the learner's work outlives the asset it was made against.
 *
 * The manifest is authored and reviewed by humans, validated here at load
 * time, and served alongside the model. It is data, not code, so a new model
 * needs no deployment.
 *
 * ## What this file does NOT do
 *
 * It does not supply anatomy. Every descriptive field — name, function,
 * references — comes from the manifest's author. VEO neither invents them nor
 * fills them in from a model. A structure with no description renders without
 * one.
 */

const semanticIdSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseSemanticId(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: parsed.error.message });
  }
});

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const boundingBoxSchema = z.object({
  min: vec3Schema,
  max: vec3Schema,
});

/**
 * A citation for a descriptive claim.
 *
 * Anatomical statements need provenance. A description with no source is a
 * claim VEO cannot stand behind, and this is the field that makes the
 * difference visible rather than invisible.
 */
const referenceSchema = z.object({
  /** e.g. "Terminologia Anatomica", "Gray's Anatomy 42e", "FMA". */
  source: z.string().min(1),
  /** Identifier or locator within that source. */
  citation: z.string().min(1),
  url: z.string().url().nullable().default(null),
});

const objectSchema = z.object({
  semanticId: semanticIdSchema,
  /**
   * The provider's own handle for this structure.
   *
   * A hosted anatomy API addresses objects by this; an asset-backed provider
   * addresses them by `meshes`. A manifest may supply either or both, and
   * validation checks that it supplied at least one way to find the geometry.
   */
  providerId: z.string().min(1).nullable().default(null),
  name: z.string().min(1),
  /** Terminologia Anatomica / Latin form, when the source supplies one. */
  officialName: z.string().nullable().default(null),
  kind: z
    .enum(['group', 'structure', 'surface', 'cavity', 'conduit', 'field', 'annotation'])
    .default('structure'),
  parentId: semanticIdSchema.nullable().default(null),
  /** Vendor mesh names this semantic structure maps to. May be several. */
  meshes: z.array(z.string().min(1)).default([]),
  system: z.enum(ANATOMY_SYSTEMS).nullable().default(null),
  region: z.enum(ANATOMY_REGIONS).nullable().default(null),
  layers: z.array(z.string().min(1)).default([]),
  latinName: z.string().nullable().default(null),
  laterality: z.enum(['left', 'right', 'midline', 'bilateral']).nullable().default(null),
  description: z.string().nullable().default(null),
  /** What the structure does. Authored content, never generated. */
  function: z.string().nullable().default(null),
  synonyms: z.array(z.string()).default([]),
  clinicalNotes: z.array(z.string()).default([]),
  /** Where the descriptive content above came from. */
  references: z.array(referenceSchema).default([]),
  /** Who this content is pitched at, when the author has decided. */
  educationalLevel: z
    .enum(['foundation', 'undergraduate', 'postgraduate', 'clinical'])
    .nullable()
    .default(null),
  /** FMA / TA2 / SNOMED CT cross-references for interoperability. */
  externalIds: z.record(z.string(), z.string()).default({}),
  boundingBox: boundingBoxSchema.nullable().default(null),
  /** Displacement in an exploded view, when the model declares one. */
  explodedOffset: vec3Schema.nullable().default(null),
});

const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  defaultVisible: z.boolean().default(true),
  /** Priority: lower is outermost. Drives paint order and the peel sequence. */
  order: z.number().int().default(0),
  opacity: z.number().min(0).max(1).default(0.15),
  peelable: z.boolean().default(true),
  peelMode: z.enum(['ghost', 'hide']).default('ghost'),
  colorToken: z.string().nullable().default(null),
});

const regionSchema = z.object({
  id: z.enum(ANATOMY_REGIONS),
  semanticId: semanticIdSchema,
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  objectIds: z.array(semanticIdSchema).default([]),
  /** Separate asset for this region, enabling progressive loading. */
  assetPath: z.string().nullable().default(null),
  boundingBox: boundingBoxSchema.nullable().default(null),
});

const systemSchema = z.object({
  id: z.enum(ANATOMY_SYSTEMS),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  /** Separate asset for this system, enabling progressive loading. */
  assetPath: z.string().nullable().default(null),
});

const relationshipSchema = z.object({
  id: z.string().min(1).nullable().default(null),
  source: semanticIdSchema,
  target: semanticIdSchema,
  kind: z.string().min(1),
  label: z.string().nullable().default(null),
  bidirectional: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(1),
});

const explosionSchema = z.object({
  id: z.string().min(1),
  objectIds: z.array(semanticIdSchema).min(1),
  center: vec3Schema.nullable().default(null),
  scale: z.number().positive().default(1.5),
  spacing: z.number().min(0).default(0),
});

/**
 * Capabilities a model may switch OFF.
 *
 * Deliberately all-optional and only ever restrictive. VEO derives what a
 * model can do from its actual data; this lets a manifest say "do not offer
 * dissection on this model" for a licence or quality reason. It can never say
 * the opposite, because a manifest asserting a capability it has no data for
 * is exactly the control that appears and then does nothing.
 */
const capabilitiesSchema = z
  .object({
    supportsSelection: z.boolean().optional(),
    supportsLayers: z.boolean().optional(),
    supportsIsolation: z.boolean().optional(),
    supportsGhosting: z.boolean().optional(),
    supportsPeeling: z.boolean().optional(),
    supportsDissection: z.boolean().optional(),
    supportsExplosion: z.boolean().optional(),
    supportsReconstruction: z.boolean().optional(),
    supportsLabels: z.boolean().optional(),
    supportsRelationships: z.boolean().optional(),
  })
  .default({});

export const manifestSchema = z.object({
  /** Manifest FORMAT version, so old manifests keep loading after changes. */
  formatVersion: z.literal(1),
  /**
   * The manifest's own content version.
   *
   * Distinct from `modelVersion` below: the semantic layer is corrected and
   * extended on a different cadence from the geometry it describes.
   */
  manifestVersion: z.string().min(1).default('1.0.0'),
  modelId: z.string().uuid(),
  /**
   * The geometry's version, as the vendor stamps it.
   *
   * Checked against the version the asset actually reports. Mixing geometry
   * from one revision with semantic data from another silently mislabels
   * structures, which is the worst failure this system can have: it looks
   * exactly like working software.
   */
  modelVersion: z.string().min(1).default('1.0.0'),
  /** Which provider implementation this manifest is written for. */
  provider: z.string().min(1).default('gltf-asset'),
  domain: z.string().min(1).default('anatomy'),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  /** Which body this model describes, when the source distinguishes. */
  body: z
    .object({
      sex: z.enum(['female', 'male', 'unspecified']).default('unspecified'),
      ageGroup: z.enum(['adult', 'paediatric', 'fetal', 'unspecified']).default('unspecified'),
      description: z.string().nullable().default(null),
    })
    .default({ sex: 'unspecified', ageGroup: 'unspecified', description: null }),
  /** Asset file relative to the manifest, e.g. "heart.glb". */
  assetPath: z.string().min(1),
  thumbnailPath: z.string().nullable().default(null),
  rootObjectId: semanticIdSchema,
  licence: z.object({
    holder: z.string().min(1),
    kind: z.enum(['licensed_sdk', 'licensed_asset', 'veo_owned', 'open_source']),
    expiresAt: z.string().nullable().default(null),
    attributionRequired: z.boolean().default(false),
    /** The application title the licence is granted to, when it names one. */
    licensedApplication: z.string().nullable().default(null),
    /** Platforms the licence permits, e.g. ["web"]. Empty means unrestricted. */
    allowedPlatforms: z.array(z.string().min(1)).default([]),
  }),
  assetProfile: z
    .object({
      approximateBytes: z.number().int().positive().nullable().default(null),
      triangleCount: z.number().int().positive().nullable().default(null),
      hasDracoCompression: z.boolean().default(false),
      hasKtx2Textures: z.boolean().default(false),
    })
    .default({
      approximateBytes: null,
      triangleCount: null,
      hasDracoCompression: false,
      hasKtx2Textures: false,
    }),
  capabilities: capabilitiesSchema,
  /** Systems the model actually contains. Declared, then cross-checked. */
  systems: z.array(systemSchema).default([]),
  regions: z.array(regionSchema).default([]),
  layers: z.array(layerSchema).default([]),
  objects: z.array(objectSchema).min(1),
  relationships: z.array(relationshipSchema).default([]),
  explosion: z.array(explosionSchema).default([]),
});

export type AnatomyManifest = z.infer<typeof manifestSchema>;
export type ManifestObject = z.infer<typeof objectSchema>;
export type ManifestReference = z.infer<typeof referenceSchema>;

/** Retained name: the manifest is domain-agnostic in shape, anatomy in content. */
export type SpatialManifest = AnatomyManifest;

/** Vendor mesh name -> VEO semantic id, derived from a validated manifest. */
export function buildMeshMapping(manifest: AnatomyManifest): Map<string, SemanticId> {
  const mapping = new Map<string, SemanticId>();
  for (const object of manifest.objects) {
    for (const mesh of object.meshes) {
      mapping.set(mesh, object.semanticId as SemanticId);
    }
  }
  return mapping;
}

/**
 * Provider object id -> VEO semantic id.
 *
 * The hosted equivalent of the mesh mapping. A provider that addresses objects
 * by its own id resolves selections through this, never by trusting the id it
 * was handed.
 */
export function buildProviderMapping(manifest: AnatomyManifest): Map<string, SemanticId> {
  const mapping = new Map<string, SemanticId>();
  for (const object of manifest.objects) {
    if (object.providerId) mapping.set(object.providerId, object.semanticId as SemanticId);
  }
  return mapping;
}

/** Relationship kinds this manifest uses that are not in VEO's vocabulary. */
export function unknownRelationshipKinds(manifest: AnatomyManifest): readonly string[] {
  const known = new Set<string>([
    ...ANATOMY_RELATIONSHIP_KINDS,
    'contains',
    'part_of',
    'adjacent_to',
    'connects_to',
    'derived_from',
    'related_to',
  ]);
  const unknown = new Set<string>();
  for (const relationship of manifest.relationships) {
    if (!known.has(relationship.kind)) unknown.add(relationship.kind);
  }
  return [...unknown];
}
