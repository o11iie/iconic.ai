'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { ReviewSession } from './ReviewSession';
import { ActivityStrip, RecallStats, WeakestStructures } from './RecallStats';
import { browserTimeZone, duePhrase, type RecallData } from './recall-data';

/**
 * The recall surface.
 *
 * Two states: the dashboard, and a session. Everything shown is computed on
 * the server from persisted rows — this component fetches conclusions and
 * renders them. It does not derive a streak, a retention figure or a due list
 * of its own, because a browser that computed those could compute flattering
 * ones, and because two implementations of the same rule eventually disagree.
 */

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  | { readonly kind: 'ready'; readonly data: RecallData }
  | { readonly kind: 'reviewing'; readonly data: RecallData };

/**
 * Fetch the dashboard. Returns the phase rather than setting it, so the
 * caller decides whether its result is still wanted.
 */
async function fetchRecall(): Promise<Phase> {
  try {
    const response = await fetch(
      `/api/learning/queue?timeZone=${encodeURIComponent(browserTimeZone())}`,
      { cache: 'no-store' },
    );
    const body = await response.json();

    if (!response.ok || !body.ok) {
      return {
        kind: 'error',
        message: body?.error?.message ?? 'VEO could not load your review schedule just now.',
        // 401 and 503 are states to explain, not to retry into.
        retryable: response.status >= 500 && response.status !== 503,
      };
    }

    return { kind: 'ready', data: body as RecallData };
  } catch {
    return { kind: 'error', message: 'VEO could not reach the server.', retryable: true };
  }
}

export function RecallPanel() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  /**
   * Incremented on every load. A response whose token is stale is discarded.
   *
   * Without this, finishing a session while an earlier refresh is still in
   * flight can let the older response land last and show a dashboard from
   * before the reviews — the learner completes a session and watches their
   * streak fail to move.
   */
  const token = useRef(0);

  const load = useCallback(async () => {
    token.current += 1;
    const mine = token.current;

    const next = await fetchRecall();
    if (token.current === mine) setPhase(next);
  }, []);

  useEffect(() => {
    let current = true;

    void (async () => {
      const next = await fetchRecall();
      if (current) setPhase(next);
    })();

    return () => {
      current = false;
    };
  }, []);

  /**
   * Fresh data, fetched while the summary is on screen.
   *
   * The session must NOT be torn down when it ends. An earlier revision
   * refreshed the dashboard the moment the last item was rated, which
   * unmounted the review screen and replaced it with the dashboard — so the
   * "Session complete" summary existed and was unreachable, and a learner who
   * finished a session was simply thrown back to where they started with no
   * acknowledgement that they had done anything. Caught in the browser; no
   * unit test would have seen it, because both components were behaving
   * exactly as written.
   *
   * So finishing prefetches quietly, and the learner leaves when they choose.
   */
  const pending = useRef<Phase | null>(null);

  const finish = useCallback(async () => {
    pending.current = await fetchRecall();
  }, []);

  const exit = useCallback(() => {
    const ready = pending.current;
    pending.current = null;

    if (ready) {
      setPhase(ready);
      return;
    }

    setPhase({ kind: 'loading' });
    void load();
  }, [load]);

  if (phase.kind === 'loading') return <LoadingState label="Loading your review schedule" />;

  if (phase.kind === 'error') {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 p-10 text-center">
          <Icon name="alert" size={22} className="text-warn" />
          <p className="text-sm text-ink">{phase.message}</p>
          {phase.retryable ? (
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  const { data } = phase;

  if (phase.kind === 'reviewing') {
    return (
      <ReviewSession
        entries={data.queue}
        onFinished={() => void finish()}
        onExit={exit}
      />
    );
  }

  const due = data.counts.actionable;
  const next = duePhrase(data.nextDueAt, new Date());

  return (
    <div className="flex flex-col gap-5">
      <RecallStats data={data} />

      <Card>
        <CardHeader
          title="Today's review"
          description="Items VEO has decided are due, ordered by how close they are to being forgotten."
        />
        <CardBody className="flex flex-col gap-5">
          {due === 0 ? (
            <EmptyState
              title={
                data.progress.reviewsCompleted === 0
                  ? 'Nothing scheduled yet'
                  : 'You are caught up'
              }
              description={
                data.progress.reviewsCompleted === 0
                  ? 'Generate questions or flashcards while exploring a model, and add them to your schedule. VEO will bring each one back just before you are likely to forget it.'
                  : next
                    ? `Nothing is due right now. The next item comes back ${next}.`
                    : 'Nothing is due right now.'
              }
              icon={<Icon name="clock" size={22} />}
              action={
                data.progress.reviewsCompleted === 0 ? (
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    Refresh
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                {data.counts.learning > 0 ? <span>{data.counts.learning} learning</span> : null}
                {data.counts.overdue > 0 ? <span>{data.counts.overdue} overdue</span> : null}
                {data.counts.due > 0 ? <span>{data.counts.due} due</span> : null}
                {data.counts.new > 0 ? <span>{data.counts.new} new</span> : null}
              </div>

              <Button
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => setPhase({ kind: 'reviewing', data })}
              >
                <Icon name="quiz" size={18} />
                {data.activeSession ? 'Resume session' : `Review ${due} ${due === 1 ? 'item' : 'items'}`}
              </Button>

              {data.reviewable > 0 ? (
                <p className="text-xs text-ink-faint">
                  {data.reviewable} of these are tied to a structure you can open in 3D.
                </p>
              ) : null}
            </div>
          )}

          <ActivityStrip data={data} />
          <WeakestStructures data={data} />
        </CardBody>
      </Card>
    </div>
  );
}
