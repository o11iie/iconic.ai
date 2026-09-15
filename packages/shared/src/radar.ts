import type { MediaType, ReleaseWindow, TitleSummary } from "./title";

/** Time buckets Release Radar groups by. */
export type RadarBucket = "TODAY" | "THIS_WEEK" | "NEXT_WEEK" | "THIS_MONTH" | "LATER";

/** Why this title is on the user's radar — drives sort priority and the UI label. */
export type RadarReason = "FOLLOWED" | "WATCHLISTED" | "TRENDING";

export interface RadarEntry {
  title: TitleSummary;
  mediaType: MediaType;
  bucket: RadarBucket;
  releaseWindow: ReleaseWindow;
  /** Days until release. Null when the source date isn't precise enough to count days. */
  daysUntil: number | null;
  reasons: RadarReason[];
  /** Human label honoring source precision — never invents a time of day. */
  releaseLabel: string;
}

export interface ReleaseRadar {
  buckets: Record<RadarBucket, RadarEntry[]>;
  /** How far ahead this response looked, per the user's plan. */
  horizonDays: number;
  /** True when the plan's horizon truncated the results — the client uses this for an honest upgrade prompt. */
  truncatedByPlan: boolean;
  totalEntries: number;
}
