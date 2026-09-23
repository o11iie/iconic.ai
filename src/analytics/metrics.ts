import type { SemanticId } from '@/lib/semantic-id';
import { semanticIdAncestors } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import { isRecalled, type ReviewRating } from '@/learning/scheduler';
import { localDate } from '@/learning/streaks';
import type {
  ActivityMetrics,
  AnalyticsReviewEvent,
  DifficultItem,
  GroupRetention,
  PeriodWindow,
  RecallMetrics,
  RetentionMetrics,
  SessionAnalytics,
  StructureRetention,
  TrendPoint,
  VelocityMetrics,
} from './contract';
import type { CleanSnapshot } from './integrity';
import { MAX_SESSION_SECONDS, boundedSeconds, usableInstant } from './integrity';
import { bucketOf, buckets, granularityFor, toCountTrend, toTrend, within } from './periods';

/**
 * The deterministic metric calculations.
 *
 * PURE. Everything arrives as arguments; nothing is read from a clock, an
 * environment or a database. The same snapshot and instant always produce the
 * same figures — which is what makes a learner's dashboard checkable, and what
 * lets these be tested against values worked out by hand.
 *
 * ## The rule every function here follows
 *
 * No evidence means `null`, never 0. Zero is a measurement: it says the
 * learner got everything wrong, or studied for no time. Null says VEO has not
 * measured this. Conflating them is the single most common way a learning
 * dashboard lies, and it lies in the discouraging direction.
 */

/** The minimum reviews before a ratio is worth reporting as a figure. */
export const MIN_SAMPLE_FOR_RATE = 3;

/** How many recent reviews "recent retention" is computed over. */
export const RECENT_WINDOW = 20;

/** Minimum on each side before a change between two halves is reported. */
export const MIN_SAMPLE_FOR_CHANGE = 5;

/** Ordinal ratings mapped to 0..1 for averaging. See `averageQuality`. */
export const RATING_QUALITY: Record<ReviewRating, number> = {
  again: 0,
  hard: 1 / 3,
  good: 2 / 3,
  easy: 1,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Events inside the window, oldest first. */
export function eventsInWindow(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
): AnalyticsReviewEvent[] {
  return snapshot.events.filter((event) => {
    const at = usableInstant(event.reviewedAt, now);
    return at !== null && within(window, at);
  });
}

/** Share of events that were recalled, or null below the sample floor. */
export function retentionOf(events: readonly AnalyticsReviewEvent[]): number | null {
  if (events.length === 0) return null;
  return events.filter((event) => isRecalled(event.rating)).length / events.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/** Item id → the structure it is about, for grouping events by structure. */
function structureIndex(snapshot: CleanSnapshot): Map<UUID, SemanticId> {
  const index = new Map<UUID, SemanticId>();
  for (const item of snapshot.items) {
    if (item.semanticId) index.set(item.id, item.semanticId);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export function computeRetention(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
): RetentionMetrics {
  const events = eventsInWindow(snapshot, window, now);
  const granularity = granularityFor(window);

  // ---- the recent figure -------------------------------------------------
  //
  // "Recent retention" is simply the last few reviews, capped. It is a
  // display figure, independent of the comparison below.
  const recentSlice = events.slice(-RECENT_WINDOW);
  const recent = retentionOf(recentSlice);

  // ---- the change ---------------------------------------------------------
  //
  // Split by COUNT, into halves, rather than by time or at a fixed tail.
  //
  // A time midpoint compares a heavy week against a light one and calls the
  // noise a trend. A fixed tail is worse in a quieter way: with `recent` fixed
  // at the last 20 reviews, the earlier half stays empty until the 21st, so no
  // learner below that ever gets a comparison and the minimum-sample rule
  // below never actually runs. Halves keep both sides the same size by
  // construction, so the only thing the guard has to enforce is that they are
  // big enough to mean something.
  const half = Math.floor(events.length / 2);
  const changeRecent = events.slice(events.length - half);
  const changeEarlier = events.slice(0, events.length - half);

  const recentHalf = retentionOf(changeRecent);
  const earlierHalf = retentionOf(changeEarlier);

  const change =
    recentHalf !== null &&
    earlierHalf !== null &&
    changeRecent.length >= MIN_SAMPLE_FOR_CHANGE &&
    changeEarlier.length >= MIN_SAMPLE_FOR_CHANGE
      ? recentHalf - earlierHalf
      : null;

  // ---- trend -------------------------------------------------------------

  const samples = new Map<string, number[]>();
  for (const event of events) {
    const at = usableInstant(event.reviewedAt, now);
    if (at === null) continue;
    const key = bucketOf(localDate(new Date(at), snapshot.timeZone), granularity);
    const list = samples.get(key) ?? [];
    list.push(isRecalled(event.rating) ? 1 : 0);
    samples.set(key, list);
  }

  const earliestEvent = snapshot.events[0];
  const earliestDate = earliestEvent
    ? localDate(new Date(Date.parse(earliestEvent.reviewedAt)), snapshot.timeZone)
    : null;

  const trend = toTrend(
    buckets(window, granularity, now, snapshot.timeZone, earliestDate),
    samples,
  );

  // ---- per structure -----------------------------------------------------

  const byItem = structureIndex(snapshot);
  const lapsesByStructure = new Map<SemanticId, number>();
  for (const item of snapshot.items) {
    if (!item.semanticId) continue;
    lapsesByStructure.set(
      item.semanticId,
      (lapsesByStructure.get(item.semanticId) ?? 0) + item.lapses,
    );
  }

  const perStructure = new Map<SemanticId, AnalyticsReviewEvent[]>();
  for (const event of events) {
    const semanticId = byItem.get(event.itemId);
    if (!semanticId) continue;
    const list = perStructure.get(semanticId) ?? [];
    list.push(event);
    perStructure.set(semanticId, list);
  }

  const byStructure: StructureRetention[] = [];
  for (const [semanticId, structureEvents] of perStructure) {
    const value = retentionOf(structureEvents);
    if (value === null) continue;
    byStructure.push({
      semanticId,
      retention: value,
      reviews: structureEvents.length,
      lapses: lapsesByStructure.get(semanticId) ?? 0,
    });
  }
  byStructure.sort(
    (a, b) => a.retention - b.retention || a.semanticId.localeCompare(b.semanticId),
  );

  // ---- rolled up the hierarchy -------------------------------------------
  //
  // From the ids themselves, so the same rollup serves any domain.

  const groupEvents = new Map<SemanticId, { recalled: number; total: number; structures: Set<SemanticId> }>();
  for (const [semanticId, structureEvents] of perStructure) {
    const recalledCount = structureEvents.filter((event) => isRecalled(event.rating)).length;
    for (const ancestor of semanticIdAncestors(semanticId)) {
      const entry = groupEvents.get(ancestor) ?? {
        recalled: 0,
        total: 0,
        structures: new Set<SemanticId>(),
      };
      entry.recalled += recalledCount;
      entry.total += structureEvents.length;
      entry.structures.add(semanticId);
      groupEvents.set(ancestor, entry);
    }
  }

  const byGroup: GroupRetention[] = [...groupEvents.entries()]
    .filter(([, entry]) => entry.total > 0)
    .map(([semanticId, entry]) => ({
      semanticId,
      depth: semanticId.split('.').length - 2,
      retention: entry.recalled / entry.total,
      reviews: entry.total,
      structures: entry.structures.size,
    }))
    .sort((a, b) => a.depth - b.depth || a.semanticId.localeCompare(b.semanticId));

  return {
    window,
    overall: retentionOf(events),
    recent,
    totalReviews: events.length,
    recentSampleSize: recentSlice.length,
    change,
    trend,
    granularity,
    byStructure,
    byGroup,
  };
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

export function computeRecall(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
): RecallMetrics {
  const events = eventsInWindow(snapshot, window, now);

  const distribution: Record<ReviewRating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const event of events) distribution[event.rating] += 1;

  // Only reviews VEO could actually check count toward accuracy. A self-rated
  // flashcard has no right answer, and counting it as correct would inflate
  // accuracy by exactly the share of the learner's material that is flashcards.
  const checkable = events.filter((event) => event.correct !== null);
  const accuracy =
    checkable.length === 0
      ? null
      : checkable.filter((event) => event.correct === true).length / checkable.length;

  const averageQuality =
    events.length === 0
      ? null
      : events.reduce((sum, event) => sum + RATING_QUALITY[event.rating], 0) / events.length;

  // Zero-duration reviews are excluded from the median rather than counted as
  // instant recall: they are missing measurements, not fast answers.
  const durations = events.map((event) => event.responseMs).filter((ms) => ms > 0);

  // ---- difficult items ---------------------------------------------------

  const perItem = new Map<UUID, AnalyticsReviewEvent[]>();
  for (const event of events) {
    const list = perItem.get(event.itemId) ?? [];
    list.push(event);
    perItem.set(event.itemId, list);
  }

  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  const difficultItems: DifficultItem[] = [];

  for (const [itemId, itemEvents] of perItem) {
    const failures = itemEvents.filter((event) => !isRecalled(event.rating)).length;
    // One bad answer is not a difficult item. Two failures, or a majority of
    // failures over a real sample, is evidence.
    if (failures < 2) continue;

    const item = itemsById.get(itemId);
    difficultItems.push({
      itemId,
      semanticId: item?.semanticId ?? null,
      contentType: item?.contentType ?? 'question',
      reviews: itemEvents.length,
      failures,
      lapses: item?.lapses ?? 0,
      retention: (itemEvents.length - failures) / itemEvents.length,
    });
  }

  difficultItems.sort(
    (a, b) => a.retention - b.retention || b.failures - a.failures || a.itemId.localeCompare(b.itemId),
  );

  return {
    window,
    accuracy,
    checkableReviews: checkable.length,
    distribution,
    averageQuality,
    medianResponseMs: median(durations),
    totalReviews: events.length,
    difficultItems,
  };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function computeActivity(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
): ActivityMetrics {
  const events = eventsInWindow(snapshot, window, now);
  const granularity = granularityFor(window);
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));

  let questionsAnswered = 0;
  let flashcardsReviewed = 0;
  let studyMs = 0;

  const reviewCounts = new Map<string, number>();
  const secondsCounts = new Map<string, number>();
  const activeDates = new Set<string>();

  for (const event of events) {
    const at = usableInstant(event.reviewedAt, now);
    if (at === null) continue;

    const item = itemsById.get(event.itemId);
    if (item?.contentType === 'flashcard') flashcardsReviewed += 1;
    else questionsAnswered += 1;

    studyMs += event.responseMs;

    const day = localDate(new Date(at), snapshot.timeZone);
    activeDates.add(day);

    const key = bucketOf(day, granularity);
    reviewCounts.set(key, (reviewCounts.get(key) ?? 0) + 1);
    secondsCounts.set(key, (secondsCounts.get(key) ?? 0) + event.responseMs / 1000);
  }

  // ---- sessions ----------------------------------------------------------

  const sessions = snapshot.sessions.filter((session) => {
    const at = usableInstant(session.startedAt, now);
    return at !== null && within(window, at);
  });

  const completedSessions = sessions.filter((session) => session.status === 'completed');
  const abandonedSessions = sessions.filter((session) => session.status === 'abandoned');

  const sessionSeconds: number[] = [];
  for (const session of completedSessions) {
    const started = usableInstant(session.startedAt, now);
    const ended = session.endedAt === null ? null : usableInstant(session.endedAt, now);
    if (started === null || ended === null) continue;
    const seconds = boundedSeconds(started, ended, MAX_SESSION_SECONDS);
    if (seconds !== null) sessionSeconds.push(seconds);
  }

  const earliestEvent = snapshot.events[0];
  const earliestDate = earliestEvent
    ? localDate(new Date(Date.parse(earliestEvent.reviewedAt)), snapshot.timeZone)
    : null;
  const orderedBuckets = buckets(window, granularity, now, snapshot.timeZone, earliestDate);

  const secondsRounded = new Map<string, number>();
  for (const [key, value] of secondsCounts) secondsRounded.set(key, Math.round(value));

  return {
    window,
    reviews: events.length,
    questionsAnswered,
    flashcardsReviewed,
    studySeconds: Math.round(studyMs / 1000),
    sessions: sessions.length,
    completedSessions: completedSessions.length,
    abandonedSessions: abandonedSessions.length,
    medianSessionSeconds: median(sessionSeconds),
    activeDays: activeDates.size,
    // Undefined for all time: "active on 19 of how many days?" has no answer
    // when the window has no length.
    consistency: window.days === null ? null : activeDates.size / window.days,
    reviewsPerDay: toCountTrend(orderedBuckets, reviewCounts),
    studySecondsPerDay: toCountTrend(orderedBuckets, secondsRounded),
    granularity,
  };
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

/**
 * Pace, never achievement.
 *
 * `structuresEncountered` counts structures the learner reviewed at least once
 * in the window. It is first contact, not comprehension: a hundred flashcards
 * completed is a hundred flashcards completed.
 */
export function computeVelocity(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
  strongStructures: ReadonlySet<SemanticId>,
): VelocityMetrics {
  const events = eventsInWindow(snapshot, window, now);
  const byItem = structureIndex(snapshot);

  const encountered = new Set<SemanticId>();
  const activeDates = new Set<string>();

  for (const event of events) {
    const semanticId = byItem.get(event.itemId);
    if (semanticId) encountered.add(semanticId);

    const at = usableInstant(event.reviewedAt, now);
    if (at !== null) activeDates.add(localDate(new Date(at), snapshot.timeZone));
  }

  const itemsStarted = snapshot.items.filter((item) => {
    const created = item.createdAt === null ? null : usableInstant(item.createdAt, now);
    return created !== null && within(window, created);
  }).length;

  // Strong structures that were actually reviewed in this window: a structure
  // the learner has not touched in ninety days did not reach strength in the
  // last seven, however good its current state looks.
  let reachingStrong = 0;
  for (const semanticId of encountered) {
    if (strongStructures.has(semanticId)) reachingStrong += 1;
  }

  const durations = events.map((event) => event.responseMs).filter((ms) => ms > 0);

  return {
    window,
    itemsStarted,
    structuresEncountered: encountered.size,
    structuresReachingStrong: reachingStrong,
    reviewsPerActiveDay: activeDates.size === 0 ? null : events.length / activeDates.size,
    secondsPerReview: durations.length === 0 ? null : (median(durations) ?? 0) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function computeSessions(
  snapshot: CleanSnapshot,
  window: PeriodWindow,
  now: Date,
  limit = 20,
): SessionAnalytics[] {
  const byItem = structureIndex(snapshot);
  const eventsBySession = new Map<UUID, AnalyticsReviewEvent[]>();

  for (const event of snapshot.events) {
    if (event.sessionId === null) continue;
    const list = eventsBySession.get(event.sessionId) ?? [];
    list.push(event);
    eventsBySession.set(event.sessionId, list);
  }

  const inWindow = snapshot.sessions.filter((session) => {
    const at = usableInstant(session.startedAt, now);
    return at !== null && within(window, at);
  });

  const out = inWindow.map((session): SessionAnalytics => {
    const sessionEvents = eventsBySession.get(session.id) ?? [];

    const started = usableInstant(session.startedAt, now);
    const ended = session.endedAt === null ? null : usableInstant(session.endedAt, now);
    const durationSeconds =
      started !== null && ended !== null
        ? boundedSeconds(started, ended, MAX_SESSION_SECONDS)
        : null;

    const checkable = sessionEvents.filter((event) => event.correct !== null);
    const structures = new Set<SemanticId>();
    for (const event of sessionEvents) {
      const semanticId = byItem.get(event.itemId);
      if (semanticId) structures.add(semanticId);
    }

    return {
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      itemsPlanned: session.itemsPlanned,
      // Counted from EVENTS, not from the session's own counter: the events
      // are the record of what happened, and a counter is a cache of it.
      itemsAttempted: new Set(sessionEvents.map((event) => event.itemId)).size,
      durationSeconds,
      retention: retentionOf(sessionEvents),
      accuracy:
        checkable.length === 0
          ? null
          : checkable.filter((event) => event.correct === true).length / checkable.length,
      averageQuality:
        sessionEvents.length === 0
          ? null
          : sessionEvents.reduce((sum, event) => sum + RATING_QUALITY[event.rating], 0) /
            sessionEvents.length,
      structuresCovered: structures.size,
      difficultItems: sessionEvents.filter((event) => !isRecalled(event.rating)).length,
    };
  });

  // Newest first: a session list is read from the top.
  return out
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);
}

/** Total study seconds across a window, for the lifetime figure. */
export function totalStudySeconds(snapshot: CleanSnapshot): number {
  return snapshot.days.reduce((sum, day) => sum + Math.max(0, day.secondsStudied), 0);
}

export type { TrendPoint, ISODateString };
