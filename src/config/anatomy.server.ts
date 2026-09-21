import 'server-only';

import { z } from 'zod';

/**
 * SERVER-ONLY anatomy provider configuration.
 *
 * Every licensed anatomy source of any consequence authenticates. An API key,
 * a licence token, a signing secret for time-limited asset URLs — none of
 * those may reach a browser bundle, because a key in a bundle is a key that
 * has been published.
 *
 * The `server-only` import makes this file a build error if a Client Component
 * ever imports it, so the boundary is enforced by the compiler rather than by
 * remembering.
 *
 * ## The access shape
 *
 *     browser  →  VEO server  →  licensed provider  →  temporary resource
 *
 * The browser never holds a provider credential and never talks to the
 * provider directly. It asks VEO for a model; VEO authenticates, resolves a
 * short-lived URL, and hands back only that. When the licence permits plain
 * public asset hosting, the same route simply returns the public URL — one
 * path through the code either way, so the secure case is not the exceptional
 * one nobody exercises.
 */

const schema = z.object({
  /**
   * Which provider implementation serves anatomy in this deployment.
   *
   * Mirrors NEXT_PUBLIC_ANATOMY_PROVIDER, which the browser reads to construct
   * the client-side provider. They must agree; `anatomyProviderConfig` reports
   * when they do not rather than silently preferring one.
   */
  ANATOMY_PROVIDER: z.string().trim().min(1).optional(),

  /** Base URL of the licensed asset host, when assets are served directly. */
  ANATOMY_ASSET_BASE_URL: z.string().trim().url().optional(),

  /** API key or licence token for a hosted anatomy provider. NEVER public. */
  ANATOMY_PROVIDER_API_KEY: z.string().trim().min(1).optional(),

  /** Base URL of the hosted provider's API. */
  ANATOMY_PROVIDER_API_URL: z.string().trim().url().optional(),

  /** Secret used to sign time-limited asset URLs. NEVER public. */
  ANATOMY_ASSET_SIGNING_SECRET: z.string().trim().min(1).optional(),

  /** Seconds a signed asset URL stays valid. Short by default. */
  ANATOMY_ASSET_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  // ---- licence record, for compliance rather than enforcement -------------
  ANATOMY_LICENCE_HOLDER: z.string().trim().min(1).optional(),
  ANATOMY_LICENCE_KIND: z
    .enum(['licensed_sdk', 'licensed_asset', 'veo_owned', 'open_source'])
    .optional(),
  ANATOMY_LICENCE_APPLICATION: z.string().trim().min(1).optional(),
  ANATOMY_LICENCE_EXPIRES_AT: z.string().trim().min(1).optional(),
});

export type AnatomyServerEnv = z.infer<typeof schema>;

let cached: AnatomyServerEnv | null = null;

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function anatomyServerEnv(): AnatomyServerEnv {
  if (cached) return cached;

  const parsed = schema.safeParse({
    ANATOMY_PROVIDER: emptyToUndefined(process.env.ANATOMY_PROVIDER),
    ANATOMY_ASSET_BASE_URL: emptyToUndefined(process.env.ANATOMY_ASSET_BASE_URL),
    ANATOMY_PROVIDER_API_KEY: emptyToUndefined(process.env.ANATOMY_PROVIDER_API_KEY),
    ANATOMY_PROVIDER_API_URL: emptyToUndefined(process.env.ANATOMY_PROVIDER_API_URL),
    ANATOMY_ASSET_SIGNING_SECRET: emptyToUndefined(process.env.ANATOMY_ASSET_SIGNING_SECRET),
    ANATOMY_ASSET_URL_TTL_SECONDS: emptyToUndefined(process.env.ANATOMY_ASSET_URL_TTL_SECONDS),
    ANATOMY_LICENCE_HOLDER: emptyToUndefined(process.env.ANATOMY_LICENCE_HOLDER),
    ANATOMY_LICENCE_KIND: emptyToUndefined(process.env.ANATOMY_LICENCE_KIND),
    ANATOMY_LICENCE_APPLICATION: emptyToUndefined(process.env.ANATOMY_LICENCE_APPLICATION),
    ANATOMY_LICENCE_EXPIRES_AT: emptyToUndefined(process.env.ANATOMY_LICENCE_EXPIRES_AT),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid anatomy provider configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Reset between tests. Not used at runtime. */
export function resetAnatomyServerEnv(): void {
  cached = null;
}

export interface AnatomyProviderConfig {
  /** True when this deployment can actually serve anatomy geometry. */
  readonly configured: boolean;
  /** Why not, when it cannot. Rendered to the learner verbatim. */
  readonly reason: string | null;
  readonly providerId: string;
  /** How the browser reaches the geometry. */
  readonly delivery: 'public_asset' | 'server_mediated' | 'none';
  readonly licence: {
    readonly holder: string | null;
    readonly kind: string | null;
    readonly application: string | null;
    readonly expiresAt: string | null;
    readonly expired: boolean;
  };
}

/**
 * What this deployment is configured to serve, with no secret in the result.
 *
 * Safe to send to a browser: it reports whether a key exists, never the key.
 */
export function anatomyProviderConfig(publicProviderId: string): AnatomyProviderConfig {
  const e = anatomyServerEnv();
  const providerId = e.ANATOMY_PROVIDER ?? publicProviderId;

  const expiresAt = e.ANATOMY_LICENCE_EXPIRES_AT ?? null;
  const expired = expiresAt !== null && Number.isFinite(Date.parse(expiresAt))
    ? Date.parse(expiresAt) < Date.now()
    : false;

  const licence = {
    holder: e.ANATOMY_LICENCE_HOLDER ?? null,
    kind: e.ANATOMY_LICENCE_KIND ?? null,
    application: e.ANATOMY_LICENCE_APPLICATION ?? null,
    expiresAt,
    expired,
  };

  if (e.ANATOMY_PROVIDER && e.ANATOMY_PROVIDER !== publicProviderId) {
    return {
      configured: false,
      reason: `Server and client disagree about the anatomy provider: the server is configured for "${e.ANATOMY_PROVIDER}" and the browser for "${publicProviderId}". Set both to the same value.`,
      providerId,
      delivery: 'none',
      licence,
    };
  }

  if (expired) {
    return {
      configured: false,
      reason: `The configured anatomy licence expired on ${expiresAt}. VEO will not serve content it is no longer entitled to.`,
      providerId,
      delivery: 'none',
      licence,
    };
  }

  const hasHostedApi = Boolean(e.ANATOMY_PROVIDER_API_URL && e.ANATOMY_PROVIDER_API_KEY);
  const hasSignedAssets = Boolean(e.ANATOMY_ASSET_BASE_URL && e.ANATOMY_ASSET_SIGNING_SECRET);
  const hasPublicAssets = Boolean(e.ANATOMY_ASSET_BASE_URL);

  if (hasHostedApi || hasSignedAssets) {
    return { configured: true, reason: null, providerId, delivery: 'server_mediated', licence };
  }

  if (hasPublicAssets) {
    return { configured: true, reason: null, providerId, delivery: 'public_asset', licence };
  }

  return {
    configured: false,
    reason:
      'No licensed anatomy source is configured on the server. Set ANATOMY_ASSET_BASE_URL for a licensed asset host, or ANATOMY_PROVIDER_API_URL and ANATOMY_PROVIDER_API_KEY for a hosted anatomy provider.',
    providerId,
    delivery: 'none',
    licence,
  };
}
