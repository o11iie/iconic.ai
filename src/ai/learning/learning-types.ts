import { z } from 'zod';
import { isSemanticId, type SemanticId } from '@/lib/semantic-id';
import {
  CONTENT_SOURCE_STATUSES,
  DIFFICULTIES,
  LEARNING_OBJECTIVES,
  type ContentSourceStatus,
  type Difficulty,
  type LearningObjectiveType,
  type QuestionKind,
} from '@/types/domain/learning';
import { LEARNING_LEVELS } from '@/types/domain/user';

/**
 * Wire contracts for learning-content generation.
 *
 * Both directions validated, for the same reason as the tutor: a browser can
 * send anything, and a language model can return well-formed JSON describing a
 * structure that does not exist.
 *
 * The asymmetry worth noting is what the REQUEST may contain. It carries a
 * semantic id and some preferences — and no facts. A client that could send
 * "this is the femur and its function is X" would be dictating the content of
 * a question VEO then presents as its own; the server resolves every fact
 * itself, from the model, so the request is a question about what to generate
 * rather than an input to what is generated.
 */

// ---------------------------------------------------------------------------
// What may be generated
// ---------------------------------------------------------------------------

/**
 * The question kinds Gate 11 generates.
 *
 * A strict SUBSET of the platform's `QUESTION_KINDS`, not a new enum. The
 * domain declares six kinds; `order_sequence` and `label_diagram` need
 * authored ordering and diagram coordinates that no current model supplies, so
 * generating them would mean inventing the very data they depend on.
 *
 * Narrowing the generator rather than the domain keeps one vocabulary: an
 * authored `order_sequence` question remains a perfectly valid Question, it is
 * simply not something the AI is asked to write.
 */
export const GENERATED_QUESTION_KINDS = [
  'multiple_choice',
  'true_false',
  'free_recall',
  'identify_structure',
] as const;
export type GeneratedQuestionKind = (typeof GENERATED_QUESTION_KINDS)[number];

/** Compile-time proof the subset stays a subset. */
const _kindsAreDomainKinds: readonly QuestionKind[] = GENERATED_QUESTION_KINDS;
void _kindsAreDomainKinds;

export const CONTENT_TYPES = ['question', 'flashcard'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Generation limits.
 *
 * A count is a cost. Twenty items is already a long study set, and an
 * unbounded count on a server-side endpoint is a way for anyone holding the
 * URL to spend the account's tokens.
 */
export const GENERATION_LIMITS = {
  minCount: 1,
  maxCount: 20,
  maxOutputTokens: 2400,
  timeoutMs: 45_000,
  maxPromptChars: 400,
} as const;

const semanticIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isSemanticId, { message: 'Not a valid VEO semantic identifier.' })
  .transform((value) => value as SemanticId);

export const generationRequestSchema = z.object({
  /** Which model the structure belongs to. Resolved server-side. */
  modelRef: z.string().trim().min(1).max(200),
  semanticId: semanticIdSchema,
  contentType: z.enum(CONTENT_TYPES),
  objective: z.enum(LEARNING_OBJECTIVES),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  educationLevel: z.enum(LEARNING_LEVELS).default('intermediate'),
  count: z
    .number()
    .int()
    .min(GENERATION_LIMITS.minCount)
    .max(GENERATION_LIMITS.maxCount)
    .default(3),
  /**
   * Preferred question kinds. A preference, not an instruction: the server
   * still decides what the context can actually support.
   */
  kinds: z.array(z.enum(GENERATED_QUESTION_KINDS)).max(4).default([]),
  locale: z.string().trim().min(2).max(35).default('en'),
});

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GenerationRequestInput = z.input<typeof generationRequestSchema>;

// ---------------------------------------------------------------------------
// Structured model output
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string().trim().min(1).max(300),
  correct: z.boolean(),
});

/**
 * One generated question, as the model returns it.
 *
 * A discriminated union on `kind`, so each shape is checked against its own
 * rules rather than against a permissive superset where every field is
 * optional and nothing is ever actually required.
 */
export const generatedQuestionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('multiple_choice'),
    prompt: z.string().trim().min(5).max(500),
    options: z.array(optionSchema).min(2).max(6),
    explanation: z.string().trim().min(5).max(800),
    hint: z.string().trim().max(300).optional(),
    relatedSemanticIds: z.array(z.string().trim().max(200)).max(6).optional(),
  }),
  z.object({
    kind: z.literal('true_false'),
    prompt: z.string().trim().min(5).max(500),
    answer: z.boolean(),
    explanation: z.string().trim().min(5).max(800),
    hint: z.string().trim().max(300).optional(),
    relatedSemanticIds: z.array(z.string().trim().max(200)).max(6).optional(),
  }),
  z.object({
    kind: z.literal('free_recall'),
    prompt: z.string().trim().min(5).max(500),
    /** The concept a correct answer must express. Not a string to match. */
    answer: z.string().trim().min(1).max(400),
    /** Other phrasings that should be accepted. Bounded. */
    acceptable: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
    explanation: z.string().trim().min(5).max(800),
    hint: z.string().trim().max(300).optional(),
    relatedSemanticIds: z.array(z.string().trim().max(200)).max(6).optional(),
  }),
  z.object({
    kind: z.literal('identify_structure'),
    prompt: z.string().trim().min(5).max(500),
    /** Which structure the learner must find. Checked against the model. */
    targetSemanticId: z.string().trim().max(200),
    targetName: z.string().trim().min(1).max(200),
    explanation: z.string().trim().min(5).max(800),
    hint: z.string().trim().max(300).optional(),
    relatedSemanticIds: z.array(z.string().trim().max(200)).max(6).optional(),
  }),
]);

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

export const generatedFlashcardSchema = z.object({
  front: z.string().trim().min(3).max(300),
  back: z.string().trim().min(3).max(800),
  hint: z.string().trim().max(300).optional(),
  relatedSemanticIds: z.array(z.string().trim().max(200)).max(6).optional(),
});

export type GeneratedFlashcard = z.infer<typeof generatedFlashcardSchema>;

/** The whole reply: a batch, plus the model's own grounding claim. */
export const questionBatchSchema = z.object({
  questions: z.array(generatedQuestionSchema).min(1).max(GENERATION_LIMITS.maxCount),
  sourceStatus: z.enum(CONTENT_SOURCE_STATUSES),
});

export const flashcardBatchSchema = z.object({
  flashcards: z.array(generatedFlashcardSchema).min(1).max(GENERATION_LIMITS.maxCount),
  sourceStatus: z.enum(CONTENT_SOURCE_STATUSES),
});

// ---------------------------------------------------------------------------
// Validated output
// ---------------------------------------------------------------------------

/**
 * A question that passed every check.
 *
 * Carries its own objective, difficulty and level rather than inheriting them
 * implicitly from the request, so an item remains self-describing once it is
 * separated from the batch that produced it — which it will be, the moment a
 * later gate starts scheduling individual items.
 */
export interface ValidatedQuestion {
  readonly id: string;
  readonly semanticId: SemanticId;
  readonly objective: LearningObjectiveType;
  readonly kind: GeneratedQuestionKind;
  readonly difficulty: Difficulty;
  readonly educationLevel: string;
  readonly prompt: string;
  readonly options: readonly { readonly id: string; readonly label: string; readonly correct: boolean }[];
  readonly answer: QuestionAnswerValue;
  readonly explanation: string;
  readonly hint: string | null;
  readonly relatedSemanticIds: readonly SemanticId[];
  readonly sourceStatus: ContentSourceStatus;
}

export type QuestionAnswerValue =
  | { readonly kind: 'choice'; readonly optionIds: readonly string[] }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'text'; readonly text: string; readonly acceptable: readonly string[] }
  | { readonly kind: 'spatial'; readonly semanticId: SemanticId; readonly name: string };

export interface ValidatedFlashcard {
  readonly id: string;
  readonly semanticId: SemanticId;
  readonly objective: LearningObjectiveType;
  readonly difficulty: Difficulty;
  readonly educationLevel: string;
  readonly front: string;
  readonly back: string;
  readonly hint: string | null;
  readonly relatedSemanticIds: readonly SemanticId[];
  readonly sourceStatus: ContentSourceStatus;
}

export interface GenerationResult {
  readonly questions: readonly ValidatedQuestion[];
  readonly flashcards: readonly ValidatedFlashcard[];
  readonly sourceStatus: ContentSourceStatus;
  /**
   * What VEO rejected and why.
   *
   * Kept rather than discarded: a batch where eight of ten items were dropped
   * is a signal about the model or the context, and silently returning two
   * items would hide it.
   */
  readonly rejected: readonly RejectedItem[];
}

export interface RejectedItem {
  readonly reason: string;
  /** A short excerpt, for diagnosis. Never the whole item. */
  readonly excerpt: string;
}

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

export const GENERATION_ERROR_CODES = [
  'invalid_request',
  'no_model_loaded',
  'unknown_structure',
  'insufficient_context',
  'objective_unsupported',
  'not_configured',
  'provider_failed',
  'provider_timeout',
  'malformed_output',
  'no_usable_content',
  'rate_limited',

  /*
   * Plan boundaries, from Gate 14's billing gate.
   *
   * These are NOT failures — the request was well formed and VEO understood
   * it perfectly. They are the shape of the learner's account, and the UI has
   * to tell them apart from a fault: "try again" against a spent allowance
   * invites somebody to keep pressing a button that cannot work.
   */
  'unauthenticated',
  'plan_required',
  'quota_exhausted',
] as const;
export type GenerationErrorCode = (typeof GENERATION_ERROR_CODES)[number];

export interface GenerationFailure {
  readonly code: GenerationErrorCode;
  /** Safe to render. Never an upstream message or a stack. */
  readonly message: string;
}

export type GenerationOutcome =
  | { readonly ok: true; readonly result: GenerationResult }
  | { readonly ok: false; readonly error: GenerationFailure };

export const GENERATION_ERROR_MESSAGES: Record<GenerationErrorCode, string> = {
  invalid_request: "That request wasn't something VEO could act on.",
  no_model_loaded: 'Open a model first, then generate content from a structure in it.',
  unknown_structure: 'That structure is not part of the model currently open.',
  insufficient_context:
    'This model does not carry enough information about that structure to build study material from it.',
  objective_unsupported: 'VEO cannot build that kind of question from what this model supplies.',
  not_configured: 'Content generation has not been configured for this environment yet.',
  provider_failed: "VEO couldn't generate that right now. Try again.",
  provider_timeout: 'That took too long to generate. Try again.',
  malformed_output: "VEO couldn't read what came back. Try again.",
  no_usable_content:
    'Nothing came back that VEO could stand behind, so it produced nothing rather than something unreliable.',
  rate_limited: 'Too many requests at once. Wait a moment and try again.',

  // Mirrors `DENIAL_MESSAGES` in `@/billing/access`, which is the server's
  // wording. Repeated rather than imported because that module is reachable
  // from a client component and this one is the client-facing contract.
  unauthenticated: 'Sign in to generate study material.',
  plan_required: 'Generating this is part of a paid plan.',
  quota_exhausted: "You have used today's free allowance. It resets tomorrow.",
};

export function generationFailure(
  code: GenerationErrorCode,
  message?: string,
): GenerationFailure {
  return { code, message: message ?? GENERATION_ERROR_MESSAGES[code] };
}
