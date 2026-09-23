import 'server-only';

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_ANALYTICS_QUERY } from '@/learning/store';
import { fail, withLearner } from '@/learning/server/learning-api';
import { ANALYTICS_PERIODS, PERIOD_DAYS, type AnalyticsPeriod } from '../contract';
import { analyse, type AnalyticsResult } from '../engine';
import { resolveAvailableModels } from './model-availability';

/**
 * The analytics request boundary.
 *
 * Built on Gate 12's `withLearner`, deliberately. Identity is resolved in
 * exactly one place in this codebase — from a JWT validated against Supabase
 * Auth — and analytics adds no second way to decide whose data this is. A
 * parallel identity path would be a parallel chance to get it wrong, and the
 * consequence here is one learner reading another's study history.
 *
 * ## What a client may say
 *
 * A period, from a closed set. That is all. No user id, no date range, no row
 * limit, no ordering, no filter. An arbitrary date range would be both a
 * validation surface and a way to ask for an unbounded scan; a closed set is
 * neither.
 */

/**
 * The period parameter.
 *
 * `catch` rather than `default`: an unrecognised value falls back to 30 days
 * instead of failing the request. A dashboard is a read, and a stale
 * bookmark with `?period=90days` should show something sensible rather than
 * an error page. Anything genuinely hostile is simply not in the enum, so it
 * can never reach a query.
 */
export const periodParam = z.enum(ANALYTICS_PERIODS).catch('30d');

export function readPeriod(request: Request): AnalyticsPeriod {
  const raw = new URL(request.url).searchParams.get('period');
  return periodParam.parse(raw ?? '30d');
}

/**
 * How much history to read for a period.
 *
 * Bounded in both directions. The date floor keeps a short window cheap; the
 * row cap keeps a long one bounded, so a learner with years of history cannot
 * turn one dashboard load into an unbounded scan.
 *
 * Lifetime figures need the whole history, so `all` has no date floor — but it
 * keeps the row cap, and the engine reports when a history was truncated
 * rather than presenting a partial one as complete.
 */
export function queryFor(period: AnalyticsPeriod, now: Date) {
  const days = PERIOD_DAYS[period];

  if (days === null) return DEFAULT_ANALYTICS_QUERY;

  // A margin beyond the window, because comparisons need a little history
  // from before it — a "recent vs earlier" split inside a 7-day window is
  // otherwise computed from a single afternoon.
  const lookback = days * 2;

  return {
    ...DEFAULT_ANALYTICS_QUERY,
    from: new Date(now.getTime() - lookback * 86_400_000),
  };
}

/**
 * Run the analytics engine for the authenticated learner.
 *
 * Every route shares this, so the figures on the dashboard and the analytics
 * page are computed the same way from the same read. Two entry points would be
 * two chances for the same learner to be described differently on two screens.
 */
export async function withAnalytics<T>(
  request: Request,
  project: (result: AnalyticsResult, period: AnalyticsPeriod) => T,
): Promise<NextResponse> {
  const period = readPeriod(request);

  return withLearner(async ({ store, userId }, now) => {
    const raw = await store.analyticsSnapshot(userId, queryFor(period, now));

    // Resolved from the items the learner actually has, not guessed.
    const availableModels = await resolveAvailableModels(
      raw.items.map((item) => item.modelRef),
    );

    const result = analyse(raw, { period, now, availableModels });
    return project(result, period) as object;
  });
}

export { fail };
