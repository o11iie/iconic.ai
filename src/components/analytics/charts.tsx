'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import type { MasteryBand, TrendPoint } from '@/analytics/contract';

/**
 * VEO's chart primitives.
 *
 * ## The palette
 *
 * One hue for single-series data (VEO's cyan), and the reserved status palette
 * for mastery bands — which genuinely mean good/bad, which is the only thing
 * status colour may encode. Both were run through the colour validator against
 * VEO's dark chart surface rather than eyeballed:
 *
 *   struggling / developing / strong  ΔE 10.6 (protan), 21.2 normal — pass
 *   untouched  #64748b                contrast 3:1 against the surface — pass
 *
 * `untouched` is deliberately grey: it means "no evidence", not "bad", and a
 * colour that read as bad would tell a learner they are failing at something
 * they have never been shown. The band colour is never the only signal — every
 * band ships with its name in text, so the chart is readable with no colour
 * vision at all.
 *
 * Cyan and the strong-green are never used as distinct series in one chart:
 * they sit at ΔE 12.1, which is below the normal-vision floor, so a reader
 * with full colour vision could not reliably tell them apart.
 *
 * ## The rule these all obey
 *
 * A bucket with no data is drawn as a GAP, not as zero. A day the learner did
 * not study is not a day they scored nothing, and a line that dives to the
 * axis on an untouched Sunday invents a catastrophe.
 */

export const BAND_COLOR: Record<MasteryBand, string> = {
  untouched: '#64748b',
  struggling: '#f87171',
  developing: '#fbbf24',
  strong: '#34d399',
};

export const BAND_LABEL: Record<MasteryBand, string> = {
  untouched: 'Not yet studied',
  struggling: 'Needs work',
  developing: 'Developing',
  strong: 'Strong',
};

const CYAN = '#22d3ee';

// ---------------------------------------------------------------------------
// Trend line
// ---------------------------------------------------------------------------

interface TrendProps {
  readonly points: readonly TrendPoint[];
  readonly label: string;
  /** Render the value for a tooltip and the accessible table. */
  readonly format: (value: number) => string;
  /** Fixed upper bound, for rates. Omit to scale to the data. */
  readonly max?: number;
  readonly className?: string;
}

/**
 * A single-series trend.
 *
 * No legend: with one series the title names it, and a legend box would be
 * furniture. Gaps are real breaks in the path rather than interpolated,
 * because joining across a week of no data draws a trend that never happened.
 */
export function TrendLine({ points, label, format, max, className }: TrendProps) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const measured = points.filter((point) => point.value !== null);
  if (measured.length === 0) {
    return (
      <div
        className={cn(
          'flex h-32 items-center justify-center rounded-lg border border-dashed border-hairline',
          className,
        )}
      >
        <p className="text-xs text-ink-faint">Not enough data to chart yet</p>
      </div>
    );
  }

  const width = 100;
  const height = 32;
  const ceiling =
    max ?? Math.max(...measured.map((point) => point.value ?? 0), 1);

  const x = (index: number) =>
    points.length <= 1 ? width / 2 : (index / (points.length - 1)) * width;
  const y = (value: number) => height - (value / ceiling) * height;

  // Broken into segments at every gap, so no line is drawn across a period
  // the learner did not study.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const active = hover === null ? null : points[hover];

  return (
    <figure className={cn('flex flex-col gap-1', className)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-32 w-full"
          role="img"
          aria-labelledby={titleId}
          data-veo-chart="trend-line"
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>{label}</title>

          {/* Recessive baseline. */}
          <line
            x1="0" y1={height} x2={width} y2={height}
            stroke="var(--color-hairline)" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
          />

          {segments.map((segment, index) => (
            <path
              key={index}
              d={segment}
              fill="none"
              stroke={CYAN}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Measured points, so a single review is visible as a dot rather
              than an invisible zero-length segment. */}
          {points.map((point, index) =>
            point.value === null ? null : (
              <circle
                key={point.date}
                cx={x(index)}
                cy={y(point.value)}
                r={hover === index ? 3 : 1.6}
                fill={CYAN}
                stroke="var(--color-surface-raised)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}

          {/* Hit targets, wider than the marks. */}
          {points.map((point, index) => (
            <rect
              key={`hit-${point.date}`}
              x={x(index) - width / points.length / 2}
              y={0}
              width={width / points.length}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border border-hairline-strong bg-surface-overlay px-2 py-1 text-[11px] text-ink shadow-lg"
            role="status"
          >
            {active.date} ·{' '}
            {active.value === null ? 'no reviews' : format(active.value)}
          </div>
        ) : null}
      </div>

      {/* The accessible table. Identity is never colour-alone. */}
      <details className="text-xs text-ink-faint">
        <summary className="cursor-pointer select-none">View as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-ink-muted">
              <th scope="col" className="py-1 font-medium">Date</th>
              <th scope="col" className="py-1 font-medium">{label}</th>
              <th scope="col" className="py-1 font-medium">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date} className="border-t border-hairline">
                <td className="py-1">{point.date}</td>
                <td className="py-1 tabular-nums">
                  {point.value === null ? '—' : format(point.value)}
                </td>
                <td className="py-1 tabular-nums">{point.sampleSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Column chart
// ---------------------------------------------------------------------------

/**
 * Counts per bucket.
 *
 * Unlike a rate, a COUNT of zero is a fact — the learner did no reviews that
 * day — so empty buckets are drawn as an empty track rather than skipped.
 */
export function TrendColumns({
  points,
  label,
  format,
  className,
}: Omit<TrendProps, 'max'>) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const peak = Math.max(...points.map((point) => point.value ?? 0), 1);
  const active = hover === null ? null : points[hover];

  return (
    <figure className={cn('flex flex-col gap-1', className)}>
      <div className="relative">
        <div
          className="flex h-32 items-end gap-[2px]"
          role="img"
          aria-labelledby={titleId}
          data-veo-chart="trend-columns"
          onMouseLeave={() => setHover(null)}
        >
          <span id={titleId} className="sr-only">{label}</span>

          {points.map((point, index) => {
            const value = point.value ?? 0;
            return (
              <div
                key={point.date}
                className="flex h-full flex-1 cursor-default items-end"
                onMouseEnter={() => setHover(index)}
              >
                <div
                  className={cn(
                    'w-full rounded-t-[4px] transition-colors',
                    value === 0 ? 'bg-hairline' : 'bg-cyan',
                    hover === index ? 'opacity-100' : 'opacity-90',
                  )}
                  style={{
                    // A zero bar keeps a 2px stub so the day is visible as a
                    // day with nothing in it, rather than as absent.
                    height: value === 0 ? '2px' : `${Math.max(4, (value / peak) * 100)}%`,
                  }}
                />
              </div>
            );
          })}
        </div>

        {active ? (
          <div
            className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border border-hairline-strong bg-surface-overlay px-2 py-1 text-[11px] text-ink shadow-lg"
            role="status"
          >
            {active.date} · {format(active.value ?? 0)}
          </div>
        ) : null}
      </div>

      <details className="text-xs text-ink-faint">
        <summary className="cursor-pointer select-none">View as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-ink-muted">
              <th scope="col" className="py-1 font-medium">Date</th>
              <th scope="col" className="py-1 font-medium">{label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date} className="border-t border-hairline">
                <td className="py-1">{point.date}</td>
                <td className="py-1 tabular-nums">{format(point.value ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

/**
 * One ratio against its track.
 *
 * A bar, not a pie: two slices of a circle are harder to compare than two
 * lengths, and a one-value chart is a stat tile with a track.
 */
export function Meter({
  value,
  label,
  band,
  className,
}: {
  readonly value: number;
  readonly label: string;
  readonly band?: MasteryBand;
  readonly className?: string;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-hairline"
        role="img"
        aria-label={`${label}: ${percent} percent`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${percent}%`,
            backgroundColor: band ? BAND_COLOR[band] : CYAN,
          }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {percent}%
      </span>
    </div>
  );
}

/** A band, named in text as well as coloured. Never colour alone. */
export function BandTag({ band, className }: { readonly band: MasteryBand; readonly className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] text-ink-muted', className)}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: BAND_COLOR[band] }}
      />
      {BAND_LABEL[band]}
    </span>
  );
}
