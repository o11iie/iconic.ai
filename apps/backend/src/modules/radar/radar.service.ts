import type { RadarBucket, RadarEntry, RadarReason, ReleaseRadar, ReleaseWindow, TitleSummary } from "@slate/shared";
import { computeCountdown, daysUntil } from "../discovery/countdown";

/**
 * Release Radar buckets a release by how soon it lands, using only the
 * precision the provider actually gave us. A title whose date Slate knows
 * only as "Q4" never lands in THIS_WEEK — it falls to LATER with its own
 * label, rather than being assigned a precise bucket it can't support.
 */
export function bucketFor(window: ReleaseWindow, now: Date = new Date()): RadarBucket | null {
  const days = daysUntil(window, now);
  if (days === null) return "LATER"; // known upcoming, imprecise date
  if (days < 0) return null; // already released — not on the radar
  if (days === 0) return "TODAY";
  if (days <= 7) return "THIS_WEEK";
  if (days <= 14) return "NEXT_WEEK";
  if (days <= 31) return "THIS_MONTH";
  return "LATER";
}

const EMPTY_BUCKETS = (): Record<RadarBucket, RadarEntry[]> => ({
  TODAY: [],
  THIS_WEEK: [],
  NEXT_WEEK: [],
  THIS_MONTH: [],
  LATER: [],
});

/** Followed beats watchlisted beats merely trending — the user's own signals come first. */
const REASON_WEIGHT: Record<RadarReason, number> = { FOLLOWED: 3, WATCHLISTED: 2, TRENDING: 1 };

function priority(entry: RadarEntry): number {
  return Math.max(...entry.reasons.map((r) => REASON_WEIGHT[r]));
}

export interface RadarInput {
  title: TitleSummary;
  reasons: RadarReason[];
}

/**
 * Builds the radar. `horizonDays` comes from the user's plan: Free sees a
 * genuinely useful near-term window, Pro sees the full planning horizon.
 * When the horizon hides entries the user would otherwise have, we report
 * `truncatedByPlan` so the UI can say so honestly instead of pretending
 * nothing else is coming.
 */
export function buildReleaseRadar(inputs: RadarInput[], horizonDays: number, now: Date = new Date()): ReleaseRadar {
  const buckets = EMPTY_BUCKETS();
  let truncatedByPlan = false;
  const seen = new Set<string>();

  for (const { title, reasons } of inputs) {
    if (seen.has(title.id)) continue;
    seen.add(title.id);

    const bucket = bucketFor(title.releaseWindow, now);
    if (bucket === null) continue;

    const days = daysUntil(title.releaseWindow, now);
    if (days !== null && days > horizonDays) {
      truncatedByPlan = true;
      continue;
    }

    buckets[bucket].push({
      title,
      mediaType: title.mediaType,
      bucket,
      releaseWindow: title.releaseWindow,
      daysUntil: days,
      reasons,
      releaseLabel: computeCountdown(title.releaseWindow, now).displayLabel,
    });
  }

  for (const key of Object.keys(buckets) as RadarBucket[]) {
    buckets[key].sort((a, b) => {
      const byPriority = priority(b) - priority(a);
      if (byPriority !== 0) return byPriority;
      return (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity);
    });
  }

  const totalEntries = Object.values(buckets).reduce((sum, list) => sum + list.length, 0);
  return { buckets, horizonDays, truncatedByPlan, totalEntries };
}

/** Merges reason lists when a title is both followed and watchlisted. */
export function mergeInputs(lists: RadarInput[][]): RadarInput[] {
  const byId = new Map<string, RadarInput>();
  for (const list of lists) {
    for (const input of list) {
      const existing = byId.get(input.title.id);
      if (existing) {
        for (const reason of input.reasons) {
          if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        }
      } else {
        byId.set(input.title.id, { title: input.title, reasons: [...input.reasons] });
      }
    }
  }
  return Array.from(byId.values());
}
