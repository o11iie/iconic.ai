import type { SemanticId } from '@/lib/semantic-id';
import type {
  ISODateString,
  KnowledgeDomain,
  Metadata,
  PublicationStatus,
  Timestamped,
  UUID,
} from './primitives';

/**
 * What a learner studies. A Subject is a domain-scoped area of knowledge;
 * a Course is an ordered path through it; LearningMaterial is the raw source
 * a learner brings in or VEO supplies.
 */

export interface Subject extends Timestamped {
  readonly id: UUID;
  readonly domain: KnowledgeDomain;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly iconToken: string | null;
  readonly accentToken: string | null;
  /** Spatial models that can be explored within this subject. */
  readonly spatialModelIds: readonly UUID[];
  readonly status: PublicationStatus;
  /** False until licensed spatial content and curriculum exist for it. */
  readonly available: boolean;
  readonly metadata: Metadata;
}

export interface Course extends Timestamped {
  readonly id: UUID;
  readonly subjectId: UUID;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: PublicationStatus;
  readonly estimatedMinutes: number | null;
  readonly modules: readonly CourseModule[];
  /** Author. Null for VEO-published curriculum. */
  readonly ownerId: UUID | null;
  readonly metadata: Metadata;
}

export interface CourseModule {
  readonly id: UUID;
  readonly title: string;
  readonly order: number;
  readonly conceptIds: readonly SemanticId[];
  readonly materialIds: readonly UUID[];
}

export const MATERIAL_KINDS = [
  'pdf',
  'text',
  'markdown',
  'image',
  'audio',
  'video',
  'link',
  'lecture_notes',
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const INGESTION_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
  'unsupported',
] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

/**
 * A source document. This is the entry point of the learning loop
 * (UPLOAD -> UNDERSTAND -> STRUCTURE), so it tracks ingestion state explicitly:
 * a failed ingestion must be visible to the learner, never silently dropped.
 */
export interface LearningMaterial extends Timestamped {
  readonly id: UUID;
  readonly ownerId: UUID;
  readonly subjectId: UUID | null;
  readonly title: string;
  readonly kind: MaterialKind;
  /** Supabase Storage object path. Never a public URL. */
  readonly storagePath: string | null;
  readonly sourceUrl: string | null;
  readonly sizeBytes: number | null;
  readonly ingestion: IngestionState;
  /** Concepts extracted during STRUCTURE, linked to spatial objects where possible. */
  readonly conceptIds: readonly SemanticId[];
  readonly metadata: Metadata;
}

export interface IngestionState {
  readonly status: IngestionStatus;
  readonly startedAt: ISODateString | null;
  readonly completedAt: ISODateString | null;
  /** Populated when status is 'failed' or 'unsupported'. Shown to the learner. */
  readonly error: string | null;
  /** 0..1. Null when the pipeline cannot estimate progress. */
  readonly progress: number | null;
}

export const EMPTY_INGESTION_STATE: IngestionState = {
  status: 'pending',
  startedAt: null,
  completedAt: null,
  error: null,
  progress: null,
};

/**
 * A unit of understanding. Concepts are the bridge between flat material and
 * spatial structure: `spatialObjectId` links a concept to something you can
 * actually look at and rotate.
 */
export interface Concept {
  readonly id: SemanticId;
  readonly name: string;
  readonly summary: string | null;
  readonly domain: KnowledgeDomain;
  readonly spatialObjectId: SemanticId | null;
  readonly relatedConceptIds: readonly SemanticId[];
  readonly sourceMaterialIds: readonly UUID[];
}
