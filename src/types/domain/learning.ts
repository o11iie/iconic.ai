import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, Metadata, Timestamped, UUID } from './primitives';
import type { LearningLevel } from './user';

/**
 * The RECALL half of the learning loop: questions, flashcards, attempts, and
 * the memory model that schedules review.
 */

export const QUESTION_KINDS = [
  'multiple_choice',
  'free_recall',
  'true_false',
  'identify_structure', // "click the left ventricle" — answered in the 3D viewport
  'order_sequence',
  'label_diagram',
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * What a piece of learning content is FOR.
 *
 * A closed set, not free text. "Objective" as an arbitrary string would make
 * every generated item's purpose unqueryable and every prompt slightly
 * different — and the whole value of naming the objective is that a learner's
 * weak area can later be described as "struggles to RELATE, fine at IDENTIFY"
 * rather than as a bag of question ids.
 *
 * Each maps to a question a learner would actually ask of a spatial model:
 *
 *   IDENTIFY    which structure is this?
 *   DEFINE      what is it?
 *   FUNCTION    what does it do?
 *   RELATE      how does it connect to what is around it?
 *   DISTINGUISH how is it different from that one?
 *   LOCATE      where does it sit in the whole?
 */
export const LEARNING_OBJECTIVES = [
  'IDENTIFY',
  'DEFINE',
  'FUNCTION',
  'RELATE',
  'DISTINGUISH',
  'LOCATE',
] as const;
export type LearningObjectiveType = (typeof LEARNING_OBJECTIVES)[number];

/**
 * A stated learning goal for one structure.
 *
 * Content is generated FOR an objective rather than about a structure in the
 * abstract, which is what stops a generator producing six questions that all
 * ask the same thing in different words.
 */
export interface LearningObjective {
  readonly id: UUID;
  readonly semanticId: SemanticId;
  readonly objectiveType: LearningObjectiveType;
  readonly difficulty: Difficulty;
  readonly educationLevel: LearningLevel;
  /** What the learner should be able to do. Rendered, so it is prose. */
  readonly prompt: string;
  /** How well VEO's own data supported this objective when it was built. */
  readonly sourceStatus: ContentSourceStatus;
  readonly createdAt: ISODateString;
}

/**
 * How well a generated item is supported by VEO's own data.
 *
 * The same vocabulary the tutor uses, deliberately: two scales for one idea
 * would eventually disagree, and a learner seeing "grounded" in one panel and
 * "partial" in another for the same structure would be right to distrust both.
 */
export const CONTENT_SOURCE_STATUSES = [
  'grounded',
  'partially-grounded',
  'insufficient-context',
] as const;
export type ContentSourceStatus = (typeof CONTENT_SOURCE_STATUSES)[number];

export interface Question extends Timestamped {
  readonly id: UUID;
  readonly subjectId: UUID | null;
  readonly materialId: UUID | null;
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly choices: readonly QuestionChoice[];
  /** For free recall: the model answer. For spatial questions: the target id. */
  readonly answer: QuestionAnswer;
  readonly explanation: string | null;
  readonly difficulty: Difficulty;
  /** Concepts this question exercises. Drives memory state updates. */
  readonly conceptIds: readonly SemanticId[];
  /** Set when the question is answered by interacting with a spatial model. */
  readonly spatialTargetId: SemanticId | null;
  readonly generatedBy: 'authored' | 'ai' | 'imported';
  readonly metadata: Metadata;
}

export interface QuestionChoice {
  readonly id: string;
  readonly label: string;
  readonly correct: boolean;
}

export type QuestionAnswer =
  | { readonly kind: 'choice'; readonly choiceIds: readonly string[] }
  | { readonly kind: 'text'; readonly text: string; readonly acceptable: readonly string[] }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'spatial'; readonly semanticId: SemanticId }
  | { readonly kind: 'sequence'; readonly orderedIds: readonly string[] };

export interface Flashcard extends Timestamped {
  readonly id: UUID;
  readonly ownerId: UUID;
  readonly subjectId: UUID | null;
  readonly materialId: UUID | null;
  readonly front: string;
  readonly back: string;
  readonly conceptIds: readonly SemanticId[];
  /** Optional spatial anchor: reviewing the card can fly the camera here. */
  readonly spatialObjectId: SemanticId | null;
  readonly generatedBy: 'authored' | 'ai' | 'imported';
  readonly tags: readonly string[];
  readonly metadata: Metadata;
}

/** How the learner rated their own recall. Feeds the scheduler. */
export const RECALL_GRADES = ['forgot', 'hard', 'good', 'easy'] as const;
export type RecallGrade = (typeof RECALL_GRADES)[number];

export interface RecallAttempt {
  readonly id: UUID;
  readonly userId: UUID;
  readonly sessionId: UUID | null;
  /** Exactly one of these is set. */
  readonly questionId: UUID | null;
  readonly flashcardId: UUID | null;
  readonly conceptId: SemanticId | null;
  readonly grade: RecallGrade;
  readonly correct: boolean | null;
  readonly responseMs: number;
  readonly answeredAt: ISODateString;
  readonly response: Metadata;
}

/**
 * Per-learner, per-concept memory model.
 *
 * Deliberately stores the scheduler *inputs* (stability, difficulty, reps)
 * rather than only a due date, so the scheduling algorithm can be improved
 * later without discarding a learner's history.
 */
export interface MemoryState {
  readonly id: UUID;
  readonly userId: UUID;
  readonly conceptId: SemanticId;
  /** Repetition count since the last lapse. */
  readonly repetitions: number;
  /** Ease/stability factor. Higher means longer intervals. */
  readonly stability: number;
  /** 0..1 intrinsic difficulty of this concept for this learner. */
  readonly difficulty: number;
  readonly intervalDays: number;
  readonly lapses: number;
  readonly lastReviewedAt: ISODateString | null;
  readonly dueAt: ISODateString;
  /** 0..1 estimated probability of successful recall right now. */
  readonly retrievability: number | null;
}

export interface Note extends Timestamped {
  readonly id: UUID;
  readonly ownerId: UUID;
  readonly subjectId: UUID | null;
  readonly materialId: UUID | null;
  /** Anchors the note to something in space — the CONNECT step of the loop. */
  readonly spatialObjectId: SemanticId | null;
  readonly title: string | null;
  readonly body: string;
  readonly tags: readonly string[];
}

export const SESSION_MODES = [
  'explore',
  'learn',
  'recall',
  'review',
  'apply',
] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export interface LearningSession {
  readonly id: UUID;
  readonly userId: UUID;
  readonly subjectId: UUID | null;
  readonly courseId: UUID | null;
  readonly spatialModelId: UUID | null;
  readonly mode: SessionMode;
  readonly startedAt: ISODateString;
  readonly endedAt: ISODateString | null;
  readonly durationSeconds: number | null;
  readonly conceptsStudied: readonly SemanticId[];
  readonly metadata: Metadata;
}
