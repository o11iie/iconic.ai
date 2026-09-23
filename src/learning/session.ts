import type { UUID } from '@/types/domain/primitives';
import type { ReviewRating } from './scheduler';
import type { QueuedItem } from './queue';

/**
 * The review session state machine.
 *
 * PURE. A reducer over explicit events, with no timers, no fetches and no
 * store. The UI renders whatever state this returns and dispatches events back
 * into it; nothing about which button is visible is decided in a component.
 *
 * ## Why a machine rather than a handful of booleans
 *
 * A review session has real invariants. You cannot rate a question you have
 * not answered. You cannot answer while the next card is still loading. A
 * double-tap on "Good" must not rate twice. Expressed as `isLoading`,
 * `hasAnswered`, `isSubmitting` and `isFinished`, those invariants live in
 * whatever order the conditionals happen to be written in, and every new
 * branch is a chance for two of them to be true at once — which is how a
 * learner ends up rating a card that has already moved on.
 *
 * As a machine the illegal states are simply unrepresentable, and the
 * transitions are a table that can be read.
 *
 * ## What it does NOT do
 *
 * It does not schedule. It does not persist. It does not decide whether an
 * answer was correct for scoring purposes — the server does that, and the
 * machine is told. Its entire job is: what is on screen, and what may happen
 * next.
 */

export const SESSION_STATUSES = [
  'idle',
  'starting',
  'active',
  'answering',
  'rating',
  'completed',
  'abandoned',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Why a session ended, for honest reporting afterwards. */
export const SESSION_END_REASONS = ['finished', 'abandoned', 'failed'] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export interface AnsweredItem {
  readonly itemId: UUID;
  readonly rating: ReviewRating;
  /** Null where correctness is not knowable, e.g. a flashcard self-rating. */
  readonly correct: boolean | null;
  readonly responseMs: number;
}

export interface SessionState {
  readonly status: SessionStatus;
  /** The server's session id. Null until the server has created one. */
  readonly sessionId: UUID | null;
  readonly queue: readonly QueuedItem[];
  /** Index into `queue`. Equal to queue.length when the session is done. */
  readonly index: number;
  /** What the learner entered for the current item, before rating. */
  readonly answer: string | null;
  /** Whether that answer matched, where that is knowable. */
  readonly correct: boolean | null;
  /** When the current item was first shown, for response time. */
  readonly shownAt: number | null;
  /**
   * The rating being submitted right now, or null.
   *
   * Held explicitly rather than passed back in on `rated`, so the record
   * written afterwards is necessarily the rating that was actually sent. A
   * caller that echoed it back could echo something else.
   */
  readonly pendingRating: ReviewRating | null;
  readonly answered: readonly AnsweredItem[];
  readonly endReason: SessionEndReason | null;
  /** A message to show the learner. Never a raw error. */
  readonly error: string | null;
}

export const IDLE_SESSION: SessionState = {
  status: 'idle',
  sessionId: null,
  queue: [],
  index: 0,
  answer: null,
  correct: null,
  shownAt: null,
  pendingRating: null,
  answered: [],
  endReason: null,
  error: null,
};

export type SessionEvent =
  /** The learner asked to begin. The queue is already built. */
  | { readonly type: 'start'; readonly queue: readonly QueuedItem[] }
  /** The server created (or rejoined) a session. */
  | { readonly type: 'started'; readonly sessionId: UUID; readonly at: number }
  /** Starting failed. */
  | { readonly type: 'start_failed'; readonly message: string }
  /** The learner submitted an answer for the current item. */
  | {
      readonly type: 'answer';
      readonly answer: string;
      readonly correct: boolean | null;
    }
  /** The learner revealed a flashcard, which has no answer to check. */
  | { readonly type: 'reveal' }
  /** The learner rated the current item; the submission is in flight. */
  | { readonly type: 'rate'; readonly rating: ReviewRating }
  /** The server recorded the rating. */
  | { readonly type: 'rated'; readonly at: number }
  /** The server refused the rating. */
  | { readonly type: 'rate_failed'; readonly message: string }
  /** The learner left. */
  | { readonly type: 'abandon' }
  /** Reset to idle, e.g. after leaving the review screen. */
  | { readonly type: 'reset' };

/** The item on screen, or null when there is none. */
export function currentItem(state: SessionState): QueuedItem | null {
  return state.queue[state.index] ?? null;
}

/** How far through, for a progress bar. 0..1. */
export function progress(state: SessionState): number {
  if (state.queue.length === 0) return 0;
  return Math.min(1, state.index / state.queue.length);
}

export function remaining(state: SessionState): number {
  return Math.max(0, state.queue.length - state.index);
}

/** Whether the machine is waiting on the server. */
export function isBusy(state: SessionState): boolean {
  return state.status === 'starting' || state.status === 'rating';
}

/**
 * Whether a rating may be submitted right now.
 *
 * The UI asks this rather than deciding for itself, so the double-tap guard
 * exists in exactly one place.
 */
export function canRate(state: SessionState): boolean {
  return state.status === 'answering' && currentItem(state) !== null;
}

export function canAnswer(state: SessionState): boolean {
  return state.status === 'active' && currentItem(state) !== null;
}

export function isFinished(state: SessionState): boolean {
  return state.status === 'completed' || state.status === 'abandoned';
}

/**
 * Advance the machine.
 *
 * Every event that does not apply to the current status returns the state
 * unchanged rather than throwing. A stray event is a UI bug, not a reason to
 * lose a learner's in-progress session.
 */
export function reduce(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'reset':
      return IDLE_SESSION;

    case 'start': {
      if (state.status !== 'idle' && !isFinished(state)) return state;

      // An empty queue is not a session. "Nothing due" is a legitimate,
      // honest outcome and must not open a review screen with no cards.
      if (event.queue.length === 0) {
        return { ...IDLE_SESSION, status: 'completed', endReason: 'finished' };
      }

      return { ...IDLE_SESSION, status: 'starting', queue: event.queue };
    }

    case 'started': {
      if (state.status !== 'starting') return state;
      return {
        ...state,
        status: 'active',
        sessionId: event.sessionId,
        shownAt: event.at,
        error: null,
      };
    }

    case 'start_failed': {
      if (state.status !== 'starting') return state;
      return { ...IDLE_SESSION, status: 'idle', error: event.message };
    }

    case 'answer': {
      if (state.status !== 'active') return state;
      return {
        ...state,
        status: 'answering',
        answer: event.answer,
        correct: event.correct,
      };
    }

    case 'reveal': {
      // A flashcard has nothing to check: revealing IS answering, and
      // correctness stays null rather than being invented.
      if (state.status !== 'active') return state;
      return { ...state, status: 'answering', answer: null, correct: null };
    }

    case 'rate': {
      // The double-tap guard. A second `rate` while one is in flight is
      // ignored, so one answer can never produce two review events.
      if (!canRate(state)) return state;
      return { ...state, status: 'rating', pendingRating: event.rating, error: null };
    }

    case 'rated': {
      if (state.status !== 'rating') return state;

      const item = currentItem(state);
      if (!item) return state;

      // `rating` cannot be absent here: `rating` status is only reachable
      // through `rate`, which sets it. The guard keeps the type honest
      // without inventing a default that would misrecord the answer.
      const rating = state.pendingRating;
      if (rating === null) return state;

      const answered: AnsweredItem[] = [
        ...state.answered,
        {
          itemId: item.item.id,
          rating,
          correct: state.correct,
          responseMs: Math.max(0, event.at - (state.shownAt ?? event.at)),
        },
      ];

      const index = state.index + 1;
      const done = index >= state.queue.length;

      return {
        ...state,
        status: done ? 'completed' : 'active',
        index,
        answer: null,
        correct: null,
        pendingRating: null,
        shownAt: done ? null : event.at,
        answered,
        endReason: done ? 'finished' : null,
      };
    }

    case 'rate_failed': {
      if (state.status !== 'rating') return state;
      // Back to `answering`, not forward: the learner's answer is still on
      // screen and the rating did not take effect, so the only honest thing
      // is to let them try again.
      return { ...state, status: 'answering', pendingRating: null, error: event.message };
    }

    case 'abandon': {
      if (isFinished(state) || state.status === 'idle') return state;
      return { ...state, status: 'abandoned', endReason: 'abandoned' };
    }

    default: {
      // Exhaustiveness: adding a variant without handling it fails to compile.
      const never: never = event;
      return never;
    }
  }
}
