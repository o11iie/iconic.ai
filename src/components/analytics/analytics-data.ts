import type {
  AnalyticsOverview,
  AnalyticsPeriod,
  KnowledgeMap,
  RecallMetrics,
  SessionAnalytics,
} from '@/analytics/contract';

/** What `/api/analytics/*` returns, shared by the dashboard and /analytics. */
export interface OverviewResponse {
  readonly ok: true;
  readonly overview: AnalyticsOverview;
}

export interface KnowledgeMapResponse {
  readonly ok: true;
  readonly knowledgeMap: KnowledgeMap;
}

export interface SessionsResponse {
  readonly ok: true;
  readonly sessions: readonly SessionAnalytics[];
}

export type { AnalyticsOverview, AnalyticsPeriod, KnowledgeMap, RecallMetrics, SessionAnalytics };

/** A percentage, or an em dash where nothing has been measured. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** A signed percentage-point change, for a measured difference. */
export function changeLabel(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const points = Math.round(value * 100);
  if (points === 0) return 'no change';
  return `${points > 0 ? '+' : ''}${points} points`;
}

/**
 * Study time in words.
 *
 * Minutes below an hour, then hours. Never "0h 0m", which reads like a broken
 * clock rather than like nothing having happened yet.
 */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * A structure's name, from its semantic id.
 *
 * The last segment, humanised. VEO does not invent a display name: the real
 * name belongs to the loaded model, and making one up in a dashboard would be
 * fabricating anatomy.
 */
export function structureName(semanticId: string): string {
  const segments = semanticId.split('.');
  const last = segments[segments.length - 1] ?? semanticId;
  return last.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}


/** A link into the workspace, focused on a structure through SceneController. */
export function exploreHref(modelRef: string, semanticId: string): string {
  return `/explore?model=${encodeURIComponent(modelRef)}&select=${encodeURIComponent(semanticId)}`;
}

/** The learner's timezone as their browser reports it. Advisory only. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
