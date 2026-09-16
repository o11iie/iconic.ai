import { ANATOMY_MODEL_CATALOG } from '@/anatomy/models/catalog';
import type { KnowledgeDomain } from '@/types/domain/primitives';

/**
 * Subject catalogue for the Learn experience.
 *
 * These are *content definitions* describing what VEO is built to teach. They
 * are deliberately NOT claims that production 3D content exists: every entry
 * carries an explicit `contentStatus`, and the interface renders that status
 * rather than implying a model is ready to open.
 *
 * Categories are data, not code, so publishing a subject is a content change.
 * The structure is domain-agnostic — anatomy is simply the first domain
 * populated.
 */

export type ContentStatus =
  /** Licensed spatial assets and curriculum exist and can be opened today. */
  | 'available'
  /** Defined in the catalogue; awaiting licensed spatial assets. */
  | 'awaiting_assets'
  /** Planned; not yet defined in detail. */
  | 'planned';

export interface SubjectCategory {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Model refs in the anatomy catalogue that belong to this category. */
  readonly modelRefs: readonly string[];
  readonly contentStatus: ContentStatus;
}

export interface SubjectDefinition {
  readonly slug: string;
  readonly name: string;
  readonly domain: KnowledgeDomain;
  readonly description: string;
  readonly icon: string;
  readonly categories: readonly SubjectCategory[];
  readonly contentStatus: ContentStatus;
}

/**
 * Anatomy — the flagship subject.
 *
 * Categories mirror how anatomy is actually taught. `awaiting_assets` is the
 * honest status for all of them: the engine, provider and semantic mapping are
 * built and tested, but no licensed asset set is published, so none of these
 * can be opened yet.
 */
const ANATOMY: SubjectDefinition = {
  slug: 'anatomy',
  name: 'Anatomy',
  domain: 'anatomy',
  description:
    'Structure of the human body, explored in three dimensions and linked to function.',
  icon: 'recall',
  contentStatus: 'awaiting_assets',
  categories: [
    {
      id: 'human_body',
      name: 'Human Body',
      description: 'Whole-body orientation, planes, regions and systems overview.',
      modelRefs: [],
      contentStatus: 'awaiting_assets',
    },
    {
      id: 'musculoskeletal',
      name: 'Musculoskeletal',
      description: 'Bones, joints, muscles, and the movements they produce.',
      modelRefs: ['skull'],
      contentStatus: 'awaiting_assets',
    },
    {
      id: 'cardiovascular',
      name: 'Cardiovascular',
      description: 'Heart chambers, valves, conduction and the circulatory tree.',
      modelRefs: ['heart'],
      contentStatus: 'awaiting_assets',
    },
    {
      id: 'nervous',
      name: 'Nervous System',
      description: 'Brain, spinal cord, cranial nerves and peripheral pathways.',
      modelRefs: ['brain'],
      contentStatus: 'awaiting_assets',
    },
    {
      id: 'respiratory',
      name: 'Respiratory',
      description: 'Airways, lungs, pleura and the mechanics of breathing.',
      modelRefs: ['thorax'],
      contentStatus: 'awaiting_assets',
    },
    {
      id: 'digestive',
      name: 'Digestive',
      description: 'Alimentary tract, accessory organs and peritoneal relationships.',
      modelRefs: [],
      contentStatus: 'planned',
    },
    {
      id: 'endocrine',
      name: 'Endocrine',
      description: 'Glands, hormones and the systems they regulate.',
      modelRefs: [],
      contentStatus: 'planned',
    },
  ],
};

/** Domains VEO is architected for but has not yet populated with content. */
const PLANNED_SUBJECTS: readonly SubjectDefinition[] = [
  {
    slug: 'engineering',
    name: 'Engineering',
    domain: 'engineering',
    description: 'Mechanisms, assemblies and load paths, taken apart and put back together.',
    icon: 'layers',
    contentStatus: 'planned',
    categories: [],
  },
  {
    slug: 'chemistry',
    name: 'Chemistry',
    domain: 'chemistry',
    description: 'Molecular structure, bonding and reaction geometry in three dimensions.',
    icon: 'orbit',
    contentStatus: 'planned',
    categories: [],
  },
  {
    slug: 'astrophysics',
    name: 'Astrophysics',
    domain: 'astrophysics',
    description: 'Stellar interiors, orbital systems and structures at cosmic scale.',
    icon: 'shield',
    contentStatus: 'planned',
    categories: [],
  },
];

export const SUBJECTS: readonly SubjectDefinition[] = [ANATOMY, ...PLANNED_SUBJECTS];

export function findSubject(slug: string): SubjectDefinition | null {
  return SUBJECTS.find((subject) => subject.slug === slug) ?? null;
}

/** Catalogue entries a category maps onto, for deep links into the workspace. */
export function modelsForCategory(category: SubjectCategory) {
  return ANATOMY_MODEL_CATALOG.filter((entry) => category.modelRefs.includes(entry.modelRef));
}

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  available: 'Available',
  awaiting_assets: 'Awaiting licensed assets',
  planned: 'Planned',
};
