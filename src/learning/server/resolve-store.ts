import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { UUID } from '@/types/domain/primitives';
import type { LearningStore } from '../store';
import { SupabaseLearningStore } from '../supabase-store';

/**
 * Resolving WHO is asking and WHERE their data lives.
 *
 * These two decisions are made in exactly one place, because getting either
 * wrong in one route undoes the protection everywhere else.
 *
 * ## Identity
 *
 * The user id comes from `auth.getUser()`, which validates the JWT against
 * Supabase Auth. It is never read from the request body, the query string, a
 * header, or anything else a browser controls. Routes do not receive a
 * `userId` parameter to forget to check — they receive a resolved session or
 * a refusal.
 *
 * This is belt and braces with RLS, deliberately. The policies would refuse a
 * forged row regardless, and the migration's verification proves that by
 * execution against real PostgreSQL. But a route that trusted a body-supplied
 * id would still leak *reads* of anything the policy happened to permit, so
 * the application must not have the option in the first place.
 *
 * ## There is no offline mode here, on purpose
 *
 * An in-memory store exists (`memory-store.ts`) and the route tests drive the
 * real handlers through it. It is deliberately NOT selectable at runtime.
 *
 * A flag that swapped persistence would have to answer "who is the learner?"
 * in a deployment that has no authentication — Supabase is what provides it —
 * and the only answers are a fabricated identity or a shared one. Both are
 * auth bypasses living in production code behind an environment variable,
 * which is precisely the shape of mistake that ships.
 *
 * An earlier revision of this file did have such a branch. It was removed
 * after a probe showed it could never serve a request anyway: it required
 * Supabase to be ABSENT, and without Supabase `getServerUser()` has nothing
 * to validate against, so every request resolved to `unauthenticated`. Dead
 * code that looks like a working offline mode is worse than none, because the
 * obvious way to "fix" it is to skip the identity check.
 *
 * Without Supabase, VEO says the learning schedule is not configured — the
 * same thing every other persisted feature says, and the truth.
 */

export const RESOLVE_FAILURES = ['unauthenticated', 'not_configured'] as const;
export type ResolveFailure = (typeof RESOLVE_FAILURES)[number];

export type ResolvedLearning =
  | {
      readonly ok: true;
      readonly userId: UUID;
      readonly store: LearningStore;
    }
  | { readonly ok: false; readonly reason: ResolveFailure };

export async function resolveLearning(): Promise<ResolvedLearning> {
  const client = await createSupabaseServerClient();
  if (!client) return { ok: false, reason: 'not_configured' };

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, reason: 'unauthenticated' };

  return {
    ok: true,
    userId: data.user.id as UUID,
    // Built from the REQUEST's client, which carries the user's cookies and
    // the anon key — so every statement it issues runs under that user's RLS
    // context. The service-role client is never used for learner data.
    store: new SupabaseLearningStore(client),
  };
}
