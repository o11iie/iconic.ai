import { describe, expect, it } from 'vitest';
import { ANATOMY_MODEL_CATALOG } from '@/anatomy/models/catalog';
import { SUBJECTS, findSubject, modelsForCategory, CONTENT_STATUS_LABEL } from './subjects';
import { ONBOARDING_DOMAINS, ONBOARDING_LEVELS, domainsForOption } from './onboarding';
import { KNOWLEDGE_DOMAINS, isKnownKnowledgeDomain } from '@/types/domain/primitives';
import { LEARNING_LEVELS } from '@/types/domain/user';

/**
 * Content honesty guards.
 *
 * Gate 2's hardest rule is that the interface must never imply content exists
 * before it does. These tests enforce that structurally: a category cannot
 * claim to be available unless the catalogue actually backs it, and the
 * onboarding groupings cannot drift away from the canonical domain registry.
 */

describe('subject catalogue', () => {
  it('never marks a category available without a model behind it', () => {
    for (const subject of SUBJECTS) {
      for (const category of subject.categories) {
        if (category.contentStatus === 'available') {
          expect(category.modelRefs.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('only references models that exist in the anatomy catalogue', () => {
    const known = new Set(ANATOMY_MODEL_CATALOG.map((entry) => entry.modelRef));
    for (const subject of SUBJECTS) {
      for (const category of subject.categories) {
        for (const ref of category.modelRefs) {
          expect(known.has(ref)).toBe(true);
        }
      }
    }
  });

  it('does not claim production anatomy content exists yet', () => {
    // Every anatomy model in the catalogue still requires a licensed asset, so
    // no anatomy category may advertise itself as available.
    expect(ANATOMY_MODEL_CATALOG.every((entry) => entry.licensedAssetRequired)).toBe(true);

    const anatomy = findSubject('anatomy');
    expect(anatomy).not.toBeNull();
    expect(anatomy?.contentStatus).not.toBe('available');
    expect(anatomy?.categories.some((category) => category.contentStatus === 'available')).toBe(
      false,
    );
  });

  it('uses canonical knowledge domains', () => {
    for (const subject of SUBJECTS) {
      expect(isKnownKnowledgeDomain(subject.domain)).toBe(true);
    }
  });

  it('resolves catalogue entries for a category', () => {
    const anatomy = findSubject('anatomy');
    const cardiovascular = anatomy?.categories.find((category) => category.id === 'cardiovascular');
    expect(cardiovascular).toBeDefined();
    expect(modelsForCategory(cardiovascular!).map((entry) => entry.modelRef)).toEqual(['heart']);
  });

  it('labels every content status', () => {
    for (const subject of SUBJECTS) {
      expect(CONTENT_STATUS_LABEL[subject.contentStatus]).toBeTruthy();
    }
  });
});

describe('onboarding options', () => {
  it('maps every grouping onto canonical domains', () => {
    const canonical = new Set<string>(KNOWLEDGE_DOMAINS);
    for (const option of ONBOARDING_DOMAINS) {
      for (const domain of option.domains) {
        expect(canonical.has(domain)).toBe(true);
      }
    }
  });

  it('allows an explicit "decide later" option with no domains', () => {
    expect(domainsForOption('other')).toEqual([]);
  });

  it('returns no domains for an unknown option rather than throwing', () => {
    expect(domainsForOption('not-a-real-option')).toEqual([]);
  });

  it('stores canonical learning levels while relabelling the first one', () => {
    const stored = ONBOARDING_LEVELS.map((option) => option.value);
    expect(stored).toEqual([...LEARNING_LEVELS]);
    // "Beginner" is the learner-facing word for the canonical `foundation`.
    expect(ONBOARDING_LEVELS[0]?.label).toBe('Beginner');
    expect(ONBOARDING_LEVELS[0]?.value).toBe('foundation');
  });
});
