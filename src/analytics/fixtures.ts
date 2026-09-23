import { buildSemanticId, type SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import type { ReviewRating } from '@/learning/scheduler';
import type {
  AnalyticsItemRecord,
  AnalyticsReviewEvent,
  AnalyticsSessionRecord,
  AnalyticsSnapshot,
} from './contract';

/**
 * Deterministic builders for analytics inputs.
 *
 * Shared by the unit tests and the browser harness so both assert against the
 * SAME learner. A browser check that renders one fixture while the unit tests
 * verify another proves the two agree about nothing.
 *
 * Nothing here is random. Every id, timestamp and rating is derived from its
 * arguments, so a figure computed from a fixture can be worked out by hand and
 * written into a test as a literal.
 */

/** `veo.chemistry.organic.benzene` from a dotted string. */
export function toId(dotted: string): SemanticId {
  const [namespace, domain, ...path] = dotted.split('.');
  if (namespace !== 'veo' || !domain) throw new Error(`not a VEO id: ${dotted}`);
  return buildSemanticId(domain, ...path);
}

export function iso(base: Date, offsetDays: number, offsetMinutes = 0): ISODateString {
  return new Date(
    base.getTime() + offsetDays * 86_400_000 + offsetMinutes * 60_000,
  ).toISOString() as ISODateString;
}

export function item(
  id: string,
  overrides: Partial<AnalyticsItemRecord> = {},
): AnalyticsItemRecord {
  return {
    id: id as UUID,
    contentType: 'question',
    semanticId: null,
    modelRef: null,
    createdAt: null,
    phase: 'review',
    stability: 30,
    difficulty: 0.3,
    repetitions: 5,
    lapses: 0,
    intervalDays: 3,
    dueAt: new Date('2026-06-01T00:00:00.000Z').toISOString() as ISODateString,
    lastReviewedAt: null,
    ...overrides,
  };
}

export function event(
  id: string,
  itemId: string,
  rating: ReviewRating,
  reviewedAt: ISODateString,
  overrides: Partial<AnalyticsReviewEvent> = {},
): AnalyticsReviewEvent {
  return {
    id: id as UUID,
    itemId: itemId as UUID,
    rating,
    correct: rating === 'again' ? false : true,
    responseMs: 4000,
    reviewedAt,
    sessionId: null,
    ...overrides,
  };
}

export function session(
  id: string,
  startedAt: ISODateString,
  overrides: Partial<AnalyticsSessionRecord> = {},
): AnalyticsSessionRecord {
  return {
    id: id as UUID,
    status: 'completed',
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 10 * 60_000).toISOString() as ISODateString,
    itemsPlanned: 5,
    itemsCompleted: 5,
    ...overrides,
  };
}

export function snapshot(overrides: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot {
  return {
    items: [],
    events: [],
    sessions: [],
    days: [],
    dailyTarget: 20,
    timeZone: 'UTC',
    eventsTruncated: false,
    ...overrides,
  };
}

/**
 * The reference learner, used by unit tests AND the browser harness.
 *
 * Hand-calculable by construction:
 *
 *   Structure A (core_unit)  10 reviews,  8 recalled, 2 failed  → retention 0.80
 *   Structure B (edge_unit)   5 reviews,  1 recalled, 4 failed  → retention 0.20
 *   Structure C (spare_unit)  0 reviews                          → untouched
 *
 * Totals: 15 reviews, 9 recalled → overall retention 0.60 exactly.
 */
export const REFERENCE = {
  modelRef: '__veo_analytics_fixture__',
  structureA: 'veo.diagnostic.analytics_fixture.system_a.core_unit',
  structureB: 'veo.diagnostic.analytics_fixture.system_a.edge_unit',
  structureC: 'veo.diagnostic.analytics_fixture.system_b.spare_unit',
  totalReviews: 15,
  totalRecalled: 9,
  overallRetention: 0.6,
  retentionA: 0.8,
  retentionB: 0.2,
} as const;

/**
 * Build the reference learner's snapshot, anchored to `now`.
 *
 * Reviews are laid out one per day going backwards, so every window boundary
 * lands somewhere predictable and a 7-day figure can be counted off by hand.
 */
export function referenceSnapshot(now: Date): AnalyticsSnapshot {
  const items: AnalyticsItemRecord[] = [
    item('item-a', {
      semanticId: toId(REFERENCE.structureA),
      modelRef: REFERENCE.modelRef,
      repetitions: 8,
      lapses: 2,
      stability: 40,
      lastReviewedAt: iso(now, -1),
      dueAt: iso(now, 4),
      createdAt: iso(now, -14),
    }),
    item('item-b', {
      semanticId: toId(REFERENCE.structureB),
      modelRef: REFERENCE.modelRef,
      contentType: 'flashcard',
      repetitions: 1,
      lapses: 4,
      stability: 1.2,
      lastReviewedAt: iso(now, -2),
      dueAt: iso(now, -3),
      createdAt: iso(now, -14),
    }),
    item('item-c', {
      semanticId: toId(REFERENCE.structureC),
      modelRef: REFERENCE.modelRef,
      phase: 'new',
      repetitions: 0,
      lapses: 0,
      stability: 0,
      lastReviewedAt: null,
      dueAt: iso(now, 0),
      createdAt: iso(now, -1),
    }),
  ];

  // Structure A: 8 recalled, 2 failed, one per day from -10 to -1.
  const aRatings: ReviewRating[] = [
    'good', 'good', 'again', 'good', 'good',
    'good', 'again', 'good', 'good', 'easy',
  ];
  const events: AnalyticsReviewEvent[] = aRatings.map((rating, index) =>
    event(`ev-a-${index}`, 'item-a', rating, iso(now, -(10 - index), 30), {
      sessionId: 'sess-1' as UUID,
    }),
  );

  // Structure B: 1 recalled, 4 failed, one per day from -5 to -1.
  const bRatings: ReviewRating[] = ['again', 'again', 'good', 'again', 'again'];
  events.push(
    ...bRatings.map((rating, index) =>
      event(`ev-b-${index}`, 'item-b', rating, iso(now, -(5 - index), 45), {
        // A flashcard is self-rated: correctness is unknowable, not false.
        correct: null,
        sessionId: 'sess-1' as UUID,
      }),
    ),
  );

  const days = new Map<string, { date: string; reviewsCompleted: number; secondsStudied: number }>();
  for (const entry of events) {
    const date = entry.reviewedAt.slice(0, 10);
    const existing = days.get(date) ?? { date, reviewsCompleted: 0, secondsStudied: 0 };
    days.set(date, {
      date,
      reviewsCompleted: existing.reviewsCompleted + 1,
      secondsStudied: existing.secondsStudied + Math.round(entry.responseMs / 1000),
    });
  }

  return snapshot({
    items,
    events,
    sessions: [session('sess-1', iso(now, -1, 0), { itemsPlanned: 3, itemsCompleted: 2 })],
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  });
}
