import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  TMDB_API_KEY: z.string().optional().default(""),
  TWITCH_CLIENT_ID: z.string().optional().default(""),
  TWITCH_CLIENT_SECRET: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-4o-mini"),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional().default("ai.iconic.slate"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional().default(""),
  /**
   * Shared secret proving an inbound RTDN webhook really came from our own
   * Pub/Sub push subscription. Configure the subscription's push endpoint as
   * https://<host>/api/billing/rtdn?token=<this value>.
   */
  RTDN_SHARED_SECRET: z.string().optional().default(""),
  /**
   * Comma-separated browser origins allowed to call the API with CORS —
   * in practice just Slate's own web site, which hosts the Play-required
   * account-deletion page. The Android app is not a browser origin and is
   * unaffected. Empty means "no browser origin is allowed", which is the
   * safe default for an API that otherwise only serves the mobile client.
   */
  WEB_ORIGINS: z.string().optional().default(""),
  /**
   * How many reverse proxies sit in front of the API, or "false" when it is
   * exposed directly.
   *
   * This matters more than it looks. `AUTH_RATE_LIMIT` keys on `req.ip` to
   * bound credential brute-forcing. Behind a load balancer without this set,
   * every request appears to come from the balancer, so all of the internet
   * shares one login budget — which both lets one attacker lock everyone out
   * and lets a distributed attacker evade the limit entirely. Fastify only
   * reads X-Forwarded-For when it is told how far to trust it; trusting it
   * blindly would let a client forge its own source address.
   */
  TRUST_PROXY: z.string().optional().default("false"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lazily validated so unit tests can set process.env before first access. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    assertProductionSafety(parsed.data);
    cached = parsed.data;
  }
  return cached;
}

/** Values that are fine in development but must never reach production. */
const PLACEHOLDER_MARKERS = ["replace-with", "changeme", "change-me", "example", "placeholder", "xxx"];

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Production-only refusals. Each of these is a configuration mistake that
 * starts up perfectly happily and is only discovered after it has done
 * damage, so the server declines to run instead.
 */
function assertProductionSafety(env: Env): void {
  if (env.NODE_ENV !== "production") return;

  const problems: string[] = [];

  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    // Sharing one secret means a refresh token is a valid access token:
    // a stolen long-lived credential becomes an immediate API key.
    problems.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.");
  }
  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
    if (looksLikePlaceholder(env[key])) {
      problems.push(`${key} still looks like the placeholder from .env.example.`);
    }
    if (env[key].length < 32) {
      problems.push(`${key} is too short for production (want 32+ characters).`);
    }
  }
  if (env.DATABASE_URL.includes("localhost") || env.DATABASE_URL.includes("127.0.0.1")) {
    problems.push("DATABASE_URL points at localhost, which is almost certainly not the production database.");
  }
  if (env.WEB_ORIGINS.split(",").some((o) => o.trim().startsWith("http://"))) {
    problems.push("WEB_ORIGINS contains a plaintext http:// origin.");
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with an unsafe configuration:\n  - ${problems.join("\n  - ")}`,
    );
  }
}

/**
 * Parsed form of TRUST_PROXY for Fastify.
 *
 *   "false" (default) — direct exposure; X-Forwarded-For is ignored entirely.
 *   "true"            — trust every hop. Only correct when something upstream
 *                       strips client-supplied forwarding headers.
 *   a number          — trust exactly that many hops, expressed as Fastify's
 *                       TrustProxyFunction since its types model a hop count
 *                       that way.
 *   anything else     — an IP or CIDR allowlist, passed through verbatim.
 */
export function getTrustProxy(): boolean | string | string[] | ((address: string, hop: number) => boolean) {
  const raw = getEnv().TRUST_PROXY.trim();
  if (raw === "" || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;

  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) {
    return (_address: string, hop: number) => hop < hops;
  }

  const list = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  return list.length > 1 ? list : raw;
}

export function isTmdbConfigured(): boolean {
  return getEnv().TMDB_API_KEY.length > 0;
}

export function isIgdbConfigured(): boolean {
  return getEnv().TWITCH_CLIENT_ID.length > 0 && getEnv().TWITCH_CLIENT_SECRET.length > 0;
}

export function isAiConfigured(): boolean {
  return getEnv().OPENAI_API_KEY.length > 0;
}

export function isPlayBillingConfigured(): boolean {
  return getEnv().GOOGLE_SERVICE_ACCOUNT_JSON.length > 0;
}
