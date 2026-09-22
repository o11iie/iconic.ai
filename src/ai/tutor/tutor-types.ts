import { z } from 'zod';
import { isSemanticId, type SemanticId } from '@/lib/semantic-id';
import { LEARNING_LEVELS } from '@/types/domain/user';
import { SPATIAL_ACTION_KINDS, type SpatialActionKind } from '../context/spatial-context';

/**
 * The tutor's wire contracts.
 *
 * Both directions are validated. The request because a browser can send
 * anything; the response because a language model can return anything —
 * including well-formed JSON describing a structure that does not exist.
 *
 * Nothing here talks to a model or to the scene, so it can be tested on its
 * own and reasoned about without either.
 */

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * What the learner asked for.
 *
 * Gate 10 actions only. Question and flashcard generation belong to a later
 * gate and are deliberately absent: an action the server does not accept is a
 * far better boundary than an action it accepts and quietly mishandles.
 */
export const TUTOR_ACTIONS = [
  'EXPLAIN',
  'FUNCTION',
  'RELATIONSHIPS',
  'SIMPLIFY',
  'DEEP_DIVE',
  'COMPARE',
  'FOLLOW_UP',
] as const;
export type TutorAction = (typeof TUTOR_ACTIONS)[number];

/**
 * Education level.
 *
 * Reuses the platform's existing `LearningLevel` rather than introducing a
 * parallel vocabulary. A second enum meaning the same thing is how a learner's
 * profile setting and the tutor's depth end up disagreeing.
 */
export const educationLevelSchema = z.enum(LEARNING_LEVELS);
export type EducationLevel = z.infer<typeof educationLevelSchema>;

/** Bounds on what a client may send. Beyond these it is not a question. */
export const REQUEST_LIMITS = {
  maxMessageChars: 1000,
  maxHistoryTurns: 8,
  maxHistoryChars: 4000,
  maxCompareTargets: 3,
} as const;

const semanticIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isSemanticId, { message: 'Not a valid VEO semantic identifier.' })
  .transform((value) => value as SemanticId);

export const tutorTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(REQUEST_LIMITS.maxMessageChars),
});
export type TutorTurn = z.infer<typeof tutorTurnSchema>;

export const tutorRequestSchema = z.object({
  selectedSemanticId: semanticIdSchema,
  /**
   * The learner's own words.
   *
   * Optional because the action buttons ("Explain", "Function") are complete
   * requests on their own — requiring a typed message would mean inventing one
   * on the client, which is a prompt VEO did not write.
   */
  userMessage: z.string().trim().max(REQUEST_LIMITS.maxMessageChars).optional(),
  action: z.enum(TUTOR_ACTIONS),
  educationLevel: educationLevelSchema.default('intermediate'),
  /** Groups turns. Opaque to the server; it stores nothing against it. */
  conversationId: z.string().trim().min(1).max(100).optional(),
  /** Prior turns, sent by the client and re-bounded here regardless. */
  history: z.array(tutorTurnSchema).max(REQUEST_LIMITS.maxHistoryTurns * 2).default([]),
  /** For COMPARE. Validated against the model like any other id. */
  compareWith: z.array(semanticIdSchema).max(REQUEST_LIMITS.maxCompareTargets).default([]),
  locale: z.string().trim().min(2).max(35).default('en'),
});

export type TutorRequest = z.infer<typeof tutorRequestSchema>;

/**
 * The parsed-but-not-yet-validated request shape.
 *
 * `z.input` rather than `TutorRequest` because defaults mean the client may
 * legitimately omit fields the parsed type marks as present.
 */
export type TutorRequestInput = z.input<typeof tutorRequestSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * How well the answer is supported by what VEO supplied.
 *
 * This is the field that makes honesty visible in the UI. `insufficient` is a
 * successful response — the tutor correctly reporting that the model carries
 * no substantive information about this structure — not an error.
 */
export const SOURCE_STATUSES = ['grounded', 'partially-grounded', 'insufficient-context'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const spatialActionSchema = z.object({
  kind: z.enum(SPATIAL_ACTION_KINDS),
  /** Target structure, for the structure-scoped actions. */
  semanticId: z.string().trim().max(200).optional(),
  /** Target layer, for the layer-scoped actions. */
  layerId: z.string().trim().max(100).optional(),
  label: z.string().trim().min(1).max(80),
});
export type ProposedSpatialAction = z.infer<typeof spatialActionSchema>;

export const relatedStructureSchema = z.object({
  semanticId: z.string().trim().max(200),
  name: z.string().trim().min(1).max(200),
  /** Why it is worth looking at next. One line. */
  reason: z.string().trim().max(300).optional(),
});
export type RelatedStructureRef = z.infer<typeof relatedStructureSchema>;

/**
 * The model's structured reply.
 *
 * Loose at the edges deliberately: `semanticId` is a plain string here because
 * a model WILL occasionally invent one, and rejecting the whole response for
 * that would throw away a good explanation over a bad footnote. Invented ids
 * are dropped by the grounding pass, which can tell the difference.
 */
export const tutorModelOutputSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  title: z.string().trim().max(120).optional(),
  keyPoints: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
  relatedStructures: z.array(relatedStructureSchema).max(6).optional(),
  suggestedQuestions: z.array(z.string().trim().min(1).max(200)).max(4).optional(),
  spatialActions: z.array(spatialActionSchema).max(4).optional(),
  sourceStatus: z.enum(SOURCE_STATUSES),
  confidence: z.number().min(0).max(1).optional(),
});
export type TutorModelOutput = z.infer<typeof tutorModelOutputSchema>;

/** What the UI receives. Every id in it is known to resolve in the model. */
export interface TutorResponse {
  readonly message: string;
  readonly title: string | null;
  readonly keyPoints: readonly string[];
  readonly selectedStructure: {
    readonly semanticId: SemanticId;
    readonly name: string;
  };
  readonly relatedStructures: readonly {
    readonly semanticId: SemanticId;
    readonly name: string;
    readonly reason: string | null;
  }[];
  readonly suggestedQuestions: readonly string[];
  readonly spatialActions: readonly ValidatedSpatialAction[];
  readonly sourceStatus: SourceStatus;
  readonly confidence: number | null;
  /** What VEO dropped from the model's reply, and why. Surfaced in dev only. */
  readonly notices: readonly string[];
}

export interface ValidatedSpatialAction {
  readonly kind: SpatialActionKind;
  readonly semanticId: SemanticId | null;
  readonly layerId: string | null;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

/**
 * Why a tutor turn failed.
 *
 * Distinct from `VeoError` codes because these are the states the tutor UI
 * actually branches on, and it needs to tell "the model said nothing useful"
 * apart from "the provider is down".
 */
export const TUTOR_ERROR_CODES = [
  'invalid_request',
  'no_model_loaded',
  'unknown_structure',
  'not_configured',
  'provider_failed',
  'provider_timeout',
  'malformed_output',
  'rate_limited',
] as const;
export type TutorErrorCode = (typeof TUTOR_ERROR_CODES)[number];

export interface TutorFailure {
  readonly code: TutorErrorCode;
  /** Safe to render. Never carries an upstream message or a stack. */
  readonly message: string;
}

export type TutorResult =
  | { readonly ok: true; readonly response: TutorResponse }
  | { readonly ok: false; readonly error: TutorFailure };

/** User-facing copy per failure, so the UI never composes its own. */
export const TUTOR_ERROR_MESSAGES: Record<TutorErrorCode, string> = {
  invalid_request: "That request wasn't something VEO could act on.",
  no_model_loaded: 'Open a model first, then ask about a structure in it.',
  unknown_structure: 'That structure is not part of the model currently open.',
  not_configured: 'The AI tutor has not been configured for this environment yet.',
  provider_failed: "VEO couldn't answer that right now. Try again.",
  provider_timeout: 'That took too long to answer. Try again.',
  malformed_output: "VEO couldn't read the answer it got back. Try again.",
  rate_limited: 'Too many questions at once. Wait a moment and try again.',
};

export function tutorFailure(code: TutorErrorCode, message?: string): TutorFailure {
  return { code, message: message ?? TUTOR_ERROR_MESSAGES[code] };
}
