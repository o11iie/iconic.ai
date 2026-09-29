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

/**
 * What a learner is told when their progress cannot be read.
 *
 * Deliberately one quiet line rather than an error panel. Home exists to get
 * somebody reviewing, and an outage banner across the top of it would be both
 * alarming and useless — the rest of the page still works.
 *
 * But it is not nothing, which is what this used to render. A section that
 * silently disappears leaves the learner unable to tell a VEO outage from
 * having studied nothing, and it makes the page LOOK complete while a part of
 * it failed. That is the same fabrication as showing a zero: the honest
 * version says which it is, and offers the one action that can help.
 */
function ProgressUnavailable() {
  return (
    <p
      className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-2.5 text-xs text-ink-muted"
      role="status"
      data-veo-progress-unavailable
    >
      <Icon name="alert" size={14} className="shrink-0 text-ink-faint" />
      <span>
        VEO could not reach your learning record, so your progress is not shown here.
        Nothing has been lost —{' '}
        <Link href="/recall" className="text-cyan underline-offset-2 hover:underline">
          try again from Recall
        </Link>
        .
      </span>
    </p>
  );
}

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

        // Read but not claimed: an unreadable record produces the quiet
        // notice above, never an empty space that reads as "no progress yet".
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

  if (phase.kind === 'unavailable') return <ProgressUnavailable />;

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
