import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveModelGraph } from '@/ai/context/model-resolver';
import type { SceneStateView } from '@/ai/context/spatial-context';
import { OpenAIClient } from '@/ai/providers/openai';
import { runTutorTurn } from '@/ai/tutor/tutor-service';
import { TUTOR_ERROR_MESSAGES, type TutorErrorCode } from '@/ai/tutor/tutor-types';
import { NO_CAPABILITIES } from '@/engine/spatial/capabilities';
import type { SemanticId } from '@/lib/semantic-id';

export const dynamic = 'force-dynamic';

/**
 * The tutor endpoint.
 *
 * Everything that decides what the tutor is told happens on this side of the
 * boundary: which model is open, what that model contains, what the system
 * prompt says, and what grounding policy applies. The browser contributes a
 * model reference, a semantic id, a question, and a description of what the
 * learner has currently hidden or isolated.
 *
 * It cannot contribute a system prompt, a structure, a fact, or a relaxation
 * of any rule. That is the whole point of the split: a tutor whose grounding
 * policy is client-supplied has no grounding policy.
 *
 * The API key never leaves this process. `OpenAIClient` imports `server-only`,
 * so a client component that reached for it would fail the build rather than
 * ship a key.
 */

/**
 * The learner's view of the scene.
 *
 * Bounded, because these arrays come from a browser. A hidden-id list is
 * harmless in content but unbounded in size, and this endpoint costs money
 * per call.
 */
const sceneStateSchema = z.object({
  selectedSemanticId: z.string().trim().max(200).nullable().default(null),
  isolatedSemanticId: z.string().trim().max(200).nullable().default(null),
  hiddenIds: z.array(z.string().trim().max(200)).max(500).default([]),
  ghostedIds: z.array(z.string().trim().max(200)).max(500).default([]),
  visibleLayerIds: z.array(z.string().trim().max(100)).max(100).default([]),
  capabilities: z.record(z.string(), z.boolean()).default({}),
});

const bodySchema = z.object({
  modelRef: z.string().trim().min(1).max(200),
  scene: sceneStateSchema.default({
    selectedSemanticId: null,
    isolatedSemanticId: null,
    hiddenIds: [],
    ghostedIds: [],
    visibleLayerIds: [],
    capabilities: {},
  }),
});

const STATUS_BY_CODE: Record<TutorErrorCode, number> = {
  invalid_request: 400,
  no_model_loaded: 400,
  unknown_structure: 404,
  not_configured: 503,
  provider_failed: 502,
  provider_timeout: 504,
  malformed_output: 502,
  rate_limited: 429,
};

function failure(code: TutorErrorCode, message?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message: message ?? TUTOR_ERROR_MESSAGES[code] } },
    { status: STATUS_BY_CODE[code] },
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return failure('invalid_request');
  }

  const envelope = bodySchema.safeParse(payload);
  if (!envelope.success) return failure('invalid_request');

  // ---- resolve the model, server-side -------------------------------------

  const resolved = await resolveModelGraph(envelope.data.modelRef);
  if (!resolved.ok) {
    return failure(
      resolved.code === 'unknown_model' ? 'no_model_loaded' : 'not_configured',
      resolved.message,
    );
  }

  // ---- the learner's scene state ------------------------------------------
  //
  // Capabilities are intersected with the model's own, never taken from the
  // client: a browser claiming `supportsIsolation` on a model that cannot
  // isolate would have the tutor propose an action the scene then refuses.

  const claimed = envelope.data.scene.capabilities;
  const capabilities = { ...NO_CAPABILITIES };
  for (const key of Object.keys(capabilities) as (keyof typeof capabilities)[]) {
    capabilities[key] = claimed[key] === true;
  }

  const scene: SceneStateView = {
    selectedId: (envelope.data.scene.selectedSemanticId as SemanticId | null) ?? null,
    isolatedId: (envelope.data.scene.isolatedSemanticId as SemanticId | null) ?? null,
    hiddenIds: new Set(envelope.data.scene.hiddenIds as SemanticId[]),
    ghostedIds: new Set(envelope.data.scene.ghostedIds as SemanticId[]),
    visibleLayerIds: new Set(envelope.data.scene.visibleLayerIds),
    capabilities,
  };

  // ---- run the turn -------------------------------------------------------

  const { result } = await runTutorTurn(payload, {
    client: new OpenAIClient(),
    graph: resolved.graph,
    scene,
    isFixture: resolved.isFixture,
  });

  if (!result.ok) {
    return failure(result.error.code, result.error.message);
  }

  // `notices` explain what VEO dropped from the model's reply. Useful while
  // developing, noise in production, and never a reason to fail the turn.
  const { notices, ...response } = result.response;

  return NextResponse.json({
    ok: true,
    response:
      process.env.NODE_ENV === 'development' ? { ...response, notices } : response,
  });
}

/** Whether the tutor can answer at all, for the UI's unavailable state. */
export function GET() {
  const status = new OpenAIClient().getStatus();
  return NextResponse.json({
    configured: status.ready,
    // The reason names the variable, never its value.
    reason: status.reason,
  });
}
