/**
 * Shared form state for the auth actions.
 *
 * Deliberately NOT in `actions.ts`: a `'use server'` module may only export
 * async functions, so any constant or type shared with client components has
 * to live in a plain module alongside it.
 */
export interface AuthFormState {
  readonly error: string | null;
  readonly notice: string | null;
}

export const EMPTY_AUTH_STATE: AuthFormState = { error: null, notice: null };
