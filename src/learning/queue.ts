import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import type { ReviewPhase, ReviewState } from './scheduler';

/**
 * The review queue.
 *
 * PURE, like the scheduler. Given a set of items and an instant, it produces
 * the order to review them in — the same order, every time.
 *
 * Determinism matters more here than it looks. A queue that shuffled would
 * make "I saw this twice" unreproducible, and a learner who refreshes
 * mid-session and gets a different queue has lost their place. So ties are
 * broken all the way down to the item id, and nothing is random.
 */

/** A schedulable thing. Domain-agnostic: it references content, not anatomy. */
export interface LearningItem {
  readonly id: UUID;
  /** Which generated question or flashcard this is. */
  readonly contentId: string;
  readonly contentType: 'question' | 'flashcard';
  /** The structure this is about, when it is about one. */
  readonly semanticId: SemanticId | null;
  /** Which model the structure belongs to, for validation at review time. */
  readonly modelRef: string | null;
  readonly state: ReviewState;
}

/**
 * Which bucket an item falls into right now.
 *
 * Derived from phase and due date together, because neither alone is enough:
 * a `review` item is only actually due when its date has passed, and a
 * `learning` item is urgent regardless of how far past its minute-scale step
 * it has drifted.
 */
export const QUEUE_BUCKETS = ['overdue', 'due', 'learning', 'new', 'upcoming', 'suspended'] as const;
export type QueueBucket = (typeof QUEUE_BUCKETS)[number];

export interface QueuedItem {
  readonly item: LearningItem;
  readonly bucket: QueueBucket;
  /** How many days past due. Negative for upcoming. */
  readonly overdueDays: number;
}

export interface QueueCounts {
  readonly overdue: number;
  readonly due: number;
  readonly learning: number;
  readonly new: number;
  readonly upcoming: number;
  readonly suspended: number;
  /** Everything a learner could review right now. */
  readonly actionable: number;
}

/**
 * How many of each kind may enter one session.
 *
 * The new-item cap is the one that matters. Without it, a learner who
 * generates fifty flashcards gets fifty new items on day one, then fifty
 * reviews on day two, then a hundred on day three — the classic collapse that
 * makes people abandon spaced repetition. Capping new work keeps the future
 * survivable.
 */
export interface QueueLimits {
  readonly maxNewPerSession: number;
  readonly maxReviewsPerSession: number;
  readonly maxSessionSize: number;
}

export const DEFAULT_QUEUE_LIMITS: QueueLimits = {
  maxNewPerSession: 10,
  maxReviewsPerSession: 60,
  maxSessionSize: 60,
};

/** Classify one item against the current instant. */
export function classify(item: LearningItem, now: Date): QueuedItem {
  const state = item.state;

  if (state.phase === 'suspended') {
    return { item, bucket: 'suspended', overdueDays: 0 };
  }

  const dueAt = Date.parse(state.dueAt);
  const overdueDays = Number.isFinite(dueAt) ? (now.getTime() - dueAt) / 86_400_000 : 0;
  const isDue = overdueDays >= 0;

  if (state.phase === 'new') {
    // A new item is available immediately; it has no meaningful due date.
    return { item, bucket: 'new', overdueDays: Math.max(0, overdueDays) };
  }

  if (state.phase === 'learning' || state.phase === 'relearning') {
    return { item, bucket: isDue ? 'learning' : 'upcoming', overdueDays };
  }

  if (!isDue) return { item, bucket: 'upcoming', overdueDays };

  // A day of grace before something counts as genuinely overdue, so an
  // evening learner is not told they are behind every single morning.
  return { item, bucket: overdueDays >= 1 ? 'overdue' : 'due', overdueDays };
}

export function countQueue(items: readonly LearningItem[], now: Date): QueueCounts {
  const counts: Record<QueueBucket, number> = {
    overdue: 0,
    due: 0,
    learning: 0,
    new: 0,
    upcoming: 0,
    suspended: 0,
  };

  for (const item of items) counts[classify(item, now).bucket] += 1;

  return {
    ...counts,
    actionable: counts.overdue + counts.due + counts.learning + counts.new,
  };
}

/**
 * Bucket priority.
 *
 * Learning first, because those items are minutes from being forgotten and
 * the whole point of a short step is that it is short. Then overdue, then due,
 * then new.
 *
 * New comes LAST among actionable work, which is the choice that prevents
 * starvation in the direction that actually happens: a learner who keeps
 * adding material would otherwise spend every session on new items while the
 * backlog of things they half-know grows behind them.
 */
const BUCKET_ORDER: Record<QueueBucket, number> = {
  learning: 0,
  overdue: 1,
  due: 2,
  new: 3,
  upcoming: 4,
  suspended: 5,
};

/**
 * Build the review queue.
 *
 * Ordering, in full:
 *
 *   1. bucket priority (above)
 *   2. within a bucket, most overdue first
 *   3. then earliest due date
 *   4. then item id
 *
 * Rule 4 is what makes this a total order. Without a final tie-break on a
 * unique value, two items with identical schedules could order differently
 * between calls, and the queue would stop being reproducible.
 */
export function buildQueue(
  items: readonly LearningItem[],
  now: Date,
  limits: QueueLimits = DEFAULT_QUEUE_LIMITS,
): readonly QueuedItem[] {
  const seen = new Set<UUID>();
  const actionable: QueuedItem[] = [];

  for (const item of items) {
    // Duplicate ids would let one item be reviewed twice in a session and
    // scheduled twice from one answer.
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const queued = classify(item, now);
    if (queued.bucket === 'upcoming' || queued.bucket === 'suspended') continue;
    actionable.push(queued);
  }

  actionable.sort(compareQueued);

  // Apply the caps, counting new and review work separately.
  const chosen: QueuedItem[] = [];
  let newCount = 0;
  let reviewCount = 0;

  for (const queued of actionable) {
    if (chosen.length >= limits.maxSessionSize) break;

    if (queued.bucket === 'new') {
      if (newCount >= limits.maxNewPerSession) continue;
      newCount += 1;
    } else {
      if (reviewCount >= limits.maxReviewsPerSession) continue;
      reviewCount += 1;
    }

    chosen.push(queued);
  }

  return chosen;
}

function compareQueued(a: QueuedItem, b: QueuedItem): number {
  const bucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
  if (bucket !== 0) return bucket;

  // Most overdue first.
  const overdue = b.overdueDays - a.overdueDays;
  if (Math.abs(overdue) > 1e-9) return overdue;

  const dueA = Date.parse(a.item.state.dueAt);
  const dueB = Date.parse(b.item.state.dueAt);
  if (Number.isFinite(dueA) && Number.isFinite(dueB) && dueA !== dueB) return dueA - dueB;

  // The total-order tie-break.
  return a.item.id.localeCompare(b.item.id);
}

/** Items that will come due within the next `days`, for the dashboard. */
export function upcomingWithin(
  items: readonly LearningItem[],
  now: Date,
  days: number,
): readonly QueuedItem[] {
  const horizon = now.getTime() + days * 86_400_000;

  return items
    .map((item) => classify(item, now))
    .filter((queued) => {
      if (queued.bucket !== 'upcoming') return false;
      const due = Date.parse(queued.item.state.dueAt);
      return Number.isFinite(due) && due <= horizon;
    })
    .sort(compareQueued);
}

/** Phases that mean an item is actively being learned rather than maintained. */
export function isActivePhase(phase: ReviewPhase): boolean {
  return phase === 'learning' || phase === 'relearning';
}

/** The next due date across a set of items, for "you're caught up until…". */
export function nextDueAt(
  items: readonly LearningItem[],
  now: Date,
): ISODateString | null {
  let earliest: number | null = null;

  for (const item of items) {
    if (item.state.phase === 'suspended') continue;
    const due = Date.parse(item.state.dueAt);
    if (!Number.isFinite(due) || due <= now.getTime()) continue;
    if (earliest === null || due < earliest) earliest = due;
  }

  return earliest === null ? null : new Date(earliest).toISOString();
}
