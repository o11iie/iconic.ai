'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import {
  ANALYTICS_PERIODS,
  PERIOD_LABELS,
  type AnalyticsOverview,
  type AnalyticsPeriod,
  type KnowledgeMap,
  type SessionAnalytics,
} from '@/analytics/contract';
import {
  ActivityPanel,
  AttentionPanel,
  KnowledgeMapPanel,
  MasteryPanel,
  RecommendationsPanel,
  RetentionPanel,
  SessionsPanel,
  TodayPanel,
  ZeroState,
} from './panels';
import { browserTimeZone } from './analytics-data';

/**
 * The analytics surface.
 *
 * One fetch per period change, and every figure comes back computed. The
 * client's only job is rendering and picking a window — it derives no metric
 * of its own, so the numbers here are necessarily the numbers the engine
 * produced and the numbers the tests assert.
 *
 * ## The period filter
 *
 * Applied consistently. Panels whose figures are period-scoped say which
 * window they used; mastery is a property of an item's current state and has
 * no "last 7 days" version, so it says so rather than implying one.
 */

interface Payload {
  readonly overview: AnalyticsOverview;
  readonly knowledgeMap: KnowledgeMap;
  readonly sessions: readonly SessionAnalytics[];
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  | { readonly kind: 'ready'; readonly data: Payload };

async function fetchAnalytics(period: AnalyticsPeriod): Promise<Phase> {
  const query = `?period=${period}&timeZone=${encodeURIComponent(browserTimeZone())}`;

  try {
    const [overviewRes, mapRes, sessionsRes] = await Promise.all([
      fetch(`/api/analytics/overview${query}`, { cache: 'no-store' }),
      fetch(`/api/analytics/knowledge-map${query}`, { cache: 'no-store' }),
      fetch(`/api/analytics/sessions${query}`, { cache: 'no-store' }),
    ]);

    const [overview, map, sessions] = await Promise.all([
      overviewRes.json(),
      mapRes.json(),
      sessionsRes.json(),
    ]);

    if (!overviewRes.ok || !overview.ok) {
      return {
        kind: 'error',
        message: overview?.error?.message ?? 'VEO could not load your analytics just now.',
        // 401 and 503 are states to explain, not to retry into.
        retryable: overviewRes.status >= 500 && overviewRes.status !== 503,
      };
    }

    return {
      kind: 'ready',
      data: {
        overview: overview.overview,
        knowledgeMap: map?.knowledgeMap ?? { roots: [], totalStructures: 0, totalItems: 0, unplacedItems: 0 },
        sessions: sessions?.sessions ?? [],
      },
    };
  } catch {
    return { kind: 'error', message: 'VEO could not reach the server.', retryable: true };
  }
}

export function AnalyticsView() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  /**
   * Incremented per load, so a slow response for an old period cannot land
   * after a fast one for the new period and show figures the filter no longer
   * says are on screen.
   */
  const token = useRef(0);

  const load = useCallback(async (next: AnalyticsPeriod) => {
    token.current += 1;
    const mine = token.current;

    const result = await fetchAnalytics(next);
    if (token.current === mine) setPhase(result);
  }, []);

  useEffect(() => {
    let current = true;

    void (async () => {
      const result = await fetchAnalytics('30d');
      if (current) setPhase(result);
    })();

    return () => {
      current = false;
    };
  }, []);

  const choose = useCallback(
    (next: AnalyticsPeriod) => {
      setPeriod(next);
      setPhase({ kind: 'loading' });
      void load(next);
    },
    [load],
  );

  return (
    <div className="flex flex-col gap-5" data-veo-analytics>
      {/* Filters in one row above the charts. */}
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Time period"
      >
        {ANALYTICS_PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            aria-pressed={period === option}
            data-veo-period={option}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              period === option
                ? 'border-cyan bg-surface-raised text-ink'
                : 'border-hairline bg-transparent text-ink-muted hover:border-hairline-strong hover:text-ink',
            )}
          >
            {PERIOD_LABELS[option]}
          </button>
        ))}
      </div>

      {phase.kind === 'loading' ? <LoadingState label="Loading your analytics" /> : null}

      {phase.kind === 'error' ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 p-10 text-center">
            <Icon name="alert" size={22} className="text-warning" />
            <p className="text-sm text-ink">{phase.message}</p>
            {phase.retryable ? (
              <Button variant="secondary" size="sm" onClick={() => void load(period)}>
                Try again
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {phase.kind === 'ready' ? (
        <>
          <TodayPanel overview={phase.data.overview} />

          {phase.data.overview.hasData ? (
            <>
              <RecommendationsPanel overview={phase.data.overview} />
              <div className="grid gap-4 xl:grid-cols-2">
                <RetentionPanel overview={phase.data.overview} />
                <MasteryPanel overview={phase.data.overview} />
              </div>
              <ActivityPanel overview={phase.data.overview} />
              <div className="grid gap-4 xl:grid-cols-2">
                <AttentionPanel overview={phase.data.overview} />
                <KnowledgeMapPanel map={phase.data.knowledgeMap} />
              </div>
              <SessionsPanel sessions={phase.data.sessions} />

              {/* Surfaced rather than hidden: if analytics refused to count
                  records, something upstream is wrong and somebody needs to
                  know. A filter whose output is indistinguishable from "less
                  data" hides bugs. */}
              {phase.data.overview.integrity.reviewsExcluded > 0 ||
              phase.data.overview.integrity.itemsExcluded > 0 ? (
                <p className="text-[11px] text-ink-faint" role="status">
                  {phase.data.overview.integrity.reviewsExcluded} reviews and{' '}
                  {phase.data.overview.integrity.itemsExcluded} items could not be read and were
                  left out of every figure above.
                </p>
              ) : null}
            </>
          ) : (
            <ZeroState />
          )}
        </>
      ) : null}
    </div>
  );
}
