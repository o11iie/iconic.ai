import type { SpatialModelGraph } from '@/types/domain/spatial';
import type { ContentSourceStatus } from '@/types/domain/learning';
import type { LLMClient } from '../client';
import { buildLearningContext, explainUnsupported, type LearningContext } from './learning-context';
import { validateFlashcards, validateQuestions } from './content-validation';
import { buildGenerationMessages } from './learning-prompt';
import {
  flashcardBatchSchema,
  generationFailure,
  generationRequestSchema,
  GENERATION_LIMITS,
  questionBatchSchema,
  type GenerationOutcome,
  type GenerationRequest,
  type RejectedItem,
  type ValidatedFlashcard,
  type ValidatedQuestion,
} from './learning-types';

/**
 * Learning-content generation, end to end.
 *
 *   validate request → resolve structure → build context → check the objective
 *   is supportable → prompt → provider → validate schema → validate content
 *   → dedupe → return
 *
 * Reuses the Gate 10 `LLMClient` rather than reaching for a vendor SDK: this
 * module holds no key, performs no network I/O of its own, and can therefore
 * be tested end to end without one.
 *
 * ## Where this is stricter than the tutor
 *
 * The tutor may answer "the model doesn't tell me much about this" — honest,
 * useful, and gone the moment the learner moves on. Generated content persists
 * and will be shown again, so `insufficient-context` is a REFUSAL here, not a
 * caveat. VEO would rather produce nothing than produce a flashcard it cannot
 * stand behind.
 */

export interface LearningServiceOptions {
  readonly client: LLMClient;
  readonly graph: SpatialModelGraph | null;
  readonly isFixture?: boolean;
  readonly timeoutMs?: number;
}

export interface GenerationTurn {
  readonly outcome: GenerationOutcome;
  /** The context used. Returned so callers and tests can assert against it. */
  readonly context: LearningContext | null;
}

export async function generateLearningContent(
  payload: unknown,
  options: LearningServiceOptions,
): Promise<GenerationTurn> {
  // ---- 1. the request -----------------------------------------------------

  const parsed = generationRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return { context: null, outcome: { ok: false, error: generationFailure('invalid_request') } };
  }
  const request: GenerationRequest = parsed.data;

  // ---- 2. provider readiness ---------------------------------------------

  const status = options.client.getStatus();
  if (!status.ready) {
    return { context: null, outcome: { ok: false, error: generationFailure('not_configured') } };
  }

  // ---- 3. the context -----------------------------------------------------

  const built = buildLearningContext({
    graph: options.graph,
    semanticId: request.semanticId,
    ...(options.isFixture === undefined ? {} : { isFixture: options.isFixture }),
  });

  if (!built.ok) {
    const code = built.error.code === 'no_model' ? 'no_model_loaded' : 'unknown_structure';
    return {
      context: null,
      outcome: { ok: false, error: generationFailure(code, built.error.message) },
    };
  }

  const context = built.context;

  // ---- 4. can this objective be supported at all? -------------------------
  //
  // Checked BEFORE the model is called, because the alternative is paying for
  // a request whose only possible correct answer is "I cannot do this" — and
  // hoping the model says so rather than obliging.

  if (context.sourceStatus === 'insufficient-context') {
    return {
      context,
      outcome: {
        ok: false,
        error: generationFailure(
          'insufficient_context',
          `This model supplies almost nothing about "${context.subject.name}" — only its name and where it sits. There is not enough to build study material from.`,
        ),
      },
    };
  }

  if (!context.supports.includes(request.objective)) {
    return {
      context,
      outcome: {
        ok: false,
        error: generationFailure(
          'objective_unsupported',
          explainUnsupported(context, request.objective),
        ),
      },
    };
  }

  // ---- 5. the call --------------------------------------------------------

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? GENERATION_LIMITS.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let completion;
  try {
    completion = await options.client.complete({
      messages: buildGenerationMessages(request, context),
      temperature: 0.4,
      maxOutputTokens: GENERATION_LIMITS.maxOutputTokens,
      signal: controller.signal,
      json: true,
    });
  } catch (cause) {
    return {
      context,
      outcome: {
        ok: false,
        error: generationFailure(isAbort(cause) ? 'provider_timeout' : 'provider_failed'),
      },
    };
  } finally {
    clearTimeout(timer);
  }

  if (!completion.ok) {
    const code = completion.error.code;
    return {
      context,
      outcome: {
        ok: false,
        error: generationFailure(
          code === 'rate_limited'
            ? 'rate_limited'
            : code === 'provider_not_configured'
              ? 'not_configured'
              : controller.signal.aborted
                ? 'provider_timeout'
                : 'provider_failed',
        ),
      },
    };
  }

  // ---- 6. schema ----------------------------------------------------------

  const json = parseJsonObject(completion.value.text.trim());
  if (json === null) {
    return { context, outcome: { ok: false, error: generationFailure('malformed_output') } };
  }

  const validationInput = {
    context,
    objective: request.objective,
    difficulty: request.difficulty,
    educationLevel: request.educationLevel,
    // The model's claim is capped by what VEO measured. It may report worse
    // than the context supports, never better.
    sourceStatus: reconcile(json, context.sourceStatus),
  };

  let rejected: readonly RejectedItem[] = [];
  let questions: readonly ValidatedQuestion[] = [];
  let flashcards: readonly ValidatedFlashcard[] = [];

  if (request.contentType === 'flashcard') {
    const batch = flashcardBatchSchema.safeParse(json);
    if (!batch.success) {
      return { context, outcome: { ok: false, error: generationFailure('malformed_output') } };
    }
    const result = validateFlashcards(batch.data.flashcards, validationInput);
    flashcards = result.accepted;
    rejected = result.rejected;
  } else {
    const batch = questionBatchSchema.safeParse(json);
    if (!batch.success) {
      return { context, outcome: { ok: false, error: generationFailure('malformed_output') } };
    }
    const result = validateQuestions(batch.data.questions, validationInput);
    questions = result.accepted;
    rejected = result.rejected;
  }

  // ---- 7. did anything survive? ------------------------------------------

  if (questions.length === 0 && flashcards.length === 0) {
    return {
      context,
      outcome: { ok: false, error: generationFailure('no_usable_content') },
    };
  }

  // Never return more than was asked for, whatever the model produced.
  return {
    context,
    outcome: {
      ok: true,
      result: {
        questions: questions.slice(0, request.count),
        flashcards: flashcards.slice(0, request.count),
        sourceStatus: validationInput.sourceStatus,
        rejected,
      },
    },
  };
}

/** Cap the model's grounding claim at what VEO measured. */
function reconcile(json: unknown, measured: ContentSourceStatus): ContentSourceStatus {
  const claimed = (json as { sourceStatus?: unknown }).sourceStatus;
  const rank: Record<ContentSourceStatus, number> = {
    'insufficient-context': 0,
    'partially-grounded': 1,
    grounded: 2,
  };

  if (typeof claimed !== 'string' || !(claimed in rank)) return measured;
  const claim = claimed as ContentSourceStatus;
  return rank[claim] > rank[measured] ? measured : claim;
}

function isAbort(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === 'AbortError' || cause.message.toLowerCase().includes('abort'))
  );
}

/**
 * Parse a JSON object from model output.
 *
 * Tolerant of a markdown fence and of a sentence before the JSON, because
 * models do both even when told not to. Tolerant is not lenient: the result
 * must still be an object and must still pass the schema.
 */
function parseJsonObject(text: string): unknown {
  if (text.length === 0) return null;

  const direct = tryParse(text);
  if (direct !== null) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1].trim());
    if (inner !== null) return inner;
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return tryParse(text.slice(first, last + 1));

  return null;
}

function tryParse(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
