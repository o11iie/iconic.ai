import type { QueueBucket } from '@/learning/queue';
import type { ReviewPhase, ReviewRating } from '@/learning/scheduler';
import type { SessionSummary } from '@/learning/store';
import type { DailyGoal, ProgressSummary, StreakSummary } from '@/learning/streaks';
import type { RetentionSummary, StructureMastery } from '@/learning/mastery';

/**
 * What `/api/learning/queue` returns.
 *
 * Declared once and shared by the components, so a field the server stops
 * sending becomes a type error rather than a card that quietly renders
 * `undefined` as a number.
 */

export interface QueueEntry {
  readonly itemId: string;
  readonly contentId: string;
  readonly contentType: 'question' | 'flashcard';
  readonly semanticId: string | null;
  readonly modelRef: string | null;
  readonly bucket: QueueBucket;
  readonly overdueDays: number;
  readonly phase: ReviewPhase;
}

export interface RecallData {
  readonly timeZone: string;
  readonly counts: Record<QueueBucket | 'actionable', number>;
  readonly queue: readonly QueueEntry[];
  readonly nextDueAt: string | null;
  readonly upcoming: number;
  readonly streak: StreakSummary;
  readonly goal: DailyGoal;
  readonly progress: ProgressSummary;
  readonly activity: readonly { readonly date: string; readonly reviews: number }[];
  readonly retention: RetentionSummary;
  readonly mastery: {
    readonly structures: readonly StructureMastery[];
    readonly tree: readonly unknown[];
  };
  readonly activeSession: SessionSummary | null;
  readonly reviewable: number;
}

export interface SessionItem {
  readonly itemId: string;
  readonly contentType: 'question' | 'flashcard';
  readonly semanticId: string | null;
  readonly modelRef: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The four ratings, as the learner sees them.
 *
 * Ordered worst to best, which is the order the keys 1–4 follow and the order
 * they are rendered in. A rating bar whose visual order differs from its key
 * order is a way to mis-rate a card by muscle memory.
 */
export const RATING_CHOICES: readonly {
  readonly rating: ReviewRating;
  readonly label: string;
  readonly hint: string;
  readonly key: string;
}[] = [
  { rating: 'again', label: 'Again', hint: 'I did not recall it', key: '1' },
  { rating: 'hard', label: 'Hard', hint: 'Recalled, with difficulty', key: '2' },
  { rating: 'good', label: 'Good', hint: 'Recalled correctly', key: '3' },
  { rating: 'easy', label: 'Easy', hint: 'Recalled immediately', key: '4' },
];

/** A stable, unique key per answer. Retries of the same answer reuse it. */
export function mintIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `veo-review-${random}`;
}

/** The learner's timezone as their browser reports it. Advisory only. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Read a string field from a generated payload without trusting its shape. */
export function payloadText(
  payload: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Read a list of option strings from a generated payload. */
export function payloadOptions(
  payload: Readonly<Record<string, unknown>>,
): readonly string[] {
  const raw = payload.options ?? payload.choices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** A human phrase for when something is next due. Never a fake precision. */
export function duePhrase(dueAt: string | null, now: Date): string | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;

  const minutes = Math.round((due - now.getTime()) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const days = Math.round(hours / 24);
  if (days < 31) return `in ${days} ${days === 1 ? 'day' : 'days'}`;

  const months = Math.round(days / 30);
  return `in ${months} ${months === 1 ? 'month' : 'months'}`;
}

/** A percentage for display, or an em dash when there is nothing to show. */
export function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}
