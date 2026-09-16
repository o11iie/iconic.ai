/**
 * Site-level constants. Kept free of UI and rendering imports so it can be
 * used from metadata, middleware and server code alike.
 */
export const SITE = {
  name: 'VEO',
  pronunciation: 'Vee-oh',
  tagline: 'Learning you can see.',
  description:
    'VEO is a spatial-learning platform. Understand and remember complex subjects through interactive 3D models, AI tutoring, active recall and spaced repetition.',
} as const;

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  /** Icon name from the VEO icon set. */
  readonly icon: string;
  /** Which stage of the VEO learning loop this surface serves. */
  readonly loopStages: readonly string[];
  /** Carries the active model in the URL so navigating away and back resumes it. */
  readonly preservesSpatialContext?: boolean;
}

/**
 * Primary navigation, in learning-loop order.
 *
 * Settings is deliberately absent: it lives in the account menu so the primary
 * navigation stays about learning rather than administration.
 */
export const APP_NAV: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Home',
    description: 'What to do next.',
    icon: 'home',
    loopStages: ['review'],
  },
  {
    href: '/learn',
    label: 'Learn',
    description: 'Browse subjects and material.',
    icon: 'learn',
    loopStages: ['understand', 'structure', 'ask'],
  },
  {
    href: '/explore',
    label: 'Explore',
    description: 'See and manipulate models.',
    icon: 'explore',
    loopStages: ['explore', 'connect'],
    preservesSpatialContext: true,
  },
  {
    href: '/recall',
    label: 'Recall',
    description: 'Retrieve it from memory.',
    icon: 'recall',
    loopStages: ['recall', 'apply', 'remember'],
  },
  {
    href: '/library',
    label: 'Library',
    description: 'Your saved work.',
    icon: 'library',
    loopStages: ['upload'],
  },
];

/** Reachable from the account menu, not the primary rail. */
export const SECONDARY_NAV: readonly NavItem[] = [
  {
    href: '/settings',
    label: 'Settings',
    description: 'Account and preferences.',
    icon: 'settings',
    loopStages: [],
  },
];

/** Legal links shown on auth screens and in the footer. */
export const LEGAL_LINKS = [
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
] as const;

/** The canonical VEO learning loop, used by the dashboard and docs. */
export const LEARNING_LOOP: readonly { stage: string; label: string; summary: string }[] = [
  { stage: 'upload', label: 'Upload', summary: 'Bring in your own material, or pick a subject.' },
  { stage: 'understand', label: 'Understand', summary: 'Break dense material into clear concepts.' },
  { stage: 'structure', label: 'Structure', summary: 'Organise concepts into a navigable map.' },
  { stage: 'explore', label: 'Explore', summary: 'See it in space. Rotate it. Take it apart.' },
  { stage: 'ask', label: 'Ask', summary: 'Question the model and the tutor directly.' },
  { stage: 'connect', label: 'Connect', summary: 'Link concepts to what you already know.' },
  { stage: 'recall', label: 'Recall', summary: 'Retrieve it from memory, not from the page.' },
  { stage: 'apply', label: 'Apply', summary: 'Use it on problems that look like the real thing.' },
  { stage: 'review', label: 'Review', summary: 'Return exactly when you are about to forget.' },
  { stage: 'remember', label: 'Remember', summary: 'Keep it, long after the exam.' },
];
