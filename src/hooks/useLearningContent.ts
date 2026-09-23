'use client';

import { useCallback, useRef, useState } from 'react';
import type {
  ContentType,
  GenerationFailure,
  ValidatedFlashcard,
  ValidatedQuestion,
} from '@/ai/learning/learning-types';
import type {
  ContentSourceStatus,
  Difficulty,
  LearningObjectiveType,
} from '@/types/domain/learning';
import type { LearningLevel } from '@/types/domain/user';
import type { SemanticId } from '@/lib/semantic-id';

/**
 * Learning-content generation, from the browser.
 *
 * Owns the in-flight request and the returned batch. It owns NOTHING about how
 * the learner performs: no score, no streak, no history, no retention. Those
 * belong to the gates that build the recall experience and the memory model,
 * and putting even a counter here would be the first half of a scheduler
 * nobody designed.
 */

export type GenerationStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

export interface LearningContentState {
  readonly status: GenerationStatus;
  readonly contentType: ContentType | null;
  readonly questions: readonly ValidatedQuestion[];
  readonly flashcards: readonly ValidatedFlashcard[];
  readonly sourceStatus: ContentSourceStatus | null;
  readonly error: GenerationFailure | null;
  readonly subjectId: SemanticId | null;
}

const IDLE: LearningContentState = {
  status: 'idle',
  contentType: null,
  questions: [],
  flashcards: [],
  sourceStatus: null,
  error: null,
  subjectId: null,
};

export interface GenerateOptions {
  readonly semanticId: SemanticId;
  readonly modelRef: string;
  readonly contentType: ContentType;
  readonly objective: LearningObjectiveType;
  readonly difficulty: Difficulty;
  readonly educationLevel: LearningLevel;
  readonly count: number;
}

export function useLearningContent() {
  const [state, setState] = useState<LearningContentState>(IDLE);
  const inFlight = useRef<AbortController | null>(null);
  const lastRequest = useRef<GenerateOptions | null>(null);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    lastRequest.current = null;
    setState(IDLE);
  }, []);

  const generate = useCallback(async (options: GenerateOptions) => {
    inFlight.current?.abort();
    const abort = new AbortController();
    inFlight.current = abort;
    lastRequest.current = options;

    setState({
      ...IDLE,
      status: 'loading',
      contentType: options.contentType,
      subjectId: options.semanticId,
    });

    const endpoint =
      options.contentType === 'flashcard' ? '/api/ai/flashcards' : '/api/ai/questions';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          modelRef: options.modelRef,
          semanticId: options.semanticId,
          objective: options.objective,
          difficulty: options.difficulty,
          educationLevel: options.educationLevel,
          count: options.count,
        }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!isEnvelope(payload)) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: {
            code: 'provider_failed',
            message: "VEO couldn't generate that right now. Try again.",
          },
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

      const { questions, flashcards, sourceStatus } = payload.result;
      const empty = questions.length === 0 && flashcards.length === 0;

      setState({
        status: empty ? 'empty' : 'ready',
        contentType: options.contentType,
        questions,
        flashcards,
        sourceStatus,
        error: null,
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
          message: 'VEO could not reach the generator. Check your connection and try again.',
        },
      }));
    } finally {
      if (inFlight.current === abort) inFlight.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    const previous = lastRequest.current;
    if (previous) void generate(previous);
  }, [generate]);

  return { state, generate, retry, reset } as const;
}

interface OkEnvelope {
  readonly ok: true;
  readonly result: {
    readonly questions: readonly ValidatedQuestion[];
    readonly flashcards: readonly ValidatedFlashcard[];
    readonly sourceStatus: ContentSourceStatus;
  };
}
interface ErrEnvelope {
  readonly ok: false;
  readonly error: GenerationFailure;
}

function isEnvelope(value: unknown): value is OkEnvelope | ErrEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    const result = record.result as Record<string, unknown> | undefined;
    return (
      typeof result === 'object' &&
      result !== null &&
      Array.isArray(result.questions) &&
      Array.isArray(result.flashcards)
    );
  }
  if (record.ok === false) return typeof record.error === 'object' && record.error !== null;
  return false;
}
