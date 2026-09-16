import { buildSemanticId, type SemanticId } from '@/lib/semantic-id';

/**
 * Anatomy vocabulary.
 *
 * This lives in `src/anatomy`, never in `src/engine`, because the spatial
 * engine must stay domain-agnostic. Chemistry, engineering and astrophysics
 * will each contribute their own equivalent module.
 */

export const ANATOMY_DOMAIN = 'anatomy' as const;

export const ANATOMY_SYSTEMS = [
  'skeletal',
  'muscular',
  'cardiovascular',
  'nervous',
  'respiratory',
  'digestive',
  'endocrine',
  'lymphatic',
  'urinary',
  'reproductive',
  'integumentary',
] as const;
export type AnatomySystem = (typeof ANATOMY_SYSTEMS)[number];

export const ANATOMY_REGIONS = [
  'head_and_neck',
  'thorax',
  'abdomen',
  'pelvis',
  'back',
  'upper_limb',
  'lower_limb',
] as const;
export type AnatomyRegion = (typeof ANATOMY_REGIONS)[number];

export const LATERALITY = ['left', 'right', 'midline', 'bilateral'] as const;
export type Laterality = (typeof LATERALITY)[number];

/**
 * Anatomy-specific relationship vocabulary, layered on top of the engine's
 * structural kinds. These are the edges that make anatomy *teachable*:
 * what supplies what, what drains where, what a nerve innervates.
 */
export const ANATOMY_RELATIONSHIP_KINDS = [
  'supplies',
  'drains',
  'innervates',
  'articulates_with',
  'attaches_to',
  'originates_from',
  'inserts_into',
  'passes_through',
  'is_continuous_with',
] as const;
export type AnatomyRelationshipKind = (typeof ANATOMY_RELATIONSHIP_KINDS)[number];

export function isAnatomySystem(value: string): value is AnatomySystem {
  return (ANATOMY_SYSTEMS as readonly string[]).includes(value);
}

export function isAnatomyRegion(value: string): value is AnatomyRegion {
  return (ANATOMY_REGIONS as readonly string[]).includes(value);
}

/** Build an anatomy semantic id, e.g. anatomySemanticId('heart', 'left_ventricle'). */
export function anatomySemanticId(...path: string[]): SemanticId {
  return buildSemanticId(ANATOMY_DOMAIN, ...path);
}

/** Canonical id for a whole system, e.g. veo.anatomy.system.cardiovascular */
export function anatomySystemId(system: AnatomySystem): SemanticId {
  return anatomySemanticId('system', system);
}

/** Canonical id for a body region, e.g. veo.anatomy.region.thorax */
export function anatomyRegionId(region: AnatomyRegion): SemanticId {
  return anatomySemanticId('region', region);
}

export const ANATOMY_SYSTEM_LABELS: Record<AnatomySystem, string> = {
  skeletal: 'Skeletal',
  muscular: 'Muscular',
  cardiovascular: 'Cardiovascular',
  nervous: 'Nervous',
  respiratory: 'Respiratory',
  digestive: 'Digestive',
  endocrine: 'Endocrine',
  lymphatic: 'Lymphatic',
  urinary: 'Urinary',
  reproductive: 'Reproductive',
  integumentary: 'Integumentary',
};

export const ANATOMY_REGION_LABELS: Record<AnatomyRegion, string> = {
  head_and_neck: 'Head & Neck',
  thorax: 'Thorax',
  abdomen: 'Abdomen',
  pelvis: 'Pelvis',
  back: 'Back',
  upper_limb: 'Upper Limb',
  lower_limb: 'Lower Limb',
};
