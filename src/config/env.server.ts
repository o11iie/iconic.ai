import 'server-only';

import { z } from 'zod';

/**
 * SERVER-ONLY environment.
 *
 * The `server-only` import above makes this module a build error if it is ever
 * reached from a Client Component, so a service-role key cannot leak into a
 * browser bundle by accident. ESLint additionally forbids importing this path
 * from `src/components`, `src/store` and `src/hooks`.
 *
 * Secrets are read lazily: the app must boot in environments where optional
 * integrations are simply not configured yet.
 */

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_MODEL: z.string().trim().min(1).default('gpt-4o-mini'),
  STRIPE_SECRET_KEY: z.string().trim().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: emptyToUndefined(process.env.SUPABASE_SERVICE_ROLE_KEY),
    OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
    OPENAI_MODEL: emptyToUndefined(process.env.OPENAI_MODEL),
    STRIPE_SECRET_KEY: emptyToUndefined(process.env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: emptyToUndefined(process.env.STRIPE_WEBHOOK_SECRET),
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Server-side capability flags, mirroring the client ones. */
export function serverCapabilities() {
  const e = serverEnv();
  return {
    supabaseAdmin: Boolean(e.SUPABASE_SERVICE_ROLE_KEY),
    openai: Boolean(e.OPENAI_API_KEY),
    stripe: Boolean(e.STRIPE_SECRET_KEY),
    stripeWebhooks: Boolean(e.STRIPE_WEBHOOK_SECRET),
  } as const;
}

/**
 * Read a required secret or fail with an actionable message naming the exact
 * variable and where to set it.
 */
export function requireSecret(key: keyof ServerEnv): string {
  const value = serverEnv()[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${key}. Add it to .env.local (see .env.example) or to your deployment's environment configuration.`,
    );
  }
  return value;
}
