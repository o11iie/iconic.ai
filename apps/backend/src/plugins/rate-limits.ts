import type { FastifyRequest } from "fastify";

/**
 * Rate-limit tiers, sized by what each route actually costs when abused
 * rather than one blanket number.
 *
 * Keyed by authenticated user id where available, falling back to IP, so a
 * signed-in abuser can't reset their budget by rotating IPs and users
 * behind one NAT don't share a single allowance.
 */
export function rateLimitKey(req: FastifyRequest): string {
  return req.userId ?? req.ip;
}

/** Credential endpoints. Tight, because this is the brute-force surface. */
export const AUTH_RATE_LIMIT = {
  max: 10,
  timeWindow: "5 minutes",
  keyGenerator: (req: FastifyRequest) => req.ip,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "Too many attempts. Please wait a few minutes and try again.",
    code: "RATE_LIMITED",
  }),
};

/**
 * Routes that proxy a third-party provider (TMDB/IGDB). Abuse here burns
 * Slate's provider quota and can get the whole app rate-limited upstream,
 * so this is capped well below what a real user would ever hit.
 */
export const PROVIDER_RATE_LIMIT = {
  max: 120,
  timeWindow: "1 minute",
  keyGenerator: rateLimitKey,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "You're browsing faster than Slate can keep up. Please slow down.",
    code: "RATE_LIMITED",
  }),
};

/**
 * Ask Slate. A per-day quota already exists in usage-limits.ts (the cost
 * control); this is the burst control on top of it, so a single user can't
 * fire their whole daily allowance in one second and spike OpenAI spend.
 */
export const AI_RATE_LIMIT = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator: rateLimitKey,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "Ask Slate is catching its breath. Try again in a moment.",
    code: "RATE_LIMITED",
  }),
};

/**
 * Analytics ingest is unauthenticated by design (pre-signup funnel events
 * still matter), which makes it the easiest endpoint to flood the database
 * with. Generous enough for real batched clients, bounded enough to matter.
 */
export const ANALYTICS_RATE_LIMIT = {
  max: 60,
  timeWindow: "1 minute",
  keyGenerator: rateLimitKey,
  errorResponseBuilder: () => ({ statusCode: 429, error: "Too many events.", code: "RATE_LIMITED" }),
};

/** User content creation — posts, comments, reports. Bounds spam floods. */
export const WRITE_RATE_LIMIT = {
  max: 30,
  timeWindow: "1 minute",
  keyGenerator: rateLimitKey,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "You're posting too quickly. Take a breath and try again.",
    code: "RATE_LIMITED",
  }),
};
