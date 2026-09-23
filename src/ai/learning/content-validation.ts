import type { SemanticId } from '@/lib/semantic-id';
import type { ContentSourceStatus, Difficulty, LearningObjectiveType } from '@/types/domain/learning';
import type { LearningContext } from './learning-context';
import type {
  GeneratedFlashcard,
  GeneratedQuestion,
  QuestionAnswerValue,
  RejectedItem,
  ValidatedFlashcard,
  ValidatedQuestion,
} from './learning-types';

/**
 * The checks a schema cannot make.
 *
 * Schema validation proves a question has the right SHAPE: a prompt, some
 * options, a boolean. It says nothing about whether the question is answerable,
 * whether exactly one option is right, whether the "correct" answer appears
 * among the choices at all, or whether the prompt gives the game away.
 *
 * Every check here is deterministic. None of them asks a model whether its own
 * output was any good — a generator is the worst available judge of its own
 * work, and "ask the model to check itself" is how a validation layer becomes
 * a second opportunity to hallucinate.
 *
 * ## Rejection, not repair
 *
 * A failing item is DROPPED with a reason, never patched. Repairing a question
 * means VEO writing part of it, and VEO does not know the subject — a
 * multiple-choice question silently given a second correct answer by its
 * validator is worse than no question, because it looks authored.
 */

export interface ValidationInput {
  readonly context: LearningContext;
  readonly objective: LearningObjectiveType;
  readonly difficulty: Difficulty;
  readonly educationLevel: string;
  readonly sourceStatus: ContentSourceStatus;
}

export interface ValidationOutcome<T> {
  readonly accepted: readonly T[];
  readonly rejected: readonly RejectedItem[];
}

/** A short, safe excerpt for diagnosis. Never the whole item. */
function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

/**
 * Normalise text for comparison.
 *
 * Case, punctuation and whitespace differences are not different questions.
 * "What is the Core Unit?" and "what is the core unit" are the same card shown
 * twice, and a learner who sees both will conclude VEO is padding.
 */
export function signature(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether two strings are near-identical.
 *
 * Token overlap rather than edit distance: questions differ by whole words —
 * "what is X" versus "what does X do" — and an edit-distance threshold loose
 * enough to catch that would also merge two genuinely different questions
 * about structures with similar names.
 */
export function nearlyIdentical(a: string, b: string, threshold = 0.85): boolean {
  const left = new Set(signature(a).split(' ').filter(Boolean));
  const right = new Set(signature(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return false;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;

  // Jaccard: shared over the union.
  const union = left.size + right.size - shared;
  return union > 0 && shared / union >= threshold;
}

/**
 * Does the prompt hand over the answer?
 *
 * A question whose prompt contains its own answer tests reading, not recall.
 * Checked by token containment rather than substring, so "Which structure
 * contains the Core Unit?" is not flagged merely for naming a structure the
 * answer also names — the test is whether the ANSWER's distinctive words are
 * already present.
 */
export function promptRevealsAnswer(prompt: string, answer: string): boolean {
  const answerTokens = signature(answer)
    .split(' ')
    .filter((token) => token.length > 3);
  if (answerTokens.length === 0) return false;

  const promptSignature = signature(prompt);
  const present = answerTokens.filter((token) => promptSignature.includes(token));

  // Every distinctive word of the answer already in the prompt.
  return present.length === answerTokens.length;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export function validateQuestions(
  generated: readonly GeneratedQuestion[],
  input: ValidationInput,
): ValidationOutcome<ValidatedQuestion> {
  const accepted: ValidatedQuestion[] = [];
  const rejected: RejectedItem[] = [];
  const known = new Set<SemanticId>(input.context.knownIds);

  generated.forEach((question, index) => {
    const reject = (reason: string) => {
      rejected.push({ reason, excerpt: excerpt(question.prompt) });
    };

    // ---- shared checks --------------------------------------------------

    if (accepted.some((prior) => nearlyIdentical(prior.prompt, question.prompt))) {
      reject('Duplicate of an earlier question in the same batch.');
      return;
    }

    const related = (question.relatedSemanticIds ?? []) as SemanticId[];
    const unknownRelated = related.filter((id) => !known.has(id));
    if (unknownRelated.length > 0) {
      reject(`References a structure not in this model: ${unknownRelated[0]}`);
      return;
    }

    const id = `${input.context.subject.semanticId}#q${index}`;
    const base = {
      id,
      semanticId: input.context.subject.semanticId,
      objective: input.objective,
      difficulty: input.difficulty,
      educationLevel: input.educationLevel,
      prompt: question.prompt,
      explanation: question.explanation,
      hint: question.hint ?? null,
      relatedSemanticIds: related,
      sourceStatus: input.sourceStatus,
    };

    // ---- per-kind checks ------------------------------------------------

    switch (question.kind) {
      case 'multiple_choice': {
        const correct = question.options.filter((option) => option.correct);

        if (correct.length === 0) {
          reject('Multiple-choice question has no correct option.');
          return;
        }
        if (correct.length > 1) {
          reject(`Multiple-choice question has ${correct.length} correct options; exactly one is required.`);
          return;
        }

        const labels = question.options.map((option) => signature(option.label));
        if (labels.some((label) => label.length === 0)) {
          reject('Multiple-choice question has an empty option.');
          return;
        }
        if (new Set(labels).size !== labels.length) {
          reject('Multiple-choice question has duplicate options.');
          return;
        }

        const answer = correct[0];
        if (!answer) {
          reject('Multiple-choice question has no resolvable correct option.');
          return;
        }
        if (promptRevealsAnswer(question.prompt, answer.label)) {
          reject('The prompt already contains the correct answer.');
          return;
        }

        const options = question.options.map((option, optionIndex) => ({
          id: `${id}o${optionIndex}`,
          label: option.label,
          correct: option.correct,
        }));
        const correctOption = options.find((option) => option.correct);
        if (!correctOption) {
          reject('Correct option did not survive normalisation.');
          return;
        }

        accepted.push({
          ...base,
          kind: 'multiple_choice',
          options,
          answer: { kind: 'choice', optionIds: [correctOption.id] } satisfies QuestionAnswerValue,
        });
        return;
      }

      case 'true_false': {
        if (typeof question.answer !== 'boolean') {
          reject('True/false question has no boolean answer.');
          return;
        }
        accepted.push({
          ...base,
          kind: 'true_false',
          options: [],
          answer: { kind: 'boolean', value: question.answer },
        });
        return;
      }

      case 'free_recall': {
        const answer = question.answer.trim();
        if (answer.length === 0) {
          reject('Short-answer question has an empty answer concept.');
          return;
        }
        if (promptRevealsAnswer(question.prompt, answer)) {
          reject('The prompt already contains the answer.');
          return;
        }
        accepted.push({
          ...base,
          kind: 'free_recall',
          options: [],
          answer: {
            kind: 'text',
            text: answer,
            acceptable: (question.acceptable ?? []).map((variant) => variant.trim()).filter(Boolean),
          },
        });
        return;
      }

      case 'identify_structure': {
        const target = question.targetSemanticId as SemanticId;

        if (!known.has(target)) {
          reject(`Identification target is not a structure in this model: ${question.targetSemanticId}`);
          return;
        }

        // The name must match what VEO holds. A question that names a
        // structure differently from the model sends the learner looking for
        // something that is not in the tree.
        const expected = nameFor(target, input.context);
        if (expected !== null && signature(expected) !== signature(question.targetName)) {
          reject(
            `Identification target name "${question.targetName}" does not match the model's "${expected}".`,
          );
          return;
        }
        if (promptRevealsAnswer(question.prompt, question.targetName)) {
          reject('The prompt already names the structure to identify.');
          return;
        }

        accepted.push({
          ...base,
          kind: 'identify_structure',
          options: [],
          answer: { kind: 'spatial', semanticId: target, name: expected ?? question.targetName },
        });
        return;
      }
    }
  });

  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

export function validateFlashcards(
  generated: readonly GeneratedFlashcard[],
  input: ValidationInput,
): ValidationOutcome<ValidatedFlashcard> {
  const accepted: ValidatedFlashcard[] = [];
  const rejected: RejectedItem[] = [];
  const known = new Set<SemanticId>(input.context.knownIds);

  generated.forEach((card, index) => {
    const reject = (reason: string) => {
      rejected.push({ reason, excerpt: excerpt(card.front) });
    };

    if (signature(card.front) === signature(card.back)) {
      reject('Front and back are the same, so the card tests nothing.');
      return;
    }

    if (promptRevealsAnswer(card.front, card.back)) {
      reject('The front already contains the whole answer.');
      return;
    }

    if (accepted.some((prior) => nearlyIdentical(prior.front, card.front))) {
      reject('Duplicate of an earlier card in the same batch.');
      return;
    }

    const related = (card.relatedSemanticIds ?? []) as SemanticId[];
    const unknownRelated = related.filter((id) => !known.has(id));
    if (unknownRelated.length > 0) {
      reject(`References a structure not in this model: ${unknownRelated[0]}`);
      return;
    }

    accepted.push({
      id: `${input.context.subject.semanticId}#c${index}`,
      semanticId: input.context.subject.semanticId,
      objective: input.objective,
      difficulty: input.difficulty,
      educationLevel: input.educationLevel,
      front: card.front,
      back: card.back,
      hint: card.hint ?? null,
      relatedSemanticIds: related,
      sourceStatus: input.sourceStatus,
    });
  });

  return { accepted, rejected };
}

/** VEO's own name for an id present in the learning context. */
function nameFor(id: SemanticId, context: LearningContext): string | null {
  if (context.subject.semanticId === id) return context.subject.name;
  for (const structure of context.distractorPool) {
    if (structure.semanticId === id) return structure.name;
  }
  return null;
}
