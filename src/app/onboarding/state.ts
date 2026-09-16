/**
 * Onboarding form state. Separate from `actions.ts` because a `'use server'`
 * module may only export async functions.
 */
export interface OnboardingState {
  readonly error: string | null;
  readonly saved: boolean;
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = { error: null, saved: false };
