'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import {
  IDLE_SESSION,
  canRate,
  currentItem,
  progress,
  reduce,
  remaining,
} from '@/learning/session';
import type { QueuedItem } from '@/learning/queue';
import type { ReviewRating } from '@/learning/scheduler';
import {
  RATING_CHOICES,
  browserTimeZone,
  mintIdempotencyKey,
  payloadOptions,
  payloadText,
  type QueueEntry,
  type SessionItem,
} from './recall-data';

/**
 * The review screen.
 *
 * All session logic lives in the pure machine in `@/learning/session`; this
 * component renders whatever state it returns and dispatches events back. No
 * button's availability is decided by a conditional here — `canRate` decides,
 * once, for every control that needs to know.
 *
 * ## Idempotency
 *
 * A key is minted when an item is SHOWN and reused for every attempt to submit
 * that answer. A key minted at click time would be a new key per click, which
 * is precisely the double-submission the server's dedup exists to stop.
 */

interface Props {
  readonly entries: readonly QueueEntry[];
  readonly onFinished: () => void;
  readonly onExit: () => void;
}

/** Wrap a queue entry so the pure machine can carry it. */
function toQueued(entry: QueueEntry): QueuedItem {
  return {
    item: {
      id: entry.itemId as QueuedItem['item']['id'],
      contentId: entry.contentId,
      contentType: entry.contentType,
      semanticId: entry.semanticId as QueuedItem['item']['semanticId'],
      modelRef: entry.modelRef,
      // The review screen never schedules; the server does. A placeholder
      // state keeps the type honest without implying VEO knows more.
      state: {
        phase: entry.phase,
        stability: 0,
        difficulty: 0,
        repetitions: 0,
        lapses: 0,
        step: 0,
        intervalDays: 0,
        dueAt: new Date().toISOString(),
        lastReviewedAt: null,
      },
    },
    bucket: entry.bucket,
    overdueDays: entry.overdueDays,
  };
}

export function ReviewSession({ entries, onFinished, onExit }: Props) {
  const [state, dispatch] = useReducer(reduce, IDLE_SESSION);
  const [items, setItems] = useState<readonly SessionItem[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [lastDue, setLastDue] = useState<string | null>(null);

  /** One key per shown item, reused across retries. */
  const keyRef = useRef<string>('');
  const startedRef = useRef(false);

  const queued = useMemo(() => entries.map(toQueued), [entries]);
  const item = currentItem(state);
  const payload = useMemo(() => {
    if (!item) return null;
    return items.find((candidate) => candidate.itemId === item.item.id) ?? null;
  }, [item, items]);

  // ---- start ---------------------------------------------------------------

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    dispatch({ type: 'start', queue: queued });

    void (async () => {
      try {
        const response = await fetch('/api/learning/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemIds: entries.map((entry) => entry.itemId) }),
        });
        const body = await response.json();

        if (!response.ok || !body.ok) {
          dispatch({
            type: 'start_failed',
            message: body?.error?.message ?? 'VEO could not start that session.',
          });
          return;
        }

        setItems(body.items ?? []);
        keyRef.current = mintIdempotencyKey();
        dispatch({ type: 'started', sessionId: body.session.id, at: Date.now() });
      } catch {
        dispatch({ type: 'start_failed', message: 'VEO could not reach the server.' });
      }
    })();
  }, [entries, queued]);

  // ---- rate ----------------------------------------------------------------

  const submit = useCallback(
    async (rating: ReviewRating) => {
      if (!canRate(state) || !item) return;

      dispatch({ type: 'rate', rating });

      try {
        const response = await fetch('/api/learning/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            itemId: item.item.id,
            rating,
            correct: state.correct,
            responseMs: Math.max(0, Date.now() - (state.shownAt ?? Date.now())),
            sessionId: state.sessionId,
            // The SHOWN key, not a fresh one: a retry must be the same answer.
            idempotencyKey: keyRef.current,
            timeZone: browserTimeZone(),
          }),
        });
        const body = await response.json();

        if (!response.ok || !body.ok) {
          dispatch({
            type: 'rate_failed',
            message: body?.error?.message ?? 'VEO could not record that answer.',
          });
          return;
        }

        setLastDue(body.state?.dueAt ?? null);
        setRevealed(false);
        setTyped('');
        keyRef.current = mintIdempotencyKey();
        dispatch({ type: 'rated', at: Date.now() });
      } catch {
        dispatch({ type: 'rate_failed', message: 'VEO could not reach the server.' });
      }
    },
    [item, state],
  );

  // ---- end -----------------------------------------------------------------

  const endedRef = useRef(false);
  useEffect(() => {
    if (state.status !== 'completed' && state.status !== 'abandoned') return;
    if (endedRef.current || !state.sessionId) return;
    endedRef.current = true;

    void fetch('/api/learning/session', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        status: state.status === 'completed' ? 'completed' : 'abandoned',
      }),
    }).finally(onFinished);
  }, [state.status, state.sessionId, onFinished]);

  // ---- keyboard ------------------------------------------------------------
  //
  // 1–4 rate, space reveals. Never while typing, so an answer containing a
  // digit does not rate the card out from under the learner.

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === ' ' && state.status === 'active') {
        event.preventDefault();
        setRevealed(true);
        dispatch({ type: 'reveal' });
        return;
      }

      const choice = RATING_CHOICES.find((entry) => entry.key === event.key);
      if (choice && canRate(state)) {
        event.preventDefault();
        void submit(choice.rating);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, submit]);

  // ---- render --------------------------------------------------------------

  if (state.status === 'starting') {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 p-10 text-center">
          <span
            aria-hidden="true"
            className="size-6 animate-spin rounded-full border-2 border-hairline-strong border-t-cyan"
          />
          <p className="text-sm text-ink-muted" role="status">
            Starting your session…
          </p>
        </CardBody>
      </Card>
    );
  }

  if (state.status === 'idle' && state.error) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 p-10 text-center">
          <Icon name="alert" size={22} className="text-warn" />
          <p className="text-sm text-ink">{state.error}</p>
          <Button variant="secondary" size="sm" onClick={onExit}>
            Back to recall
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (state.status === 'completed' || state.status === 'abandoned') {
    const correct = state.answered.filter((entry) => entry.correct === true).length;
    const gradeable = state.answered.filter((entry) => entry.correct !== null).length;

    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-4 p-10 text-center">
          <Icon name="check" size={24} className="text-cyan" />
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-ink">
              {state.status === 'completed' ? 'Session complete' : 'Session ended'}
            </h2>
            <p className="text-sm text-ink-muted">
              {state.answered.length === 0
                ? 'Nothing was recorded.'
                : `${state.answered.length} ${
                    state.answered.length === 1 ? 'review' : 'reviews'
                  } recorded` +
                  (gradeable > 0 ? ` · ${correct} of ${gradeable} correct` : '')}
            </p>
          </div>
          <Button size="sm" onClick={onExit}>
            Back to recall
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (!item) return null;

  const prompt =
    payloadText(payload?.payload ?? {}, 'prompt', 'question', 'front', 'term') ??
    'This item has no prompt stored.';
  const answer = payloadText(payload?.payload ?? {}, 'answer', 'back', 'definition');
  const options = payloadOptions(payload?.payload ?? {});
  const isFlashcard = item.item.contentType === 'flashcard';
  const busy = state.status === 'rating';

  return (
    <div className="flex flex-col gap-4">
      {/* progress */}
      <div className="flex items-center gap-3">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-hairline"
          role="progressbar"
          aria-valuenow={state.index}
          aria-valuemin={0}
          aria-valuemax={state.queue.length}
          aria-label="Session progress"
        >
          <div
            className="h-full rounded-full bg-cyan transition-[width] duration-300"
            style={{ width: `${progress(state) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {remaining(state)} left
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: 'abandon' })}
          className="shrink-0"
        >
          End
        </Button>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-5 p-5 sm:p-6">
          {/* prompt */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-hairline bg-surface-raised px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-muted">
                {isFlashcard ? 'Flashcard' : 'Question'}
              </span>
              {item.bucket === 'overdue' ? (
                <span className="rounded-full border border-hairline bg-surface-raised px-2 py-0.5 text-[11px] uppercase tracking-wide text-warn">
                  Overdue
                </span>
              ) : null}
              {item.item.semanticId && item.item.modelRef ? (
                <Link
                  href={`/explore?model=${encodeURIComponent(
                    item.item.modelRef,
                  )}&select=${encodeURIComponent(item.item.semanticId)}`}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-cyan hover:bg-surface-raised"
                >
                  <Icon name="explore" size={14} />
                  View in 3D
                </Link>
              ) : null}
            </div>

            <h2 className="text-lg font-medium leading-relaxed text-ink">{prompt}</h2>
          </div>

          {/* answering */}
          {options.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {options.map((option) => {
                const chosen = typed === option;
                return (
                  <li key={option}>
                    <button
                      type="button"
                      disabled={busy || state.status !== 'active'}
                      onClick={() => {
                        setTyped(option);
                        setRevealed(true);
                        dispatch({
                          type: 'answer',
                          answer: option,
                          correct: answer === null ? null : option === answer,
                        });
                      }}
                      className={cn(
                        'w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                        'disabled:cursor-default',
                        chosen
                          ? 'border-cyan bg-surface-raised text-ink'
                          : 'border-hairline bg-transparent text-ink-muted hover:border-hairline-strong hover:text-ink',
                        revealed && answer === option ? 'border-cyan text-ink' : '',
                      )}
                    >
                      {option}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : isFlashcard || answer === null ? null : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="veo-review-answer">
                Your answer
              </label>
              <input
                id="veo-review-answer"
                value={typed}
                disabled={busy || state.status !== 'active'}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || state.status !== 'active') return;
                  setRevealed(true);
                  dispatch({
                    type: 'answer',
                    answer: typed,
                    correct: typed.trim().toLowerCase() === answer.trim().toLowerCase(),
                  });
                }}
                placeholder="Type what you remember"
                className="h-10 flex-1 rounded-lg border border-hairline bg-surface-raised px-3 text-sm text-ink placeholder:text-ink-faint"
              />
              <Button
                variant="secondary"
                size="md"
                disabled={state.status !== 'active'}
                onClick={() => {
                  setRevealed(true);
                  dispatch({
                    type: 'answer',
                    answer: typed,
                    correct: typed.trim().toLowerCase() === answer.trim().toLowerCase(),
                  });
                }}
              >
                Check
              </Button>
            </div>
          )}

          {/* reveal */}
          {state.status === 'active' && (isFlashcard || answer === null || options.length === 0) ? (
            <Button
              variant="secondary"
              onClick={() => {
                setRevealed(true);
                dispatch({ type: 'reveal' });
              }}
            >
              Show answer
              <span className="ml-1 text-xs text-ink-faint">Space</span>
            </Button>
          ) : null}

          {revealed && answer ? (
            <div className="rounded-lg border border-hairline bg-surface-raised p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Answer
              </p>
              <p className="text-sm leading-relaxed text-ink">{answer}</p>
              {state.correct !== null ? (
                <p
                  className={cn(
                    'mt-2 text-xs font-medium',
                    state.correct ? 'text-cyan' : 'text-warn',
                  )}
                >
                  {state.correct ? 'You had it.' : 'Not quite.'}
                </p>
              ) : null}
            </div>
          ) : null}

          {state.error ? (
            <p className="text-sm text-warn" role="alert">
              {state.error}
            </p>
          ) : null}

          {/* rating */}
          {canRate(state) || busy ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                How well did you recall it?
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {RATING_CHOICES.map((choice) => (
                  <button
                    key={choice.rating}
                    type="button"
                    disabled={!canRate(state)}
                    onClick={() => void submit(choice.rating)}
                    aria-label={`${choice.label} — ${choice.hint}`}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      'border-hairline bg-surface-raised hover:border-hairline-strong',
                      'disabled:opacity-50 disabled:hover:border-hairline',
                      state.pendingRating === choice.rating ? 'border-cyan' : '',
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-sm font-medium text-ink">
                      {choice.label}
                      <span aria-hidden="true" className="text-[11px] text-ink-faint">
                        {choice.key}
                      </span>
                    </span>
                    <span className="text-[11px] leading-tight text-ink-muted">{choice.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {lastDue ? (
        <p className="text-center text-xs text-ink-faint" role="status">
          Last card scheduled for {new Date(lastDue).toLocaleDateString()}
        </p>
      ) : null}
    </div>
  );
}
