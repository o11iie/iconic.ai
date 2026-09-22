import { REQUEST_LIMITS, type TutorTurn } from './tutor-types';

/**
 * Short-lived conversation context.
 *
 * The tutor needs enough history to resolve "why is it important?" back to the
 * structure the learner was just asking about. It does not need, and Gate 10
 * deliberately does not build, a persistent record of what a learner has ever
 * asked — that is a different feature with different storage, consent and
 * retention questions attached.
 *
 * So history lives in the client's own session and is re-bounded on every
 * request. The server stores nothing.
 *
 * ## Why bound twice
 *
 * The client bounds what it keeps; the server re-bounds what it receives. The
 * client's limit is a UX decision, and a client is not a trustworthy place to
 * enforce a cost ceiling — an unbounded `history` array is otherwise a way for
 * anyone with the endpoint to spend the account's tokens.
 */

/** Keep the most recent exchanges, within both a turn and a character budget. */
export function boundHistory(
  history: readonly TutorTurn[],
  maxTurns: number = REQUEST_LIMITS.maxHistoryTurns,
  maxChars: number = REQUEST_LIMITS.maxHistoryChars,
): readonly TutorTurn[] {
  if (history.length === 0) return [];

  // Newest first, so the budget is spent on what is most relevant.
  const kept: TutorTurn[] = [];
  let chars = 0;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (!turn) continue;
    if (kept.length >= maxTurns) break;

    const cost = turn.content.length;
    // Always keep at least one turn: a single long message that exceeds the
    // whole budget should still give the tutor something to resolve "it"
    // against, rather than silently becoming no history at all.
    if (chars + cost > maxChars && kept.length > 0) break;

    kept.push(turn);
    chars += cost;
  }

  return kept.reverse();
}

/**
 * Append a turn and re-bound.
 *
 * Used by the client to maintain its own rolling window.
 */
export function appendTurn(
  history: readonly TutorTurn[],
  turn: TutorTurn,
  maxTurns: number = REQUEST_LIMITS.maxHistoryTurns,
): readonly TutorTurn[] {
  return boundHistory([...history, turn], maxTurns);
}

/**
 * Whether history refers to a different structure than the one now selected.
 *
 * When a learner selects something new, the previous exchange is about
 * something else — carrying it forward invites the tutor to answer about the
 * old structure while the new one is on screen. The client uses this to start
 * a fresh conversation rather than silently mixing two subjects.
 */
export function shouldResetConversation(
  previousSubject: string | null,
  nextSubject: string,
): boolean {
  return previousSubject !== null && previousSubject !== nextSubject;
}
