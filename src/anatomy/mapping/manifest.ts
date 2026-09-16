import { z } from 'zod';
import { err, ok, type Result } from '@/lib/result';
import { parseSemanticId, type SemanticId } from '@/lib/semantic-id';
import { ANATOMY_REGIONS, ANATOMY_SYSTEMS } from '../taxonomy';

/**
 * Semantic Mapping Manifest
 * =========================
 *
 * The contract that sits between a licensed 3D asset and VEO's permanent
 * identity system.
 *
 * A vendor GLB contains meshes named things like "Heart_LV_001" or "mesh_0442".
 * Those names are export artefacts: they change between asset revisions and
 * differ between vendors. VEO therefore never uses them as identity. Instead
 * each licensed asset ships (or is accompanied by) a manifest that declares:
 *
 *     "Heart_LV_001"  ->  veo.anatomy.heart.left_ventricle
 *
 * Swap the asset vendor, rewrite the manifest, and every question, flashcard,
 * note and memory record a learner has built stays valid.
 *
 * The manifest is authored and reviewed by humans, validated here at load time,
 * and served alongside the asset. It is data, not code, so new models require
 * no deployment.
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

const objectSchema = z.object({
  semanticId: semanticIdSchema,
  name: z.string().min(1),
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
  synonyms: z.array(z.string()).default([]),
  clinicalNotes: z.array(z.string()).default([]),
  /** FMA / TA2 / SNOMED CT cross-references for interoperability. */
  externalIds: z.record(z.string(), z.string()).default({}),
  boundingBox: boundingBoxSchema.nullable().default(null),
});

const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  defaultVisible: z.boolean().default(true),
  order: z.number().int().default(0),
  colorToken: z.string().nullable().default(null),
});

const regionSchema = z.object({
  id: z.string().min(1),
  semanticId: semanticIdSchema,
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  objectIds: z.array(semanticIdSchema).default([]),
  /** Separate asset for this region, enabling progressive loading. */
  assetPath: z.string().nullable().default(null),
  boundingBox: boundingBoxSchema.nullable().default(null),
});

const relationshipSchema = z.object({
  source: semanticIdSchema,
  target: semanticIdSchema,
  kind: z.string().min(1),
  label: z.string().nullable().default(null),
  bidirectional: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(1),
});

export const manifestSchema = z.object({
  /** Manifest format version, so old manifests keep loading after changes. */
  formatVersion: z.literal(1),
  modelId: z.string().uuid(),
  domain: z.string().min(1).default('anatomy'),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  /** Asset file relative to the manifest, e.g. "heart.glb". */
  assetPath: z.string().min(1),
  thumbnailPath: z.string().nullable().default(null),
  rootObjectId: semanticIdSchema,
  licence: z.object({
    holder: z.string().min(1),
    kind: z.enum(['licensed_sdk', 'licensed_asset', 'veo_owned', 'open_source']),
    expiresAt: z.string().nullable().default(null),
    attributionRequired: z.boolean().default(false),
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
  layers: z.array(layerSchema).default([]),
  regions: z.array(regionSchema).default([]),
  objects: z.array(objectSchema).min(1),
  relationships: z.array(relationshipSchema).default([]),
});

export type SpatialManifest = z.infer<typeof manifestSchema>;
export type ManifestObject = z.infer<typeof objectSchema>;

export interface ManifestValidationError {
  readonly message: string;
  readonly issues: readonly string[];
}

/**
 * Validate an untrusted manifest payload.
 *
 * Beyond schema validation this enforces two integrity rules that a JSON schema
 * cannot express, and which would otherwise produce a silently broken model:
 *   * every declared parent must exist in the same manifest
 *   * semantic ids must be unique
 */
export function parseManifest(input: unknown): Result<SpatialManifest, ManifestValidationError> {
  const parsed = manifestSchema.safeParse(input);

  if (!parsed.success) {
    return err({
      message: 'Spatial manifest failed validation.',
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    });
  }

  const manifest = parsed.data;
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const object of manifest.objects) {
    if (seen.has(object.semanticId)) {
      issues.push(`Duplicate semanticId "${object.semanticId}".`);
    }
    seen.add(object.semanticId);
  }

  for (const object of manifest.objects) {
    if (object.parentId !== null && !seen.has(object.parentId)) {
      issues.push(
        `Object "${object.semanticId}" declares parent "${object.parentId}", which is not present in this manifest.`,
      );
    }
  }

  if (!seen.has(manifest.rootObjectId)) {
    issues.push(`rootObjectId "${manifest.rootObjectId}" is not present in objects.`);
  }

  for (const relationship of manifest.relationships) {
    if (!seen.has(relationship.source)) {
      issues.push(`Relationship source "${relationship.source}" is not a known object.`);
    }
    if (!seen.has(relationship.target)) {
      issues.push(`Relationship target "${relationship.target}" is not a known object.`);
    }
  }

  if (issues.length > 0) {
    return err({ message: 'Spatial manifest is internally inconsistent.', issues });
  }

  return ok(manifest);
}

/** Vendor mesh name -> VEO semantic id, derived from a validated manifest. */
export function buildMeshMapping(manifest: SpatialManifest): Map<string, SemanticId> {
  const mapping = new Map<string, SemanticId>();
  for (const object of manifest.objects) {
    for (const mesh of object.meshes) {
      mapping.set(mesh, object.semanticId as SemanticId);
    }
  }
  return mapping;
}
