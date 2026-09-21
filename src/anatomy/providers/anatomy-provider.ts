import type { SemanticId } from '@/lib/semantic-id';
import type { SpatialProvider, SpatialResult } from '@/engine/spatial/provider';
import type { LoadModelOptions } from '@/engine/spatial/provider';
import type { FlyToOptions, ObjectSummary } from '@/engine/spatial/types';
import type {
  Relationship,
  SpatialCapabilities,
  SpatialLayer,
  SpatialObject,
  SpatialRegion,
  Vec3,
} from '@/types/domain/spatial';
import type { AnatomyManifest } from '../mapping/manifest';
import type { HierarchyNode } from '../mapping/hierarchy';
import type { AnatomyRegion, AnatomyRelationshipKind, AnatomySystem } from '../taxonomy';

/**
 * AnatomyProvider
 * ===============
 *
 * An anatomy-flavoured view over the generic `SpatialProvider`. It adds the
 * vocabulary clinicians and students actually use — systems, regions,
 * structures — without the engine having to know any of it.
 *
 * VEO is NOT wired to a single commercial anatomy vendor. Any of the following
 * can implement this interface:
 *   1. a licensed anatomy SDK/API (vendor owns geometry and hierarchy)
 *   2. licensed GLB/GLTF asset sets rendered by VEO's engine
 *   3. future VEO-owned anatomy models
 *
 * See `gltf-anatomy-provider.ts` for the asset-backed implementation.
 */
export interface AnatomyProvider extends SpatialProvider {
  // ---- anatomy-scoped loading ---------------------------------------------
  /** Load every structure belonging to one body system. */
  loadSystem(system: AnatomySystem, options?: LoadModelOptions): SpatialResult<SpatialLayer>;
  /** Load every structure within one body region. */
  loadAnatomyRegion(region: AnatomyRegion, options?: LoadModelOptions): SpatialResult<SpatialRegion>;

  // ---- anatomy-scoped queries ---------------------------------------------
  getStructure(semanticId: SemanticId): SpatialObject | null;
  getStructureHierarchy(rootId?: SemanticId): readonly ObjectSummary[];
  getStructureMetadata(semanticId: SemanticId): AnatomyStructureMetadata | null;
  getRelatedStructures(
    semanticId: SemanticId,
    kinds?: readonly AnatomyRelationshipKind[],
  ): readonly Relationship[];
  getStructurePosition(semanticId: SemanticId): Vec3 | null;

  /**
   * The canonical Body → System → Region → Structure tree.
   *
   * Normalised from whatever shape the provider supplies, so the same
   * navigation works across vendors. Grouping nodes are derived from tags the
   * model already declares and carry no anatomical claim of their own.
   */
  getNormalizedHierarchy(): HierarchyNode | null;

  // ---- anatomy-scoped presentation ----------------------------------------
  /** Focus a structure: select it, ghost its context, fly the camera to it. */
  focusStructure(semanticId: SemanticId, options?: FlyToOptions): void;
  /** Which systems this model actually contains. Drives the layer panel. */
  getAvailableSystems(): readonly AnatomySystem[];
  getAvailableRegions(): readonly AnatomyRegion[];

  // ---- provenance and capability ------------------------------------------
  /**
   * The validated manifest backing the loaded model.
   *
   * Exposed so licensing, versioning and provenance are inspectable rather
   * than buried inside the provider. Null until a model loads.
   */
  getManifest(): AnatomyManifest | null;

  /**
   * What can actually be done to the loaded model.
   *
   * Derived from the model's own data and narrowed by what this provider can
   * drive. A provider that cannot ghost reports no ghosting however much the
   * manifest would like it to.
   */
  getCapabilities(): SpatialCapabilities;

  /** Geometry and semantic versions, for the mismatch check. */
  getModelVersion(): AnatomyModelVersion | null;
}

/**
 * What a loaded model is a version OF.
 *
 * Geometry and semantics version separately, and mixing them silently
 * mislabels structures — the one failure that looks exactly like working
 * software. Surfacing both is what makes a mismatch reportable.
 */
export interface AnatomyModelVersion {
  readonly provider: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly manifestVersion: string;
  readonly formatVersion: number;
}

/**
 * Structured clinical metadata. Kept optional throughout: a provider that
 * supplies geometry but no descriptive content is still a valid provider, and
 * the UI must render what exists rather than inventing the rest.
 */
export interface AnatomyStructureMetadata {
  readonly semanticId: SemanticId;
  readonly name: string;
  readonly latinName: string | null;
  readonly system: AnatomySystem | null;
  readonly region: AnatomyRegion | null;
  readonly laterality: string | null;
  readonly description: string | null;
  readonly synonyms: readonly string[];
  readonly clinicalNotes: readonly string[];
  /** External vocabulary cross-references (FMA, TA2, SNOMED CT, ...). */
  readonly externalIds: Readonly<Record<string, string>>;
}

export function isAnatomyProvider(provider: SpatialProvider): provider is AnatomyProvider {
  return typeof (provider as AnatomyProvider).getStructure === 'function';
}
