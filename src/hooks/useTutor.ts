'use client';

import { useCallback, useRef, useState } from 'react';
import { appendTurn, shouldResetConversation } from '@/ai/tutor/conversation';
import type {
  EducationLevel,
  TutorAction,
  TutorFailure,
  TutorResponse,
  TutorTurn,
} from '@/ai/tutor/tutor-types';
import type { SceneController } from '@/engine/spatial/scene-controller';
import type { SemanticId } from '@/lib/semantic-id';

/**
 * The tutor, from the browser's side.
 *
 * Owns exactly three things: the in-flight request, the current answer, and
 * the rolling conversation window. Everything that decides what the tutor is
 * told happens on the server; this hook cannot influence it beyond choosing an
 * action and typing a question.
 *
 * Scene state is read from the controller at send time rather than mirrored
 * here. Gate 7 established one source of truth for what is hidden and isolated,
 * and a second copy inside a hook would be a second source of truth that goes
 * stale exactly when a learner manipulates the model mid-conversation.
 */

export type TutorStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'partial'
  | 'insufficient'
  | 'error'
  | 'unavailable';

export interface TutorState {
  readonly status: TutorStatus;
  readonly response: TutorResponse | null;
  readonly error: TutorFailure | null;
  readonly history: readonly TutorTurn[];
  /** The structure the current answer is about. */
  readonly subjectId: SemanticId | null;
}

const IDLE: TutorState = {
  status: 'idle',
  response: null,
  error: null,
  history: [],
  subjectId: null,
};

export interface AskOptions {
  readonly semanticId: SemanticId;
  readonly action: TutorAction;
  readonly message?: string;
  readonly educationLevel: EducationLevel;
  readonly modelRef: string;
}

/** Status implied by how well the answer was actually grounded. */
function statusFor(response: TutorResponse): TutorStatus {
  switch (response.sourceStatus) {
    case 'grounded':
      return 'success';
    case 'partially-grounded':
      return 'partial';
    case 'insufficient-context':
      return 'insufficient';
  }
}

export function useTutor(controller: SceneController | null) {
  const [state, setState] = useState<TutorState>(IDLE);

  // Abort an in-flight turn when a new one starts. Without this, a learner who
  // clicks twice gets whichever response happens to land second.
  const inFlight = useRef<AbortController | null>(null);
  const conversationId = useRef<string>(crypto.randomUUID());

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    conversationId.current = crypto.randomUUID();
    setState(IDLE);
  }, []);

  const ask = useCallback(
    async (options: AskOptions) => {
      inFlight.current?.abort();
      const abort = new AbortController();
      inFlight.current = abort;

      // A new subject is a new conversation. Carrying the previous exchange
      // forward would let the tutor answer about the structure the learner
      // just navigated away from.
      const fresh = shouldResetConversation(state.subjectId, options.semanticId);
      const history = fresh ? [] : state.history;
      if (fresh) conversationId.current = crypto.randomUUID();

      setState({
        status: 'loading',
        response: null,
        error: null,
        history,
        subjectId: options.semanticId,
      });

      /*
       * Read the live scene rather than a mirrored copy.
       *
       * `visual.states` is the controller's RESOLVED answer per object, after
       * the whole precedence chain has run. Sending that rather than the raw
       * hidden/ghosted sets means the tutor is told what the learner can
       * actually see — a structure hidden because its layer was peeled reads
       * as not-visible here, which is what the learner is looking at, even
       * though nobody hid it directly.
       */
      const snapshot = controller?.getSnapshot();
      const states = snapshot?.visual.states;
      const idsInState = (...wanted: readonly string[]): SemanticId[] =>
        states
          ? [...states.entries()]
              .filter(([, state]) => wanted.includes(state))
              .map(([id]) => id)
          : [];

      const scene = {
        selectedSemanticId: controller?.getSelectedObject()?.semanticId ?? null,
        isolatedSemanticId: controller?.getIsolatedId() ?? null,
        hiddenIds: idsInState('hidden', 'dissected'),
        ghostedIds: idsInState('ghosted', 'peeled'),
        visibleLayerIds:
          controller
            ?.getLayers()
            .filter((layer) => controller.isLayerVisible(layer.id))
            .map((layer) => layer.id) ?? [],
        capabilities: controller?.getCapabilities() ?? {},
      };

      try {
        const httpResponse = await fetch('/api/ai/tutor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({
            modelRef: options.modelRef,
            selectedSemanticId: options.semanticId,
            action: options.action,
            ...(options.message ? { userMessage: options.message } : {}),
            educationLevel: options.educationLevel,
            conversationId: conversationId.current,
            history,
            scene,
          }),
        });

        const payload: unknown = await httpResponse.json().catch(() => null);

        if (!isEnvelope(payload)) {
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: { code: 'provider_failed', message: "VEO couldn't answer that right now. Try again." },
          }));
          return;
        }

        if (!payload.ok) {
          setState((prev) => ({
            ...prev,
            status: payload.error.code === 'not_configured' ? 'unavailable' : 'error',
            error: payload.error,
          }));
          return;
        }

        const response = payload.response;
        const asked =
          options.message?.trim() ??
          `[${options.action.toLowerCase().replace(/_/g, ' ')}]`;

        setState({
          status: statusFor(response),
          response,
          error: null,
          history: appendTurn(appendTurn(history, { role: 'user', content: asked }), {
            role: 'assistant',
            content: response.message,
          }),
          subjectId: options.semanticId,
        });
      } catch (cause) {
        // An aborted request is a superseded one, not a failure to report.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: {
            code: 'provider_failed',
            message: 'VEO could not reach the tutor. Check your connection and try again.',
          },
        }));
      } finally {
        if (inFlight.current === abort) inFlight.current = null;
      }
    },
    [controller, state.history, state.subjectId],
  );

  return { state, ask, reset } as const;
}

interface OkEnvelope {
  readonly ok: true;
  readonly response: TutorResponse;
}
interface ErrEnvelope {
  readonly ok: false;
  readonly error: TutorFailure;
}

function isEnvelope(value: unknown): value is OkEnvelope | ErrEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) return typeof record.response === 'object' && record.response !== null;
  if (record.ok === false) return typeof record.error === 'object' && record.error !== null;
  return false;
}
