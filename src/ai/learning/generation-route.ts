import 'server-only';

import { NextResponse } from 'next/server';
import { requireEntitlement } from '@/billing/server/gate';
import { DENIAL_STATUS } from '@/billing/access';
import { resolveModelGraph } from '../context/model-resolver';
import { OpenAIClient } from '../providers/openai';
import { stubEnabled, VerificationStubClient } from '../providers/verification-stub';
import { generateLearningContent } from './learning-service';
import {
  GENERATION_ERROR_MESSAGES,
  type ContentType,
  type GenerationErrorCode,
} from './learning-types';

/**
 * The shared body of both generation endpoints.
 *
 * `/api/ai/questions` and `/api/ai/flashcards` differ only in which content
 * type they force. Everything else — model resolution, context building,
 * grounding, validation, failure mapping — is identical, and two copies of it
 * would be two places for the grounding policy to drift.
 *
 * The content type is forced by the ROUTE rather than read from the body, so
 * a request to the questions endpoint cannot return flashcards.
 */

const STATUS_BY_CODE: Record<GenerationErrorCode, number> = {
  invalid_request: 400,
  no_model_loaded: 400,
  unknown_structure: 404,
  // Not an error in the deployment — the model simply does not carry enough
  // about this structure. 422: the request was well-formed and cannot be met.
  insufficient_context: 422,
  objective_unsupported: 422,
  not_configured: 503,
  provider_failed: 502,
  provider_timeout: 504,
  malformed_output: 502,
  no_usable_content: 422,
  rate_limited: 429,

  // Taken from the billing module rather than repeated, so a status cannot
  // mean one thing at the gate and another here.
  unauthenticated: DENIAL_STATUS.unauthenticated,
  plan_required: DENIAL_STATUS.plan_required,
  quota_exhausted: DENIAL_STATUS.quota_exhausted,
};

function failure(code: GenerationErrorCode, message?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message: message ?? GENERATION_ERROR_MESSAGES[code] } },
    { status: STATUS_BY_CODE[code] },
  );
}

/** The provider. Same abstraction the tutor uses; never a second client. */
function contentClient() {
  return stubEnabled() ? new VerificationStubClient() : new OpenAIClient();
}

export async function handleGeneration(request: Request, contentType: ContentType) {
  /*
   * The route decides which entitlement applies, from the content type it was
   * constructed with — never from the body. A request to the questions
   * endpoint cannot spend a flashcard allowance by claiming to be a flashcard,
   * for the same reason it cannot return flashcards.
   */
  const gate = await requireEntitlement(
    contentType === 'flashcard' ? 'ai.generate_flashcards' : 'ai.generate_questions',
  );
  if (!gate.ok) return gate.failure.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return failure('invalid_request');
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('invalid_request');
  }

  const body = payload as Record<string, unknown>;

  const modelRef = body.modelRef;
  if (typeof modelRef !== 'string' || modelRef.trim().length === 0) {
    return failure('invalid_request');
  }

  // ---- resolve the model, server-side -------------------------------------
  //
  // The client sends a REFERENCE. Every fact the generator uses is read from
  // the model VEO resolves here, so a client cannot supply "this structure's
  // function is X" and have VEO write a question asserting it.

  const resolved = await resolveModelGraph(modelRef.trim());
  if (!resolved.ok) {
    return failure(
      resolved.code === 'unknown_model' ? 'no_model_loaded' : 'not_configured',
      resolved.message,
    );
  }

  const { outcome } = await generateLearningContent(
    // The route decides the content type. Anything the client sent under that
    // key is discarded rather than merged.
    { ...body, contentType },
    {
      client: contentClient(),
      graph: resolved.graph,
      isFixture: resolved.isFixture,
    },
  );

  if (!outcome.ok) return failure(outcome.error.code, outcome.error.message);

  const { rejected, ...result } = outcome.result;

  return NextResponse.json({
    ok: true,
    result:
      // What VEO threw away is useful while developing and noise in
      // production — but it is never a reason to fail the request.
      process.env.NODE_ENV === 'development' ? { ...result, rejected } : result,
    ...(stubEnabled() ? { verificationStub: true } : {}),
  });
}

/** Whether generation can run at all, for the UI's unavailable state. */
export function generationStatus() {
  const status = contentClient().getStatus();
  return NextResponse.json({
    configured: status.ready,
    // Names the variable, never its value.
    reason: status.reason,
  });
}
