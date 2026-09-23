'use client';

import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type {
  AnalyticsOverview,
  AttentionItem,
  KnowledgeMapNode,
  LearningRecommendation,
  SessionAnalytics,
  StrengthItem,
} from '@/analytics/contract';
import { BandTag, Meter, TrendColumns, TrendLine } from './charts';
import { changeLabel, duration, exploreHref, percent, structureName } from './analytics-data';

/**
 * The analytics panels.
 *
 * Every figure rendered here came from the server, computed from persisted
 * review events. Nothing is derived in the browser, because a client that
 * computed its own retention could compute a flattering one — and two
 * implementations of one rule eventually disagree about the same learner.
 *
 * Where a value is null the panel says what is missing, in words. "—" with an
 * explanation is honest; 0% is a measurement, and on a new account it is a
 * false one in the discouraging direction.
 */

// ---------------------------------------------------------------------------
// Stat tiles
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  caption,
  muted = false,
  accent = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly muted?: boolean;
  readonly accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-hairline bg-surface-raised p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</h3>
      <p
        className={cn(
          'text-2xl font-semibold leading-none tabular-nums sm:text-3xl',
          muted ? 'text-ink-faint' : accent ? 'text-cyan' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="text-xs leading-relaxed text-ink-muted">{caption}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export function TodayPanel({ overview }: { readonly overview: AnalyticsOverview }) {
  const { today } = overview;

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatTile
        label="Due now"
        value={String(today.dueNow)}
        caption={
          today.dueNow === 0
            ? today.nextDueAt
              ? 'Caught up — nothing waiting'
              : 'Nothing scheduled yet'
            : `${today.overdue} overdue`
        }
        muted={today.dueNow === 0}
        accent={today.dueNow > 0}
      />
      <StatTile
        label="Today"
        value={String(today.reviewsCompleted)}
        caption={`of a ${today.goalTarget} review goal${today.goalMet ? ' — met' : ''}`}
        muted={today.reviewsCompleted === 0}
      />
      <StatTile
        label="Streak"
        value={today.streakCurrent === 0 ? '—' : String(today.streakCurrent)}
        caption={
          today.streakCurrent === 0
            ? 'A day counts once you complete a review'
            : today.studiedToday
              ? `Longest ${today.streakLongest} · today counted`
              : 'Review today to keep it'
        }
        muted={today.streakCurrent === 0}
        accent={today.streakCurrent > 0}
      />
      <StatTile
        label="Retention"
        value={percent(overview.retention.overall)}
        caption={
          overview.retention.overall === null
            ? 'Not measured yet'
            : `${overview.retention.totalReviews} reviews in ${overview.window.label.toLowerCase()}`
        }
        muted={overview.retention.overall === null}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export function RetentionPanel({ overview }: { readonly overview: AnalyticsOverview }) {
  const { retention } = overview;
  const change = changeLabel(retention.change);

  return (
    <Card>
      <CardHeader
        title="Retention"
        description="How often you recalled what VEO showed you. Every rating but Again counts as recall."
      />
      <CardBody className="flex flex-col gap-4">
        {retention.overall === null ? (
          <p className="text-sm text-ink-muted">
            Nothing measured in {retention.window.label.toLowerCase()}. Complete some reviews and
            this fills in.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="text-3xl font-semibold tabular-nums text-ink">
                  {percent(retention.overall)}
                </p>
                <p className="text-xs text-ink-muted">
                  across {retention.totalReviews} reviews
                </p>
              </div>
              <div>
                <p className="text-lg font-medium tabular-nums text-ink">
                  {percent(retention.recent)}
                </p>
                <p className="text-xs text-ink-muted">
                  most recent {retention.recentSampleSize}
                </p>
              </div>
              {change ? (
                <div>
                  <p
                    className={cn(
                      'text-lg font-medium tabular-nums',
                      (retention.change ?? 0) < 0 ? 'text-warning' : 'text-ink',
                    )}
                  >
                    {change}
                  </p>
                  <p className="text-xs text-ink-muted">recent half vs earlier half</p>
                </div>
              ) : null}
            </div>

            <TrendLine
              points={retention.trend}
              label="Retention"
              format={(value) => `${Math.round(value * 100)}%`}
              max={1}
            />
          </>
        )}

        {retention.byStructure.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              By structure, weakest first
            </h4>
            <ul className="flex flex-col gap-2">
              {retention.byStructure.slice(0, 8).map((entry) => (
                <li key={entry.semanticId} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink" title={entry.semanticId}>
                      {structureName(entry.semanticId)}
                    </p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {entry.reviews} reviews · {entry.lapses} lapses
                    </p>
                  </div>
                  <Meter value={entry.retention} label={structureName(entry.semanticId)} className="w-28 shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mastery
// ---------------------------------------------------------------------------

export function MasteryPanel({ overview }: { readonly overview: AnalyticsOverview }) {
  const { mastery } = overview;

  return (
    <Card>
      <CardHeader
        title="Mastery"
        description="How likely you are to recall each structure right now. It decays between reviews, so it reports knowledge rather than history."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Overall"
            value={percent(mastery.overall)}
            caption={
              mastery.overall === null
                ? 'Nothing studied yet'
                : `${mastery.structuresTracked} structures tracked`
            }
            muted={mastery.overall === null}
          />
          <StatTile label="Strong" value={String(mastery.mastered)} caption="At or above the strong threshold" muted={mastery.mastered === 0} />
          <StatTile label="Developing" value={String(mastery.inProgress)} caption="Partly known" muted={mastery.inProgress === 0} />
          <StatTile label="Needs work" value={String(mastery.needsAttention)} caption="Below the struggling threshold" muted={mastery.needsAttention === 0} />
        </div>

        {mastery.untouched > 0 ? (
          <p className="text-xs text-ink-faint">
            {mastery.untouched} {mastery.untouched === 1 ? 'structure has' : 'structures have'} not
            been studied yet — not counted as weak, because nothing has been measured.
          </p>
        ) : null}

        {mastery.structures.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {mastery.structures.slice(0, 10).map((view) => (
              <li key={view.semanticId} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink" title={view.semanticId}>
                    {structureName(view.semanticId)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <BandTag band={view.band} />
                    <span className="text-[11px] text-ink-faint">
                      {view.itemCount} {view.itemCount === 1 ? 'item' : 'items'} · {view.reviewCount} reviews
                    </span>
                  </div>
                </div>
                <Meter
                  value={view.mastery}
                  band={view.band}
                  label={structureName(view.semanticId)}
                  className="w-28 shrink-0"
                />
                {view.modelRef ? (
                  <Link
                    href={exploreHref(view.modelRef, view.semanticId)}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] text-cyan hover:bg-surface-raised"
                  >
                    View in 3D
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function ActivityPanel({ overview }: { readonly overview: AnalyticsOverview }) {
  const { activity, velocity } = overview;

  return (
    <Card>
      <CardHeader
        title="Activity"
        description="What you did. Effort, not achievement — a hundred flashcards completed is a hundred flashcards completed."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Reviews" value={String(activity.reviews)} caption={`${activity.questionsAnswered} questions · ${activity.flashcardsReviewed} flashcards`} muted={activity.reviews === 0} />
          <StatTile label="Study time" value={duration(activity.studySeconds)} caption="Summed from time spent answering" muted={activity.studySeconds === 0} />
          <StatTile
            label="Active days"
            value={String(activity.activeDays)}
            caption={
              activity.consistency === null
                ? 'Days with a completed review'
                : `${Math.round(activity.consistency * 100)}% of ${activity.window.label.toLowerCase()}`
            }
            muted={activity.activeDays === 0}
          />
          <StatTile
            label="Sessions"
            value={String(activity.sessions)}
            caption={
              activity.sessions === 0
                ? 'No sessions yet'
                : `${activity.completedSessions} completed · ${activity.abandonedSessions} left early`
            }
            muted={activity.sessions === 0}
          />
        </div>

        <div className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Reviews per {activity.granularity}
          </h4>
          <TrendColumns
            points={activity.reviewsPerDay}
            label="Reviews"
            format={(value) => `${Math.round(value)} reviews`}
          />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Structures seen</dt>
            <dd className="tabular-nums text-ink">{velocity.structuresEncountered}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Reviews per active day</dt>
            <dd className="tabular-nums text-ink">
              {velocity.reviewsPerActiveDay === null ? '—' : velocity.reviewsPerActiveDay.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Typical answer</dt>
            <dd className="tabular-nums text-ink">{duration(velocity.secondsPerReview)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Typical session</dt>
            <dd className="tabular-nums text-ink">{duration(activity.medianSessionSeconds)}</dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

const REASON_TEXT: Record<AttentionItem['reasons'][number], string> = {
  repeated_failures: 'repeated failures',
  high_lapse_rate: 'forgotten repeatedly',
  low_mastery: 'low mastery',
  declining_recall: 'recall has declined',
  long_overdue: 'long overdue',
};

export function AttentionPanel({ overview }: { readonly overview: AnalyticsOverview }) {
  const { attention, decay, strengths } = overview;

  return (
    <Card>
      <CardHeader
        title="Needs attention"
        description="Flagged from your review history, with the evidence behind each. Nothing here comes from one bad answer."
      />
      <CardBody className="flex flex-col gap-5">
        {attention.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing is flagged. VEO needs a few reviews of a structure before it will say anything
            about it, so this stays empty until there is evidence either way.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {attention.map((flagged) => (
              <li
                key={flagged.semanticId}
                className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface-raised p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink" title={flagged.semanticId}>
                    {structureName(flagged.semanticId)}
                  </p>
                  {flagged.modelRef ? (
                    <Link
                      href={exploreHref(flagged.modelRef, flagged.semanticId)}
                      className="text-[11px] text-cyan hover:underline"
                    >
                      View in 3D
                    </Link>
                  ) : null}
                </div>

                <p className="text-xs text-ink-muted">
                  {flagged.reasons.map((reason) => REASON_TEXT[reason]).join(' · ')}
                </p>

                {/* The evidence, in full. "VEO thinks you're weak here" is not
                    a finding; these numbers are, and every one is reproducible
                    from the learner's own events. */}
                <p className="text-[11px] tabular-nums text-ink-faint">
                  {flagged.evidence.reviews} reviews · {flagged.evidence.lapses} lapses ·{' '}
                  recall {percent(flagged.evidence.retention)} · mastery {percent(flagged.evidence.mastery)}
                  {flagged.evidence.overdueDays !== null
                    ? ` · ${Math.round(flagged.evidence.overdueDays)} days overdue`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}

        {decay.filter((signal) => signal.direction === 'declining').length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Recall has changed
            </h4>
            <ul className="flex flex-col gap-1.5">
              {decay
                .filter((signal) => signal.direction === 'declining')
                .slice(0, 5)
                .map((signal) => (
                  <li key={signal.semanticId} className="text-xs text-ink-muted">
                    <span className="text-ink">{structureName(signal.semanticId)}</span>{' '}
                    — recent recall {percent(signal.recentRetention)}, earlier{' '}
                    {percent(signal.earlierRetention)}{' '}
                    <span className="text-ink-faint">
                      ({signal.recentSampleSize} vs {signal.earlierSampleSize} reviews)
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        {strengths.length > 0 ? <StrengthsList strengths={strengths} /> : null}
      </CardBody>
    </Card>
  );
}

function StrengthsList({ strengths }: { readonly strengths: readonly StrengthItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Going well
      </h4>
      <ul className="flex flex-col gap-1.5">
        {strengths.slice(0, 5).map((strength) => (
          <li key={strength.semanticId} className="text-xs text-ink-muted">
            <span className="text-ink">{structureName(strength.semanticId)}</span> — mastery{' '}
            {percent(strength.mastery)}, recall {percent(strength.retention)} across{' '}
            {strength.reviews} reviews
            {strength.consecutiveSuccesses > 1
              ? `, ${strength.consecutiveSuccesses} in a row`
              : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export function RecommendationsPanel({
  overview,
  compact = false,
}: {
  readonly overview: AnalyticsOverview;
  readonly compact?: boolean;
}) {
  const { recommendations } = overview;

  return (
    <Card>
      <CardHeader
        title="Study next"
        description="Ranked from what is due and what your reviews show. Each says why."
      />
      <CardBody className="flex flex-col gap-3">
        {recommendations.recommendations.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              {recommendations.sufficientData
                ? 'Nothing to suggest right now — you are caught up.'
                : 'Not enough learning data yet. Generate some questions while exploring a model and add them to your schedule.'}
            </p>
            {!recommendations.sufficientData ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/explore"
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-strong"
                >
                  Explore a model
                </Link>
                <Link
                  href="/recall"
                  className="rounded-lg border border-hairline-strong bg-surface-raised px-3 py-2 text-xs font-medium text-ink hover:bg-surface-overlay"
                >
                  Build your review queue
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recommendations.recommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.id}
                recommendation={recommendation}
                compact={compact}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RecommendationRow({
  recommendation,
  compact,
}: {
  readonly recommendation: LearningRecommendation;
  readonly compact: boolean;
}) {
  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface-raised p-3"
      data-veo-recommendation={recommendation.kind}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">{recommendation.title}</p>
        <span className="text-[11px] uppercase tracking-wide text-ink-faint">
          {recommendation.itemCount} {recommendation.itemCount === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* The reason is not decoration: it is the evidence read aloud, so a
          learner can always ask "why this?" and get a checkable answer. */}
      <p className="text-xs leading-relaxed text-ink-muted">{recommendation.reason}</p>

      {!compact ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href="/recall"
            className="rounded-md border border-hairline-strong bg-surface-overlay px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-surface-raised"
          >
            Review these
          </Link>
          {/* Only offered when the model can actually be opened. With Gate 9
              RED that is never, and a button that failed would be worse than
              no button. */}
          {recommendation.canViewInModel && recommendation.modelRef && recommendation.semanticId ? (
            <Link
              href={exploreHref(recommendation.modelRef, recommendation.semanticId)}
              className="rounded-md px-2.5 py-1 text-[11px] text-cyan hover:bg-surface-overlay"
            >
              View in 3D
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Knowledge map
// ---------------------------------------------------------------------------

export function KnowledgeMapPanel({
  map,
}: {
  readonly map: { readonly roots: readonly KnowledgeMapNode[]; readonly unplacedItems: number; readonly totalStructures: number };
}) {
  return (
    <Card>
      <CardHeader
        title="Knowledge map"
        description="Your material, grouped the way its identifiers are. Mastery rolls up from the structures beneath each branch."
      />
      <CardBody className="flex flex-col gap-3">
        {map.roots.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing to map yet. Structures appear here once you have study material about them.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {map.roots.map((node) => (
              <MapNode key={node.semanticId} node={node} level={0} />
            ))}
          </ul>
        )}

        {map.unplacedItems > 0 ? (
          <p className="text-[11px] text-ink-faint">
            {map.unplacedItems} {map.unplacedItems === 1 ? 'item is' : 'items are'} not tied to a
            structure, so {map.unplacedItems === 1 ? 'it does' : 'they do'} not appear above. They
            are still scheduled and still counted in your reviews.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function MapNode({ node, level }: { readonly node: KnowledgeMapNode; readonly level: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md py-1.5"
        style={{ paddingLeft: `${level * 14}px` }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink" title={node.semanticId}>
            {structureName(node.semanticId)}
          </p>
          <div className="flex flex-wrap items-center gap-x-2">
            <BandTag band={node.band} />
            <span className="text-[11px] text-ink-faint">
              {node.itemCount} {node.itemCount === 1 ? 'item' : 'items'}
              {node.reviewCount > 0 ? ` · recall ${percent(node.retention)}` : ''}
              {node.dueNow > 0 ? ` · ${node.dueNow} due` : ''}
            </span>
          </div>
        </div>

        <Meter value={node.mastery} band={node.band} label={structureName(node.semanticId)} className="w-24 shrink-0" />

        {node.canViewInModel && node.modelRef ? (
          <Link
            href={exploreHref(node.modelRef, node.semanticId)}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-cyan hover:bg-surface-raised"
          >
            3D
          </Link>
        ) : null}
      </div>

      {node.children.length > 0 ? (
        <ul className="flex flex-col">
          {node.children.map((child) => (
            <MapNode key={child.semanticId} node={child} level={level + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function SessionsPanel({ sessions }: { readonly sessions: readonly SessionAnalytics[] }) {
  return (
    <Card>
      <CardHeader
        title="Recent sessions"
        description="Measured from the reviews each session actually recorded."
      />
      <CardBody>
        {sessions.length === 0 ? (
          <p className="text-sm text-ink-muted">No sessions in this period.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead className="text-ink-muted">
                <tr>
                  <th scope="col" className="px-1 py-2 font-medium">Started</th>
                  <th scope="col" className="px-1 py-2 font-medium">Items</th>
                  <th scope="col" className="px-1 py-2 font-medium">Recall</th>
                  <th scope="col" className="px-1 py-2 font-medium">Time</th>
                  <th scope="col" className="px-1 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.sessionId} className="border-t border-hairline">
                    <td className="px-1 py-2 text-ink">
                      {new Date(session.startedAt).toLocaleDateString()}
                    </td>
                    <td className="px-1 py-2 tabular-nums text-ink-muted">
                      {session.itemsAttempted} of {session.itemsPlanned}
                    </td>
                    <td className="px-1 py-2 tabular-nums text-ink-muted">
                      {percent(session.retention)}
                    </td>
                    <td className="px-1 py-2 tabular-nums text-ink-muted">
                      {duration(session.durationSeconds)}
                    </td>
                    <td className="px-1 py-2 text-ink-muted">{session.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zero state
// ---------------------------------------------------------------------------

/**
 * What a learner with no history sees.
 *
 * Calls to action, not statistics. Showing "0% retention" on a new account is
 * both false and discouraging: nothing has been measured, and the honest thing
 * is to say what would start measuring it.
 */
export function ZeroState() {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-4 p-10 text-center">
        <Icon name="insights" size={24} className="text-ink-faint" />
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">No learning data yet</h2>
          <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
            VEO builds this from reviews you actually complete — what you recalled, what you
            forgot, and when. Until then there is nothing to report, and it will not invent
            anything.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/explore"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Explore in 3D
          </Link>
          <Link
            href="/recall"
            className="rounded-lg border border-hairline-strong bg-surface-raised px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-overlay"
          >
            Build your review queue
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
