import { isSemanticId } from '@/lib/semantic-id';
import { REVIEW_PHASES, REVIEW_RATINGS } from '@/learning/scheduler';
import type {
  AnalyticsItemRecord,
  AnalyticsReviewEvent,
  AnalyticsSessionRecord,
  AnalyticsSnapshot,
  IntegrityReason,
  IntegrityReport,
} from './contract';

/**
 * The gate every analytics figure passes through.
 *
 * ## Why this exists
 *
 * A row that is impossible is not evidence of anything. A review dated in the
 * year 3000, one whose rating is a word the scheduler has never heard of, one
 * pointing at an item that no longer exists — each could be coerced into a
 * statistic, and each would make the resulting number wrong in a way nobody
 * could trace. The learner would see "retention 73%" and there would be no
 * path back from that figure to the fact that eleven of its inputs were junk.
 *
 * So invalid records are EXCLUDED and COUNTED. Excluded, so they cannot
 * contaminate an average; counted, so a real data problem stays visible rather
 * than being absorbed into a slightly smaller denominator.
 *
 * ## Why exclusion is not silent
 *
 * `IntegrityReport` travels with the analytics it filtered. If a learner's
 * dashboard is computed from 400 of 500 events, something is wrong upstream
 * and somebody needs to know. A filter whose output is indistinguishable from
 * "there was less data" is a filter that hides bugs.
 *
 * ## What this is NOT
 *
 * Not a security boundary. RLS decides whose rows these are, and it is proved
 * against real PostgreSQL. This decides whether a row the learner definitely
 * owns is usable arithmetic.
 */

/**
 * How far ahead of the server clock a timestamp may sit before it is refused.
 *
 * Not zero: clock skew between a database and an application server is normal,
 * and rejecting a review that landed two seconds "in the future" would discard
 * good data. Minutes, not hours — beyond that it is not skew.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The earliest plausible review.
 *
 * VEO did not exist before this, so a timestamp below it is a parse artefact
 * or a default value that leaked — most often epoch 0, which would otherwise
 * anchor every trend to 1970 and make every window look empty.
 */
export const EARLIEST_PLAUSIBLE_MS = Date.parse('2024-01-01T00:00:00.000Z');

/**
 * The longest single answer analytics will count.
 *
 * A review left open over lunch is not two hours of studying. The duration is
 * clamped rather than the review discarded: the learner did answer it, and
 * dropping the event would understate their reviews as well as their time.
 */
export const MAX_REVIEW_SECONDS = 15 * 60;

/** The longest single session analytics will count, for the same reason. */
export const MAX_SESSION_SECONDS = 6 * 60 * 60;

export interface CleanSnapshot {
  readonly items: readonly AnalyticsItemRecord[];
  readonly events: readonly AnalyticsReviewEvent[];
  readonly sessions: readonly AnalyticsSessionRecord[];
  readonly days: AnalyticsSnapshot['days'];
  readonly dailyTarget: number;
  readonly timeZone: string;
  readonly eventsTruncated: boolean;
  readonly integrity: IntegrityReport;
}

class ReasonTally {
  private readonly counts = new Map<IntegrityReason, number>();

  add(reason: IntegrityReason): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }

  toRecord(): IntegrityReport['reasons'] {
    return Object.fromEntries(this.counts) as IntegrityReport['reasons'];
  }
}

/** A timestamp VEO can believe. Returns null when it cannot. */
export function usableInstant(value: string | null, now: Date): number | null {
  if (typeof value !== 'string') return null;

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < EARLIEST_PLAUSIBLE_MS) return null;
  if (parsed > now.getTime() + FUTURE_TOLERANCE_MS) return null;

  return parsed;
}

/**
 * Filter a raw snapshot into one every downstream calculation can trust.
 *
 * Order matters: items are validated first, because an event's usability
 * depends on whether the item it names survived. An event pointing at a
 * discarded item is itself discarded rather than being counted against a
 * structure that analytics has decided it cannot describe.
 */
export function clean(snapshot: AnalyticsSnapshot, now: Date): CleanSnapshot {
  const reasons = new ReasonTally();

  // ---- items ------------------------------------------------------------

  const items: AnalyticsItemRecord[] = [];
  const liveItemIds = new Set<string>();

  for (const item of snapshot.items) {
    if (typeof item.id !== 'string' || item.id.length === 0) {
      reasons.add('invalid_state');
      continue;
    }

    if (!REVIEW_PHASES.includes(item.phase)) {
      reasons.add('invalid_state');
      continue;
    }

    // Every numeric the mastery and queue calculations touch must be finite.
    // One NaN produces a NaN mastery, which renders as "NaN%" and poisons
    // every aggregate it is averaged into.
    const numbers = [
      item.stability,
      item.difficulty,
      item.repetitions,
      item.lapses,
      item.intervalDays,
    ];
    if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
      reasons.add('invalid_state');
      continue;
    }

    if (!Number.isFinite(Date.parse(item.dueAt))) {
      reasons.add('invalid_timestamp');
      continue;
    }

    // A semantic id that no longer parses is dropped to null rather than
    // dropping the ITEM: the schedule is still valid, and the item still
    // counts toward reviews and activity. It simply cannot be placed in the
    // knowledge map, which `unplacedItems` reports.
    let semanticId = item.semanticId;
    if (semanticId !== null && !isSemanticId(semanticId)) {
      reasons.add('invalid_semantic_id');
      semanticId = null;
    }

    liveItemIds.add(item.id);
    items.push(semanticId === item.semanticId ? item : { ...item, semanticId });
  }

  // ---- events -----------------------------------------------------------

  const events: AnalyticsReviewEvent[] = [];
  const seenEventIds = new Set<string>();

  for (const event of snapshot.events) {
    // A duplicate id means the same answer counted twice. Gate 12 makes that
    // impossible at the database level, so seeing one here is a real defect —
    // which is exactly why it is counted rather than quietly deduplicated.
    if (seenEventIds.has(event.id)) {
      reasons.add('duplicate_event');
      continue;
    }
    seenEventIds.add(event.id);

    if (!REVIEW_RATINGS.includes(event.rating)) {
      reasons.add('invalid_rating');
      continue;
    }

    const at = usableInstant(event.reviewedAt, now);
    if (at === null) {
      reasons.add(
        Number.isFinite(Date.parse(event.reviewedAt)) ? 'future_timestamp' : 'invalid_timestamp',
      );
      continue;
    }

    if (!liveItemIds.has(event.itemId)) {
      reasons.add('unknown_item');
      continue;
    }

    // Clamped, not discarded: the review happened.
    let responseMs = event.responseMs;
    if (!Number.isFinite(responseMs) || responseMs < 0) {
      reasons.add('invalid_duration');
      responseMs = 0;
    } else if (responseMs > MAX_REVIEW_SECONDS * 1000) {
      reasons.add('invalid_duration');
      responseMs = MAX_REVIEW_SECONDS * 1000;
    }

    events.push(responseMs === event.responseMs ? event : { ...event, responseMs });
  }

  // ---- sessions ---------------------------------------------------------

  const sessions: AnalyticsSessionRecord[] = [];

  for (const session of snapshot.sessions) {
    const startedAt = usableInstant(session.startedAt, now);
    if (startedAt === null) {
      reasons.add('invalid_timestamp');
      continue;
    }

    // An open session is legitimate — the learner is mid-review. A session
    // that ENDED before it started is not, and its duration would be negative.
    if (session.endedAt !== null) {
      const endedAt = usableInstant(session.endedAt, now);
      if (endedAt === null || endedAt < startedAt) {
        reasons.add('invalid_timestamp');
        continue;
      }
    }

    if (!Number.isFinite(session.itemsPlanned) || !Number.isFinite(session.itemsCompleted)) {
      reasons.add('invalid_state');
      continue;
    }

    sessions.push(session);
  }

  // ---- daily activity ---------------------------------------------------

  const days = snapshot.days.filter((day) => {
    const wellFormed = /^\d{4}-\d{2}-\d{2}$/.test(day.date);
    const countable =
      Number.isFinite(day.reviewsCompleted) && Number.isFinite(day.secondsStudied);
    if (!wellFormed || !countable) {
      reasons.add('invalid_state');
      return false;
    }
    return true;
  });

  return {
    items,
    // Oldest first from here on. Every trend, streak and decay calculation
    // reads chronologically, and sorting once means none of them has to.
    events: events.sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt)),
    sessions: sessions.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    days,
    dailyTarget: snapshot.dailyTarget,
    timeZone: snapshot.timeZone,
    eventsTruncated: snapshot.eventsTruncated,
    integrity: {
      reviewsExcluded: snapshot.events.length - events.length,
      itemsExcluded: snapshot.items.length - items.length,
      sessionsExcluded: snapshot.sessions.length - sessions.length,
      reasons: reasons.toRecord(),
    },
  };
}

/** Seconds between two instants, clamped to something a person could have done. */
export function boundedSeconds(fromMs: number, toMs: number, maxSeconds: number): number | null {
  const seconds = (toMs - fromMs) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, maxSeconds);
}
