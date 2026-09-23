import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { percent, type RecallData } from './recall-data';

/**
 * TODAY, RETENTION, PROGRESS, STREAK.
 *
 * Every figure here comes from persisted review rows. None is derived from
 * anything the browser could have made up, and none has a placeholder: where
 * there is no data the card says so in words rather than showing a zero that
 * reads like a measurement.
 *
 * The distinction matters. "0% retention" on a new account is not neutral —
 * it is discouraging and false. "Not measured yet" is the truth.
 */

function Stat({
  label,
  value,
  caption,
  icon,
  tone = 'default',
  muted = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly icon: IconName;
  readonly tone?: 'default' | 'cyan' | 'warn';
  readonly muted?: boolean;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-ink-muted">
          <Icon name={icon} size={16} />
          <h3 className="text-xs font-semibold uppercase tracking-wide">{label}</h3>
        </div>
        <p
          className={cn(
            'text-3xl font-semibold tabular-nums leading-none',
            muted ? 'text-ink-faint' : tone === 'cyan' ? 'text-cyan' : 'text-ink',
          )}
        >
          {value}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">{caption}</p>
      </CardBody>
    </Card>
  );
}

export function RecallStats({ data }: { readonly data: RecallData }) {
  const { counts, goal, retention, progress, streak } = data;

  // ---- TODAY -------------------------------------------------------------
  const today = counts.actionable;
  const todayCaption =
    today === 0
      ? goal.completed > 0
        ? `${goal.completed} done — nothing else due`
        : 'Nothing due right now'
      : `${goal.completed} of ${goal.target} reviews done today`;

  // ---- RETENTION ---------------------------------------------------------
  //
  // Null until reviews exist. Shown as a dash with an explanation, never 0%.
  const measured = retention.overall !== null;
  const retentionCaption = measured
    ? `${retention.totalReviews} ${retention.totalReviews === 1 ? 'review' : 'reviews'} recorded` +
      (retention.recent !== null && retention.recentReviews < retention.totalReviews
        ? ` · ${percent(retention.recent)} recently`
        : '')
    : 'Not measured yet — answer some reviews';

  // ---- STREAK ------------------------------------------------------------
  const streakCaption =
    streak.current === 0
      ? streak.totalStudyDays > 0
        ? `Longest ${streak.longest} · review today to start again`
        : 'A day counts once you complete a review'
      : streak.studiedToday
        ? `Longest ${streak.longest} · today is counted`
        : 'Review today to keep it';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Today"
        value={String(today)}
        caption={todayCaption}
        icon="clock"
        tone={today > 0 ? 'cyan' : 'default'}
        muted={today === 0}
      />
      <Stat
        label="Retention"
        value={percent(retention.overall)}
        caption={retentionCaption}
        icon="check"
        muted={!measured}
      />
      <Stat
        label="Progress"
        value={String(progress.reviewsCompleted)}
        caption={
          progress.studyDays > 0
            ? `Across ${progress.studyDays} ${progress.studyDays === 1 ? 'day' : 'days'} of study`
            : 'No reviews completed yet'
        }
        icon="layers"
        muted={progress.reviewsCompleted === 0}
      />
      <Stat
        label="Streak"
        value={streak.current === 0 ? '—' : `${streak.current}`}
        caption={streakCaption}
        icon="sparkles"
        tone={streak.current > 0 ? 'cyan' : 'default'}
        muted={streak.current === 0}
      />
    </div>
  );
}

/**
 * The recent activity strip.
 *
 * Real counts per local day. A day with no reviews is drawn empty rather than
 * dimly filled, because a heat map that never shows nothing is decoration.
 */
export function ActivityStrip({ data }: { readonly data: RecallData }) {
  const max = data.activity.reduce((peak, day) => Math.max(peak, day.reviews), 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Last 28 days
        </h3>
        <p className="text-xs text-ink-faint">
          {max === 0 ? 'No reviews yet' : `Busiest day: ${max}`}
        </p>
      </div>
      <ol className="flex flex-wrap gap-1" aria-label="Reviews completed each of the last 28 days">
        {data.activity.map((day) => {
          const intensity = max === 0 ? 0 : day.reviews / max;
          return (
            <li
              key={day.date}
              className={cn(
                'size-4 rounded-sm border',
                day.reviews === 0
                  ? 'border-hairline bg-transparent'
                  : 'border-transparent bg-cyan',
              )}
              style={day.reviews === 0 ? undefined : { opacity: 0.35 + intensity * 0.65 }}
              title={`${day.date}: ${day.reviews} ${day.reviews === 1 ? 'review' : 'reviews'}`}
            >
              <span className="sr-only">{`${day.date}: ${day.reviews} reviews`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Weakest structures first.
 *
 * Labels are the semantic ids themselves. VEO will not invent a display name
 * for a structure: the name belongs to the loaded model, and making one up
 * here would be fabricating anatomy in a dashboard.
 */
export function WeakestStructures({ data }: { readonly data: RecallData }) {
  const structures = data.mastery.structures.filter((entry) => entry.reviewCount > 0).slice(0, 6);
  if (structures.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Needs the most work
      </h3>
      <ul className="flex flex-col gap-2">
        {structures.map((entry) => (
          <li key={entry.semanticId} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink" title={entry.semanticId}>
                {entry.semanticId.split('.').slice(2).join(' › ') || entry.semanticId}
              </p>
              <p className="text-xs text-ink-faint">
                {entry.itemCount} {entry.itemCount === 1 ? 'item' : 'items'} ·{' '}
                {entry.lapses} {entry.lapses === 1 ? 'lapse' : 'lapses'} · {entry.band}
              </p>
            </div>
            <div className="flex w-24 shrink-0 items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-hairline"
                role="img"
                aria-label={`${Math.round(entry.mastery * 100)} percent`}
              >
                <div
                  className="h-full rounded-full bg-cyan"
                  style={{ width: `${Math.round(entry.mastery * 100)}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                {Math.round(entry.mastery * 100)}%
              </span>
            </div>
            {entry.semanticId && data.queue.find((q) => q.semanticId === entry.semanticId)?.modelRef ? (
              <Link
                href={`/explore?model=${encodeURIComponent(
                  data.queue.find((q) => q.semanticId === entry.semanticId)!.modelRef!,
                )}&select=${encodeURIComponent(entry.semanticId)}`}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-cyan hover:bg-surface-raised"
              >
                View in 3D
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
