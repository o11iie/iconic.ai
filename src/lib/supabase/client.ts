'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilities, env } from '@/config/env';
import type { Database } from '@/types/database';

/**
 * Browser Supabase client.
 *
 * Uses the anon key only. Everything it can do is bounded by the Row Level
 * Security policies in supabase/migrations — the browser is never trusted.
 *
 * Returns null when Supabase is not configured so the app still boots and the
 * UI can say so, rather than throwing on import during local setup.
 */

let client: SupabaseClient<Database> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (!capabilities.supabase) return null;
  if (client) return client;

  client = createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );

  return client;
}

/** Use where Supabase is genuinely required; fails with an actionable message. */
export function requireSupabaseBrowserClient(): SupabaseClient<Database> {
  const instance = getSupabaseBrowserClient();
  if (!instance) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).',
    );
  }
  return instance;
}
