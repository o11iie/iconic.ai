import type { KnowledgeDomain } from '@/types/domain/primitives';
import type { LearningLevel } from '@/types/domain/user';

/**
 * Onboarding options.
 *
 * These are *presentation groupings* over the canonical knowledge domains in
 * `types/domain/primitives`. A learner thinks "Earth & space", not
 * "earth_sciences, astrophysics", so the UI groups them while the profile
 * stores the canonical ids — which keeps the data model domain-agnostic and
 * the interface human.
 */

export interface OnboardingDomainOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  /** Canonical domains this option maps onto when written to the profile. */
  readonly domains: readonly KnowledgeDomain[];
}

export const ONBOARDING_DOMAINS: readonly OnboardingDomainOption[] = [
  {
    id: 'health_sciences',
    label: 'Health sciences',
    description: 'Anatomy, physiology, medicine',
    icon: 'recall',
    domains: ['anatomy', 'health_sciences'],
  },
  {
    id: 'engineering',
    label: 'Engineering',
    description: 'Mechanical, civil, electrical',
    icon: 'layers',
    domains: ['engineering'],
  },
  {
    id: 'science',
    label: 'Science',
    description: 'Chemistry and physics',
    icon: 'orbit',
    domains: ['chemistry', 'physics'],
  },
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'Structures and the built world',
    icon: 'explore',
    domains: ['architecture'],
  },
  {
    id: 'computing',
    label: 'Computing',
    description: 'Systems, networks, architecture',
    icon: 'card',
    domains: ['computing'],
  },
  {
    id: 'earth_space',
    label: 'Earth & space',
    description: 'Geology, climate, astrophysics',
    icon: 'shield',
    domains: ['earth_sciences', 'astrophysics'],
  },
  {
    id: 'other',
    label: 'Something else',
    description: "I'll decide later",
    icon: 'plus',
    domains: [],
  },
];

export interface LevelOption {
  readonly value: LearningLevel;
  readonly label: string;
  readonly description: string;
}

/**
 * "Beginner" is the learner-facing word for the canonical `foundation` level;
 * the stored value stays stable while the label can be reworded freely.
 */
export const ONBOARDING_LEVELS: readonly LevelOption[] = [
  { value: 'foundation', label: 'Beginner', description: 'New to the subject' },
  { value: 'intermediate', label: 'Intermediate', description: 'Studying it now' },
  { value: 'advanced', label: 'Advanced', description: 'Deep into the detail' },
  { value: 'professional', label: 'Professional', description: 'I work in this field' },
];

export const ONBOARDING_GOALS = [
  { id: 'understand', label: 'Understand difficult concepts' },
  { id: 'exams', label: 'Prepare for exams' },
  { id: 'memory', label: 'Build long-term memory' },
  { id: 'systems', label: 'Explore complex systems' },
  { id: 'visual', label: 'Learn visually' },
] as const;

export type OnboardingGoalId = (typeof ONBOARDING_GOALS)[number]['id'];

export function domainsForOption(optionId: string): readonly KnowledgeDomain[] {
  return ONBOARDING_DOMAINS.find((option) => option.id === optionId)?.domains ?? [];
}
