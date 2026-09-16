import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import { requireSecret, serverCapabilities } from '@/config/env.server';
import type { Database } from '@/types/database';

/**
 * PRIVILEGED Supabase client. Bypasses Row Level Security entirely.
 *
 * Use ONLY for trusted system work that cannot be expressed as the acting user:
 * Stripe webhook reconciliation, scheduled jobs, administrative backfills.
 *
 * Guards in place:
 *   * `server-only` makes importing this from a Client Component a build error
 *   * ESLint forbids importing it from src/components, src/store and src/hooks
 *   * the service-role key is never prefixed NEXT_PUBLIC_
 *
 * Never pass user-supplied identifiers into a query made with this client
 * without validating authorization yourself first — RLS is not there to help.
 */

let adminClient: SupabaseClient<Database> | null = null;

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL) && serverCapabilities().supabaseAdmin;
}

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;

  if (!env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to create the Supabase admin client.');
  }

  adminClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    requireSecret('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  return adminClient;
}
