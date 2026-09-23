import type { ValidatedFlashcard, ValidatedQuestion } from '@/ai/learning/learning-types';

/**
 * Putting generated content into the review schedule.
 *
 * This is the join between Gate 11 (generation) and Gate 12 (recall). It is a
 * plain function rather than a hook so it can be tested without React.
 *
 * ## Why the payload is stored rather than regenerated
 *
 * Generated content is not reproducible: the same prompt yields different text
 * next time. An item that stored only "ask about the left ventricle" would
 * show the learner a different question on every review, and a spaced
 * repetition schedule for a question that keeps changing measures nothing.
 *
 * ## Why contentRef is derived, not random
 *
 * Enrolment is idempotent per content ref, so a learner who taps "Add to
 * schedule" twice — or whose request is retried — gets one item, not two
 * schedules for the same question.
 */

export interface EnrolResult {
  readonly added: number;
  readonly failed: number;
}

interface EnrolBody {
  readonly contentRef: string;
  readonly contentType: 'question' | 'flashcard';
  readonly semanticId: string | null;
  readonly modelRef: string | null;
  readonly payload: Record<string, unknown>;
  readonly objective: string | null;
  readonly difficulty: 'easy' | 'medium' | 'hard' | null;
}

/** The answer text for a question, where one can be shown as prose. */
export function answerText(question: ValidatedQuestion): string | null {
  const answer = question.answer;

  switch (answer.kind) {
    case 'text':
      return answer.text;
    case 'boolean':
      return answer.value ? 'True' : 'False';
    case 'choice': {
      const labels = question.options
        .filter((option) => answer.optionIds.includes(option.id))
        .map((option) => option.label);
      return labels.length > 0 ? labels.join(', ') : null;
    }
    case 'spatial':
      // The answer is a structure in the model. VEO stores the NAME the
      // generator was given from the model, never an invented one — and the
      // review screen offers "View in 3D" so the answer can be seen rather
      // than only read.
      return answer.name;
    default:
      return null;
  }
}

export function questionBody(
  question: ValidatedQuestion,
  modelRef: string | null,
): EnrolBody {
  return {
    contentRef: `question:${question.id}`,
    contentType: 'question',
    semanticId: question.semanticId,
    modelRef,
    payload: {
      prompt: question.prompt,
      options: question.options.map((option) => option.label),
      answer: answerText(question),
      explanation: question.explanation,
      kind: question.kind,
    },
    objective: question.objective,
    difficulty: normaliseDifficulty(question.difficulty),
  };
}

export function flashcardBody(
  card: ValidatedFlashcard,
  modelRef: string | null,
): EnrolBody {
  return {
    contentRef: `flashcard:${card.id}`,
    contentType: 'flashcard',
    semanticId: card.semanticId,
    modelRef,
    payload: { front: card.front, back: card.back },
    objective: card.objective,
    difficulty: normaliseDifficulty(card.difficulty),
  };
}

/** VEO's Difficulty may carry levels the schedule does not model. */
function normaliseDifficulty(value: string): 'easy' | 'medium' | 'hard' | null {
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : null;
}

/**
 * Enrol everything generated, reporting honestly what happened.
 *
 * Partial success is a real outcome and is reported as one: adding nine of ten
 * must not be shown as "added" without qualification, and must not throw away
 * the nine that worked.
 */
export async function enrolGenerated(
  questions: readonly ValidatedQuestion[],
  flashcards: readonly ValidatedFlashcard[],
  modelRef: string | null,
): Promise<EnrolResult> {
  const bodies = [
    ...questions.map((question) => questionBody(question, modelRef)),
    ...flashcards.map((card) => flashcardBody(card, modelRef)),
  ];

  const outcomes = await Promise.all(
    bodies.map(async (body) => {
      try {
        const response = await fetch('/api/learning/enrol', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );

  return {
    added: outcomes.filter(Boolean).length,
    failed: outcomes.filter((ok) => !ok).length,
  };
}
