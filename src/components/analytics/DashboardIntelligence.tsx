'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/states';
import type { AnalyticsOverview } from '@/analytics/contract';
import { AttentionPanel, RecommendationsPanel, TodayPanel, ZeroState } from './panels';
import { browserTimeZone, duration, percent } from './analytics-data';

/**
 * The dashboard's learning-intelligence section.
 *
 * Deliberately a subset of `/analytics`, not a second implementation of it:
 * the same panels, the same server response, fewer of them. Home answers
 * "what should I do next?"; the analytics page answers "how am I doing?". A
 * separate set of dashboard-only calculations would be a second chance for
 * the two pages to disagree about the same learner.
 *
 * Home always shows the 30-day window. A period filter belongs on the page
 * built for comparing windows, not on the one that exists to get a learner
 * reviewing.
 */

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly overview: AnalyticsOverview };

export function DashboardIntelligence() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/overview?period=30d&timeZone=${encodeURIComponent(browserTimeZone())}`,
          { cache: 'no-store' },
        );
        const body = await response.json();

        if (!current) return;

        // Home is not the place to explain an outage. If analytics cannot be
        // read, the rest of the dashboard still works and this section simply
        // does not claim anything.
        if (!response.ok || !body.ok) {
          setPhase({ kind: 'unavailable' });
          return;
        }

        setPhase({ kind: 'ready', overview: body.overview });
      } catch {
        if (current) setPhase({ kind: 'unavailable' });
      }
    })();

    return () => {
      current = false;
    };
  }, []);

  if (phase.kind === 'loading') {
    return <LoadingState label="Loading your progress" />;
  }

  if (phase.kind === 'unavailable') return null;

  const { overview } = phase;

  if (!overview.hasData) return <ZeroState />;

  return (
    <div className="flex flex-col gap-4" data-veo-dashboard-intelligence>
      <TodayPanel overview={overview} />

      <div className="grid gap-4 lg:grid-cols-2">
        <RecommendationsPanel overview={overview} compact />
        <AttentionPanel overview={overview} />
      </div>

      <Card>
        <CardHeader
          title="This month"
          description="Retention, mastery and effort over the last 30 days."
          action={
            <Link
              href="/analytics"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-cyan hover:bg-surface-raised"
            >
              Full analytics
              <Icon name="arrowRight" size={13} />
            </Link>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Retention</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink">
                {percent(overview.retention.overall)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Mastery</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink">
                {percent(overview.mastery.overall)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Reviews</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink">
                {overview.activity.reviews}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Study time</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink">
                {duration(overview.activity.studySeconds)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
