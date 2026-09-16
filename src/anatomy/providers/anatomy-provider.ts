import type { SemanticId } from '@/lib/semantic-id';
import type { SpatialProvider, SpatialResult } from '@/engine/spatial/provider';
import type { LoadModelOptions } from '@/engine/spatial/provider';
import type { FlyToOptions, ObjectSummary } from '@/engine/spatial/types';
import type { Relationship, SpatialLayer, SpatialObject, SpatialRegion, Vec3 } from '@/types/domain/spatial';
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

  // ---- anatomy-scoped presentation ----------------------------------------
  /** Focus a structure: select it, ghost its context, fly the camera to it. */
  focusStructure(semanticId: SemanticId, options?: FlyToOptions): void;
  /** Which systems this model actually contains. Drives the layer panel. */
  getAvailableSystems(): readonly AnatomySystem[];
  getAvailableRegions(): readonly AnatomyRegion[];
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
