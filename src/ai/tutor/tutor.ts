import type { SemanticId } from '@/lib/semantic-id';
import type { LLMMessage } from '../client';

/**
 * Tutor context.
 *
 * VEO's tutor is differentiated by knowing *what the learner is looking at*.
 * The context carries the selected structure's semantic id and the surrounding
 * model, so the tutor can answer "what is this?" about the actual thing on
 * screen rather than a generic question.
 *
 * This module builds prompts only — it performs no I/O and holds no key, so it
 * is safe to unit-test and to reason about independently of any vendor.
 */

export interface TutorContext {
  /** Structure currently selected in the viewport, if any. */
  readonly focusedObjectId: SemanticId | null;
  readonly focusedObjectName: string | null;
  readonly modelName: string | null;
  readonly domain: string;
  /** Learner level, so explanations land at the right depth. */
  readonly level: string;
  /** Titles of the learner's own material, to ground answers in their syllabus. */
  readonly materialTitles: readonly string[];
}

export const TUTOR_SYSTEM_PROMPT = `You are the VEO tutor. VEO is a spatial-learning platform: the learner is looking at an interactive 3D model while you talk to them.

Rules:
- Be precise and concise. Prefer the correct technical term, then explain it.
- Reference what the learner can see. If a structure is in focus, anchor your answer to it and to its spatial relationships.
- Never invent anatomical, physical or chemical facts. If you are not certain, say what is known and what is not.
- Do not describe parts of the model you have not been told are present.
- Match the learner's stated level. Do not oversimplify for advanced learners or overwhelm beginners.
- When a concept is worth retaining, say so plainly so it can be turned into recall material.`;

/** Build the message list for a tutor turn. */
export function buildTutorMessages(
  context: TutorContext,
  question: string,
  history: readonly LLMMessage[] = [],
): LLMMessage[] {
  const contextLines: string[] = [
    `Domain: ${context.domain}`,
    `Learner level: ${context.level}`,
  ];

  if (context.modelName) contextLines.push(`Model on screen: ${context.modelName}`);

  if (context.focusedObjectId) {
    contextLines.push(
      `Currently selected structure: ${context.focusedObjectName ?? context.focusedObjectId} (VEO id: ${context.focusedObjectId})`,
    );
  } else {
    contextLines.push('No structure is currently selected.');
  }

  if (context.materialTitles.length > 0) {
    contextLines.push(`Learner's own material: ${context.materialTitles.join('; ')}`);
  }

  return [
    { role: 'system', content: TUTOR_SYSTEM_PROMPT },
    { role: 'system', content: `Current context:\n${contextLines.join('\n')}` },
    ...history,
    { role: 'user', content: question },
  ];
}
