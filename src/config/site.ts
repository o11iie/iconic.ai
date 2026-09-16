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
  /** Which stage of the VEO learning loop this surface serves. */
  readonly loopStages: readonly string[];
}

/** Primary application navigation, in learning-loop order. */
export const APP_NAV: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    description: 'Where you are across every subject.',
    loopStages: ['review'],
  },
  {
    href: '/explore',
    label: 'Explore',
    description: 'See and manipulate spatial models.',
    loopStages: ['explore', 'connect'],
  },
  {
    href: '/learn',
    label: 'Learn',
    description: 'Work through structured material with the tutor.',
    loopStages: ['understand', 'structure', 'ask'],
  },
  {
    href: '/recall',
    label: 'Recall',
    description: 'Active recall and spaced repetition.',
    loopStages: ['recall', 'apply', 'remember'],
  },
  {
    href: '/library',
    label: 'Library',
    description: 'Your uploaded material and generated study sets.',
    loopStages: ['upload'],
  },
];

export const SECONDARY_NAV: readonly NavItem[] = [
  {
    href: '/settings',
    label: 'Settings',
    description: 'Account, appearance and learning preferences.',
    loopStages: [],
  },
];

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
