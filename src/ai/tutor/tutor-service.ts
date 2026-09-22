import type { SpatialModelGraph } from '@/types/domain/spatial';
import type { LLMClient } from '../client';
import {
  buildSpatialContext,
  type SceneStateView,
  type SpatialContext,
} from '../context/spatial-context';
import { groundResponse } from '../safety/grounding';
import { boundHistory } from './conversation';
import { buildTutorMessages } from './tutor-prompt';
import {
  tutorFailure,
  tutorModelOutputSchema,
  tutorRequestSchema,
  type TutorRequest,
  type TutorRequestInput,
  type TutorResult,
} from './tutor-types';

/**
 * The tutor turn, end to end.
 *
 * validate request → resolve structure → build context → build prompt →
 * call provider → validate output → ground against context → respond.
 *
 * Every step can fail, and each failure has its own honest outcome. Nothing
 * here falls back to a generated answer when a step fails: a tutor that
 * invents an explanation because the model timed out is worse than one that
 * says it could not answer.
 *
 * This module holds no key and performs no I/O of its own — it is handed an
 * `LLMClient`. That is what makes the whole pipeline testable without a
 * network, and what lets the vendor change without this file changing.
 */

/** Output bounds. A tutor answer is an explanation, not an essay. */
export const RESPONSE_LIMITS = {
  maxOutputTokens: 900,
  timeoutMs: 20_000,
  temperature: 0.3,
} as const;

export interface TutorServiceOptions {
  readonly client: LLMClient;
  readonly graph: SpatialModelGraph | null;
  readonly scene: SceneStateView;
  /** Marks controlled test content, so the prompt can say so. */
  readonly isFixture?: boolean;
  readonly timeoutMs?: number;
  /** Injected in tests so a timeout can be proven without waiting for one. */
  readonly now?: () => number;
}

export interface TutorTurnResult extends Record<string, unknown> {
  readonly result: TutorResult;
  /** The context actually sent. Returned so callers can assert on it. */
  readonly context: SpatialContext | null;
}

/**
 * Run one tutor turn.
 *
 * Takes the raw client payload rather than a parsed request: validation is
 * part of the pipeline, not a precondition a caller could skip.
 */
export async function runTutorTurn(
  payload: unknown,
  options: TutorServiceOptions,
): Promise<TutorTurnResult> {
  // ---- 1. the request -----------------------------------------------------

  const parsed = tutorRequestSchema.safeParse(payload as TutorRequestInput);
  if (!parsed.success) {
    return {
      context: null,
      result: {
        ok: false,
        error: tutorFailure('invalid_request'),
      },
    };
  }

  const request: TutorRequest = {
    ...parsed.data,
    // Re-bound regardless of what the client kept. The client's window is a
    // UX choice; this is the cost ceiling.
    history: [...boundHistory(parsed.data.history)],
  };

  // ---- 2. provider readiness ---------------------------------------------
  //
  // Checked before building context: there is no point assembling a prompt
  // for a provider that cannot be called, and the learner needs a different
  // message for "not configured" than for "could not answer".

  const status = options.client.getStatus();
  if (!status.ready) {
    return { context: null, result: { ok: false, error: tutorFailure('not_configured') } };
  }

  // ---- 3. the context -----------------------------------------------------

  const built = buildSpatialContext({
    graph: options.graph,
    semanticId: request.selectedSemanticId,
    scene: options.scene,
    ...(options.isFixture === undefined ? {} : { isFixture: options.isFixture }),
  });

  if (!built.ok) {
    const code = built.error.code === 'no_model' ? 'no_model_loaded' : 'unknown_structure';
    return {
      context: null,
      result: { ok: false, error: tutorFailure(code, built.error.message) },
    };
  }

  const context = built.context;

  // ---- 4. the call --------------------------------------------------------

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? RESPONSE_LIMITS.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let completion;
  try {
    completion = await options.client.complete({
      messages: buildTutorMessages(request, context),
      temperature: RESPONSE_LIMITS.temperature,
      maxOutputTokens: RESPONSE_LIMITS.maxOutputTokens,
      signal: controller.signal,
      json: true,
    });
  } catch (cause) {
    // A provider that throws rather than returning an error Result. Whatever
    // it threw stays here: upstream text can carry account identifiers, quota
    // details and request ids, none of which belong in a learner's browser.
    return {
      context,
      result: {
        ok: false,
        error: tutorFailure(isAbort(cause) ? 'provider_timeout' : 'provider_failed'),
      },
    };
  } finally {
    clearTimeout(timer);
  }

  if (!completion.ok) {
    const code = completion.error.code;
    return {
      context,
      result: {
        ok: false,
        error: tutorFailure(
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

  // ---- 5. the output ------------------------------------------------------

  const text = completion.value.text.trim();
  if (text.length === 0) {
    return { context, result: { ok: false, error: tutorFailure('malformed_output') } };
  }

  const json = parseJsonObject(text);
  if (json === null) {
    return { context, result: { ok: false, error: tutorFailure('malformed_output') } };
  }

  const output = tutorModelOutputSchema.safeParse(json);
  if (!output.success) {
    return { context, result: { ok: false, error: tutorFailure('malformed_output') } };
  }

  // ---- 6. grounding -------------------------------------------------------

  const grounded = groundResponse(output.data, context);

  return { context, result: { ok: true, response: grounded.response } };
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
 * Tolerant of the two things models do even when asked for bare JSON: wrapping
 * it in a markdown fence, and adding a sentence before it. Tolerant is not the
 * same as lenient — the result still has to be an object, and it still has to
 * pass the schema.
 */
function parseJsonObject(text: string): unknown {
  const direct = tryParse(text);
  if (direct !== null) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1].trim());
    if (inner !== null) return inner;
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return tryParse(text.slice(first, last + 1));
  }

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
