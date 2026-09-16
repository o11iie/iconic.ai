import { create } from 'zustand';
import type { Profile, User } from '@/types/domain/user';
import type { Entitlement, Subscription } from '@/types/domain/billing';

/**
 * Auth store — client-side mirror of the authenticated session.
 *
 * SECURITY: this is a *cache for rendering*, never an authority. Every
 * protected action is re-verified server-side against the Supabase session and
 * Row Level Security. Nothing here may be trusted to grant access, which is why
 * `hasEntitlement` is documented as a UI hint only.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  subscription: Subscription | null;
  entitlements: readonly Entitlement[];
  error: string | null;
}

export interface AuthActions {
  setSession: (user: User | null, profile: Profile | null) => void;
  setProfile: (profile: Profile | null) => void;
  setSubscription: (subscription: Subscription | null) => void;
  setEntitlements: (entitlements: readonly Entitlement[]) => void;
  setStatus: (status: AuthStatus) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

const initialState: AuthState = {
  status: 'loading',
  user: null,
  profile: null,
  subscription: null,
  entitlements: [],
  error: null,
};

export const useAuthStore = create<AuthState & AuthActions>()((set) => ({
  ...initialState,

  setSession: (user, profile) =>
    set({
      user,
      profile,
      status: user ? 'authenticated' : 'unauthenticated',
      error: null,
    }),

  setProfile: (profile) => set({ profile }),
  setSubscription: (subscription) => set({ subscription }),
  setEntitlements: (entitlements) => set({ entitlements }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: error ? 'error' : 'unauthenticated' }),

  clear: () => set({ ...initialState, status: 'unauthenticated' }),
}));

export const useUser = () => useAuthStore((s) => s.user);
export const useProfile = () => useAuthStore((s) => s.profile);
export const useAuthStatus = () => useAuthStore((s) => s.status);
export const useIsAuthenticated = () => useAuthStore((s) => s.status === 'authenticated');

/**
 * UI HINT ONLY. Use to hide controls the user cannot use — never to protect a
 * resource. The server re-checks entitlement on every gated action.
 */
export function useEntitlementHint(key: string): boolean {
  return useAuthStore((s) => s.entitlements.some((e) => e.key === key && e.granted));
}
