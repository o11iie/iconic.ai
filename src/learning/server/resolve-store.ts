import 'server-only';

import { getServerUser, createSupabaseServerClient } from '@/lib/supabase/server';
import type { UUID } from '@/types/domain/primitives';
import type { LearningStore } from '../store';
import { InMemoryLearningStore } from '../memory-store';
import { SupabaseLearningStore } from '../supabase-store';

/**
 * Resolving WHO is asking and WHERE their data lives.
 *
 * These two decisions are made in exactly one place, because getting either
 * wrong in one route undoes the protection everywhere else.
 *
 * ## Identity
 *
 * The user id comes from `getServerUser()`, which validates the JWT against
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
 * ## The verification store
 *
 * `VEO_LEARNING_MEMORY_STORE` swaps in the in-memory implementation so the
 * browser suite can drive the real review UI without a database. It is read
 * as a LITERAL `process.env` member, not a computed key: Next inlines these at
 * build time and eliminates the dead branch, so a computed lookup reads a
 * build-time snapshot and silently never activates.
 *
 * It refuses to engage when Supabase is configured. A flag that could shadow a
 * real database would be one environment variable away from showing a learner
 * an empty history and recording their session into a process that is about to
 * be recycled.
 */

export const MEMORY_STORE_ENV_VAR = 'VEO_LEARNING_MEMORY_STORE';

/** Process-wide, so a session survives across requests while the flag is on. */
let memoryStore: InMemoryLearningStore | null = null;

export function memoryStoreEnabled(): boolean {
  if (process.env.VEO_LEARNING_MEMORY_STORE !== '1') return false;

  // Never shadow a configured database.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return false;
  }

  return true;
}

function getMemoryStore(): InMemoryLearningStore {
  memoryStore ??= new InMemoryLearningStore();
  return memoryStore;
}

export const RESOLVE_FAILURES = ['unauthenticated', 'not_configured'] as const;
export type ResolveFailure = (typeof RESOLVE_FAILURES)[number];

export type ResolvedLearning =
  | {
      readonly ok: true;
      readonly userId: UUID;
      readonly store: LearningStore;
      /** True when the in-memory store is serving. The UI says so. */
      readonly ephemeral: boolean;
    }
  | { readonly ok: false; readonly reason: ResolveFailure };

/**
 * The authenticated learner and their store, or a refusal.
 *
 * Order matters: identity first. An unauthenticated request is refused before
 * anything looks at a store, so "not configured" can never be used to probe
 * whether a deployment has a database while signed out.
 */
export async function resolveLearning(): Promise<ResolvedLearning> {
  if (memoryStoreEnabled()) {
    // Even here the identity must be real. The flag swaps persistence, never
    // authentication — otherwise the verification build would be a way to
    // review as anybody.
    const user = await getServerUser();
    if (!user) return { ok: false, reason: 'unauthenticated' };

    return {
      ok: true,
      userId: user.id as UUID,
      store: getMemoryStore(),
      ephemeral: true,
    };
  }

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
    ephemeral: false,
  };
}

/** Test seam: discard in-memory state between browser verification runs. */
export function resetMemoryStore(): void {
  memoryStore?.reset();
}
