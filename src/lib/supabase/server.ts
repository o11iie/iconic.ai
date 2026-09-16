import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilities, env } from '@/config/env';
import type { Database } from '@/types/database';

/**
 * Server Supabase client, bound to the request's cookies.
 *
 * Still uses the anon key: server code acting *on behalf of a user* must remain
 * subject to Row Level Security. Only `admin.ts` escalates, and only for
 * trusted system work.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database> | null> {
  if (!capabilities.supabase) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by middleware, so this is safe.
          }
        },
      },
    },
  );
}

/**
 * The authenticated user for this request, verified against Supabase Auth.
 *
 * Always uses `getUser()` rather than reading the session cookie directly:
 * `getUser()` validates the JWT with the auth server, so a forged or expired
 * cookie cannot produce a user here.
 */
export async function getServerUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
