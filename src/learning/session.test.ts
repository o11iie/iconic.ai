import { describe, expect, it } from 'vitest';
import type { UUID } from '@/types/domain/primitives';
import {
  IDLE_SESSION,
  SESSION_STATUSES,
  canAnswer,
  canRate,
  currentItem,
  isBusy,
  isFinished,
  progress,
  reduce,
  remaining,
  type SessionEvent,
  type SessionState,
} from './session';
import type { LearningItem, QueuedItem } from './queue';
import { newReviewState } from './scheduler';

const T0 = new Date('2026-03-15T09:00:00.000Z');
const SESSION = 'session-1' as UUID;

function queued(id: string): QueuedItem {
  const item: LearningItem = {
    id: id as UUID,
    contentId: `content-${id}`,
    contentType: 'question',
    semanticId: null,
    modelRef: null,
    state: newReviewState(T0),
  };
  return { item, bucket: 'new', overdueDays: 0 };
}

const QUEUE = [queued('a'), queued('b'), queued('c')];

/** Drive the machine through a list of events. */
function run(events: readonly SessionEvent[], from: SessionState = IDLE_SESSION): SessionState {
  return events.reduce(reduce, from);
}

/** A machine sitting on the first item, ready to be answered. */
function started(queue = QUEUE): SessionState {
  return run([
    { type: 'start', queue },
    { type: 'started', sessionId: SESSION, at: 1000 },
  ]);
}

describe('starting', () => {
  it('begins idle, with nothing claimed', () => {
    expect(IDLE_SESSION.status).toBe('idle');
    expect(IDLE_SESSION.sessionId).toBeNull();
    expect(IDLE_SESSION.answered).toEqual([]);
    expect(progress(IDLE_SESSION)).toBe(0);
  });

  it('waits for the server before showing anything', () => {
    const state = reduce(IDLE_SESSION, { type: 'start', queue: QUEUE });
    expect(state.status).toBe('starting');
    expect(state.sessionId).toBeNull();
    expect(isBusy(state)).toBe(true);
    expect(canAnswer(state)).toBe(false);
  });

  it('does not open a review screen when nothing is due', () => {
    // "Nothing due" is a real, honest outcome. A session with no cards is not
    // a session, and must not present one.
    const state = reduce(IDLE_SESSION, { type: 'start', queue: [] });
    expect(state.status).toBe('completed');
    expect(state.endReason).toBe('finished');
    expect(currentItem(state)).toBeNull();
  });

  it('shows the first item once the server confirms', () => {
    const state = started();
    expect(state.status).toBe('active');
    expect(state.sessionId).toBe(SESSION);
    expect(currentItem(state)!.item.id).toBe('a');
    expect(canAnswer(state)).toBe(true);
    expect(remaining(state)).toBe(3);
  });

  it('returns to idle with a message when starting fails', () => {
    const state = run([
      { type: 'start', queue: QUEUE },
      { type: 'start_failed', message: 'VEO could not start that session.' },
    ]);
    expect(state.status).toBe('idle');
    expect(state.error).toBe('VEO could not start that session.');
    expect(state.sessionId).toBeNull();
  });

  it('ignores a second start while one is in flight', () => {
    const inFlight = reduce(IDLE_SESSION, { type: 'start', queue: QUEUE });
    expect(reduce(inFlight, { type: 'start', queue: [queued('z')] })).toBe(inFlight);
  });
});

describe('answering and rating', () => {
  it('will not let a rating precede an answer', () => {
    // The invariant that matters most: you cannot rate what you have not seen
    // the answer to.
    const state = started();
    expect(canRate(state)).toBe(false);
    expect(reduce(state, { type: 'rate', rating: 'good' })).toBe(state);
  });

  it('accepts an answer and then allows rating', () => {
    const state = reduce(started(), { type: 'answer', answer: 'left ventricle', correct: true });
    expect(state.status).toBe('answering');
    expect(state.answer).toBe('left ventricle');
    expect(state.correct).toBe(true);
    expect(canRate(state)).toBe(true);
  });

  it('treats revealing a flashcard as answering, with correctness unknown', () => {
    // A self-rated card has no right answer to check. Null is the honest
    // value; inventing `true` would inflate retention.
    const state = reduce(started(), { type: 'reveal' });
    expect(state.status).toBe('answering');
    expect(state.correct).toBeNull();
    expect(canRate(state)).toBe(true);
  });

  it('ignores a double tap on a rating', () => {
    // One answer must never produce two review events. The guard lives here,
    // so no component has to remember it.
    const answered = reduce(started(), { type: 'answer', answer: 'x', correct: true });
    const rating = reduce(answered, { type: 'rate', rating: 'good' });

    expect(rating.status).toBe('rating');
    expect(canRate(rating)).toBe(false);
    expect(reduce(rating, { type: 'rate', rating: 'easy' })).toBe(rating);
  });

  it('records the rating that was actually sent', () => {
    const state = run(
      [
        { type: 'answer', answer: 'x', correct: false },
        { type: 'rate', rating: 'again' },
        { type: 'rated', at: 4000 },
      ],
      started(),
    );

    expect(state.answered).toHaveLength(1);
    expect(state.answered[0]).toEqual({
      itemId: 'a',
      rating: 'again',
      correct: false,
      responseMs: 3000,
    });
  });

  it('measures response time from when the item was shown', () => {
    const state = run(
      [
        { type: 'answer', answer: 'x', correct: true },
        { type: 'rate', rating: 'good' },
        { type: 'rated', at: 9500 },
      ],
      started(),
    );
    expect(state.answered[0]!.responseMs).toBe(8500);
  });

  it('never reports a negative response time', () => {
    const state = run(
      [
        { type: 'answer', answer: 'x', correct: true },
        { type: 'rate', rating: 'good' },
        { type: 'rated', at: 0 },
      ],
      started(),
    );
    expect(state.answered[0]!.responseMs).toBe(0);
  });

  it('advances to the next item and clears the previous answer', () => {
    const state = run(
      [
        { type: 'answer', answer: 'first', correct: true },
        { type: 'rate', rating: 'good' },
        { type: 'rated', at: 3000 },
      ],
      started(),
    );

    expect(state.status).toBe('active');
    expect(currentItem(state)!.item.id).toBe('b');
    expect(state.answer).toBeNull();
    expect(state.correct).toBeNull();
    expect(state.pendingRating).toBeNull();
    expect(remaining(state)).toBe(2);
  });

  it('returns the learner to their answer when the server refuses', () => {
    // Going forward would discard an answer that was never recorded. The
    // honest state is "still on this card, try again".
    const state = run(
      [
        { type: 'answer', answer: 'mine', correct: true },
        { type: 'rate', rating: 'good' },
        { type: 'rate_failed', message: 'VEO could not record that.' },
      ],
      started(),
    );

    expect(state.status).toBe('answering');
    expect(state.answer).toBe('mine');
    expect(state.index).toBe(0);
    expect(state.answered).toEqual([]);
    expect(state.error).toBe('VEO could not record that.');
    expect(canRate(state)).toBe(true);
  });

  it('lets the learner retry after a failure', () => {
    const state = run(
      [
        { type: 'answer', answer: 'mine', correct: true },
        { type: 'rate', rating: 'good' },
        { type: 'rate_failed', message: 'oops' },
        { type: 'rate', rating: 'hard' },
        { type: 'rated', at: 5000 },
      ],
      started(),
    );

    expect(state.answered).toHaveLength(1);
    expect(state.answered[0]!.rating).toBe('hard');
    expect(state.error).toBeNull();
  });
});

describe('finishing', () => {
  function answerAll(queue = QUEUE): SessionState {
    let state = started(queue);
    for (let i = 0; i < queue.length; i += 1) {
      state = run(
        [
          { type: 'answer', answer: `a${i}`, correct: true },
          { type: 'rate', rating: 'good' },
          { type: 'rated', at: 2000 + i * 1000 },
        ],
        state,
      );
    }
    return state;
  }

  it('completes once every item has been rated', () => {
    const state = answerAll();

    expect(state.status).toBe('completed');
    expect(state.endReason).toBe('finished');
    expect(isFinished(state)).toBe(true);
    expect(currentItem(state)).toBeNull();
    expect(remaining(state)).toBe(0);
    expect(progress(state)).toBe(1);
    expect(state.answered).toHaveLength(3);
  });

  it('keeps the full record of what was answered', () => {
    expect(answerAll().answered.map((entry) => entry.itemId)).toEqual(['a', 'b', 'c']);
  });

  it('accepts nothing further once completed', () => {
    const done = answerAll();
    for (const event of [
      { type: 'answer', answer: 'x', correct: true },
      { type: 'rate', rating: 'good' },
      { type: 'rated', at: 9999 },
      { type: 'abandon' },
    ] as const) {
      expect(reduce(done, event)).toBe(done);
    }
  });

  it('abandons mid-session without losing what was already answered', () => {
    const partway = run(
      [
        { type: 'answer', answer: 'x', correct: true },
        { type: 'rate', rating: 'good' },
        { type: 'rated', at: 3000 },
      ],
      started(),
    );
    const abandoned = reduce(partway, { type: 'abandon' });

    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.endReason).toBe('abandoned');
    expect(abandoned.answered).toHaveLength(1);
    expect(isFinished(abandoned)).toBe(true);
  });

  it('cannot abandon a session that never started', () => {
    expect(reduce(IDLE_SESSION, { type: 'abandon' })).toBe(IDLE_SESSION);
  });

  it('resets to a clean idle state', () => {
    expect(reduce(answerAll(), { type: 'reset' })).toEqual(IDLE_SESSION);
  });

  it('can start a fresh session after finishing', () => {
    const next = reduce(answerAll(), { type: 'start', queue: [queued('z')] });
    expect(next.status).toBe('starting');
    expect(next.answered).toEqual([]);
    expect(next.sessionId).toBeNull();
  });
});

describe('progress reporting', () => {
  it('reports honest fractions as the session advances', () => {
    let state = started();
    expect(progress(state)).toBe(0);

    for (const expected of [1 / 3, 2 / 3, 1]) {
      state = run(
        [
          { type: 'answer', answer: 'x', correct: true },
          { type: 'rate', rating: 'good' },
          { type: 'rated', at: 3000 },
        ],
        state,
      );
      expect(progress(state)).toBeCloseTo(expected, 9);
    }
  });

  it('never reports progress for an empty session', () => {
    expect(progress(reduce(IDLE_SESSION, { type: 'start', queue: [] }))).toBe(0);
  });
});

describe('the machine as a whole', () => {
  it('reaches every declared status', () => {
    // Guards against a status existing in the union that nothing produces —
    // a branch of UI that can never render.
    const reached = new Set<string>([IDLE_SESSION.status]);
    let state = IDLE_SESSION;

    for (const event of [
      { type: 'start', queue: QUEUE },
      { type: 'started', sessionId: SESSION, at: 1000 },
      { type: 'answer', answer: 'x', correct: true },
      { type: 'rate', rating: 'good' },
      { type: 'rated', at: 2000 },
    ] as const) {
      state = reduce(state, event);
      reached.add(state.status);
    }

    reached.add(reduce(state, { type: 'abandon' }).status);

    let finishing = state;
    for (let i = 0; i < 2; i += 1) {
      finishing = run(
        [
          { type: 'answer', answer: 'x', correct: true },
          { type: 'rate', rating: 'good' },
          { type: 'rated', at: 3000 },
        ],
        finishing,
      );
    }
    reached.add(finishing.status);

    expect([...reached].sort()).toEqual([...SESSION_STATUSES].sort());
  });

  it('never mutates the state it was given', () => {
    const state = started();
    const snapshot = structuredClone(state);

    reduce(state, { type: 'answer', answer: 'x', correct: true });
    reduce(state, { type: 'abandon' });
    reduce(state, { type: 'reset' });

    expect(state).toEqual(snapshot);
  });

  it('ignores every event that does not apply, rather than throwing', () => {
    // A stray event is a UI bug, not a reason to lose a learner's session.
    const states = [
      IDLE_SESSION,
      reduce(IDLE_SESSION, { type: 'start', queue: QUEUE }),
      started(),
      reduce(started(), { type: 'answer', answer: 'x', correct: true }),
    ];

    const events: SessionEvent[] = [
      { type: 'started', sessionId: SESSION, at: 1 },
      { type: 'start_failed', message: 'x' },
      { type: 'answer', answer: 'x', correct: true },
      { type: 'reveal' },
      { type: 'rate', rating: 'good' },
      { type: 'rated', at: 1 },
      { type: 'rate_failed', message: 'x' },
      { type: 'abandon' },
    ];

    for (const state of states) {
      for (const event of events) {
        expect(() => reduce(state, event)).not.toThrow();
        expect(SESSION_STATUSES).toContain(reduce(state, event).status);
      }
    }
  });

  it('is deterministic for the same event sequence', () => {
    const events: SessionEvent[] = [
      { type: 'start', queue: QUEUE },
      { type: 'started', sessionId: SESSION, at: 1000 },
      { type: 'answer', answer: 'x', correct: false },
      { type: 'rate', rating: 'again' },
      { type: 'rated', at: 4000 },
    ];
    expect(run(events)).toEqual(run(events));
  });
});
