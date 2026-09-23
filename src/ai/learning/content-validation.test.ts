import { describe, expect, it } from 'vitest';
import { buildTutorFixtureGraph, TUTOR_FIXTURE_IDS } from '../fixtures/tutor-fixture';
import { nearlyIdentical, promptRevealsAnswer, signature } from './content-validation';
import { buildLearningContext, explainUnsupported } from './learning-context';
import { GENERATED_QUESTION_KINDS } from './learning-types';
import { QUESTION_KINDS } from '@/types/domain/learning';

/**
 * The validation primitives, tested in both directions.
 *
 * A duplicate detector that flags everything passes every "did it catch the
 * duplicate?" assertion while making the product unable to generate a second
 * question. So each rule that must FIRE is paired with a case that must NOT.
 */

describe('text signatures', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(signature('What IS the Core Unit?')).toBe(signature('what  is the core unit'));
  });

  it('keeps genuinely different text different', () => {
    expect(signature('What is the Core Unit?')).not.toBe(signature('What does the Core Unit do?'));
  });
});

describe('duplicate detection', () => {
  it('catches a rewording that differs only in punctuation', () => {
    expect(nearlyIdentical('The Core Unit sits in Assembly A.', 'The Core Unit sits in Assembly A!')).toBe(true);
  });

  it('catches a reordering that keeps the same words', () => {
    expect(
      nearlyIdentical('The Core Unit sits inside Assembly A', 'Inside Assembly A sits the Core Unit'),
    ).toBe(true);
  });

  it('does NOT catch a full paraphrase, and that is a known limit', () => {
    /*
     * "Which structure contains the Core Unit?" and "The Core Unit is
     * contained by which structure?" are the same question, and token overlap
     * scores them 0.56 — below the threshold.
     *
     * Lowering the threshold to catch it would put it within 0.06 of merging
     * "What does the Core Unit do?" with "What does the Outer Shell do?",
     * which are different questions about different structures. Token overlap
     * cannot separate those two cases, so the threshold is set where it
     * reliably catches what a generator actually repeats — near-identical
     * text — and paraphrase is left to the prompt, which asks for variety.
     *
     * Catching paraphrase properly needs embeddings. That is a different
     * system, and pretending this one does it would be worse than saying so.
     */
    expect(
      nearlyIdentical('Which structure contains the Core Unit?', 'The Core Unit is contained by which structure?'),
    ).toBe(false);
  });

  it('does NOT merge two genuinely different questions', () => {
    // The failure that would matter more: a detector this aggressive would
    // silently cap every batch at one item.
    expect(
      nearlyIdentical('What is the Core Unit?', 'Which assembly contains the Outer Shell?'),
    ).toBe(false);
  });

  it('does not merge questions about different structures', () => {
    expect(
      nearlyIdentical('What does the Core Unit do?', 'What does the Outer Shell do?'),
    ).toBe(false);
  });

  it('handles empty input without claiming a match', () => {
    expect(nearlyIdentical('', 'anything at all')).toBe(false);
  });
});

describe('prompts that give away the answer', () => {
  it('catches a prompt containing every distinctive word of its answer', () => {
    expect(promptRevealsAnswer('Is the Core Unit called the Core Unit?', 'Core Unit')).toBe(true);
  });

  it('allows a prompt that names a related structure', () => {
    // A question about how two things connect has to name one of them.
    expect(
      promptRevealsAnswer('Which structure does the Transfer Conduit connect to?', 'Core Unit'),
    ).toBe(false);
  });

  it('ignores short filler words when deciding', () => {
    expect(promptRevealsAnswer('Is it the one that does the thing?', 'the')).toBe(false);
  });
});

describe('the generated kinds stay a subset of the domain', () => {
  it('generates only kinds the platform already declares', () => {
    // Gate 11 narrows what the AI may WRITE without narrowing what a Question
    // may BE: an authored order_sequence question is still perfectly valid.
    for (const kind of GENERATED_QUESTION_KINDS) {
      expect(QUESTION_KINDS).toContain(kind);
    }
  });

  it('leaves the kinds needing data no model supplies ungenerated', () => {
    expect(GENERATED_QUESTION_KINDS).not.toContain('order_sequence');
    expect(GENERATED_QUESTION_KINDS).not.toContain('label_diagram');
  });
});

describe('objective support is derived from the data', () => {
  const graph = buildTutorFixtureGraph();

  function contextFor(semanticId: string) {
    const built = buildLearningContext({ graph, semanticId, isFixture: true });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('context failed');
    return built.context;
  }

  it('supports everything for a fully described structure', () => {
    const context = contextFor(TUTOR_FIXTURE_IDS.coreUnit);
    for (const objective of ['IDENTIFY', 'DEFINE', 'FUNCTION', 'RELATE', 'LOCATE'] as const) {
      expect(context.supports).toContain(objective);
    }
  });

  it('withholds DEFINE and FUNCTION where the model supplies no prose', () => {
    const context = contextFor(TUTOR_FIXTURE_IDS.transferConduit);
    expect(context.supports).not.toContain('DEFINE');
    expect(context.supports).not.toContain('FUNCTION');
    // But structural objectives remain available, so the structure is not
    // written off entirely.
    expect(context.supports).toContain('RELATE');
    expect(context.supports).toContain('IDENTIFY');
  });

  it('reports insufficient context for a structure with nothing but a name', () => {
    const context = contextFor(TUTOR_FIXTURE_IDS.unmarkedElement);
    expect(context.sourceStatus).toBe('insufficient-context');
  });

  it('explains an unsupported objective in words an operator can act on', () => {
    const context = contextFor(TUTOR_FIXTURE_IDS.transferConduit);
    const reason = explainUnsupported(context, 'FUNCTION');

    expect(reason).toContain('Transfer Conduit');
    expect(reason).toContain('no function');
    // Not a stack trace, not a code.
    expect(reason).not.toContain('Error');
    expect(reason).not.toContain('undefined');
  });
});

describe('the learning context carries only what a question needs', () => {
  const built = buildLearningContext({
    graph: buildTutorFixtureGraph(),
    semanticId: TUTOR_FIXTURE_IDS.coreUnit,
    isFixture: true,
  });

  it('builds facts from the fields the model supplies', () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const sources = built.context.facts.map((fact) => fact.source);
    expect(sources).toContain('name');
    expect(sources).toContain('description');
    expect(sources).toContain('function');
    expect(sources).toContain('parent');
  });

  it('offers real structures as distractors, never invented ones', () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.context.distractorPool.length).toBeGreaterThan(0);
    for (const structure of built.context.distractorPool) {
      expect(built.context.knownIds).toContain(structure.semanticId);
      expect(structure.semanticId).not.toBe(built.context.subject.semanticId);
    }
  });

  it('carries no geometry, mesh names or viewport state', () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const serialised = JSON.stringify(built.context);
    expect(serialised).not.toContain('Fixture_Core_Unit');
    expect(serialised).not.toContain('boundingBox');
    expect(serialised).not.toContain('isolatedId');
    expect(serialised).not.toContain('visibility');
  });

  it('produces the same context twice for the same structure', () => {
    const again = buildLearningContext({
      graph: buildTutorFixtureGraph(),
      semanticId: TUTOR_FIXTURE_IDS.coreUnit,
      isFixture: true,
    });

    expect(built.ok && again.ok).toBe(true);
    if (!built.ok || !again.ok) return;
    expect(JSON.stringify(built.context)).toBe(JSON.stringify(again.context));
  });
});
