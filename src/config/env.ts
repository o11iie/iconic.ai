import { z } from 'zod';

/**
 * CLIENT-SAFE environment.
 *
 * Only NEXT_PUBLIC_* values live here, so this module is safe to import from
 * anywhere, including Client Components. Server-only secrets live in
 * `env.server.ts`, which is hard-guarded by the `server-only` package.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time only for *statically analysable*
 * member expressions, which is why each value is read as an explicit
 * `process.env.NEXT_PUBLIC_X` literal rather than through a dynamic lookup.
 */

const optionalUrl = z
  .string()
  .trim()
  .url('Must be an absolute URL, e.g. https://example.com')
  .optional()
  .or(z.literal('').transform(() => undefined));

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .trim()
    .url()
    .default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .trim()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  NEXT_PUBLIC_ANATOMY_PROVIDER: z.string().trim().min(1).default('gltf-asset'),
  NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL: optionalUrl,
  NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ClientEnv = z.infer<typeof clientSchema>;

function readClientEnv(): ClientEnv {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_ANATOMY_PROVIDER: process.env.NEXT_PUBLIC_ANATOMY_PROVIDER,
    NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL: process.env.NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL,
    NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC: process.env.NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC,
  });

  if (!parsed.success) {
    // Misconfiguration is a startup-time bug, not a runtime condition to
    // paper over. Fail loudly with the exact offending keys.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid public environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env: ClientEnv = readClientEnv();

/**
 * Capability flags derived from configuration.
 *
 * The UI reads these to render an honest "not configured" state instead of a
 * control that silently does nothing.
 */
export const capabilities = {
  /** Supabase Auth + Postgres are reachable from the browser. */
  supabase: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  /** Stripe.js can be initialised for checkout. */
  stripeCheckout: Boolean(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  /** A licensed spatial asset source is configured. */
  spatialAssets: Boolean(env.NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL),
  /** The isolated, explicitly non-anatomical render-pipeline check is enabled. */
  pipelineDiagnostic: env.NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC,
} as const;

export type Capability = keyof typeof capabilities;
