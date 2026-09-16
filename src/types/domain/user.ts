import type { ISODateString, Metadata, Timestamped, UUID } from './primitives';

/**
 * The authenticated identity. Owned by Supabase Auth (`auth.users`); VEO never
 * writes to it directly.
 */
export interface User {
  readonly id: UUID;
  readonly email: string | null;
  readonly emailConfirmedAt: ISODateString | null;
  readonly lastSignInAt: ISODateString | null;
}

export const LEARNING_LEVELS = ['foundation', 'intermediate', 'advanced', 'professional'] as const;
export type LearningLevel = (typeof LEARNING_LEVELS)[number];

/**
 * Application-side user record (`public.profiles`), joined to `auth.users` by id.
 * This is what Row Level Security policies key against.
 */
export interface Profile extends Timestamped {
  readonly id: UUID;
  readonly userId: UUID;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly locale: string;
  readonly timezone: string;
  /** Completed the onboarding flow at least once. */
  readonly onboardedAt: ISODateString | null;
  readonly level: LearningLevel;
  /** Knowledge domains the learner selected during onboarding. */
  readonly interests: readonly string[];
  readonly preferences: ProfilePreferences;
  readonly metadata: Metadata;
}

export interface ProfilePreferences {
  /** Respect prefers-reduced-motion and damp camera transitions. */
  readonly reducedMotion: boolean;
  /** Render labels in the 3D viewport by default. */
  readonly showLabels: boolean;
  /** Target number of recall reviews per day. */
  readonly dailyRecallGoal: number;
}

export const DEFAULT_PROFILE_PREFERENCES: ProfilePreferences = {
  reducedMotion: false,
  showLabels: true,
  dailyRecallGoal: 20,
};
