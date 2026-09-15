import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { getEnv } from "./env";
import authenticatePlugin from "./plugins/authenticate";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/users.routes";
import { genresRoutes } from "./modules/genres/genres.routes";
import { moviesTvRoutes } from "./modules/tmdb/movies.routes";
import { gamesRoutes } from "./modules/igdb/games.routes";
import { discoveryRoutes } from "./modules/discovery/discovery.routes";
import { watchlistRoutes } from "./modules/watchlist/watchlist.routes";
import { followRoutes } from "./modules/follows/follows.routes";
import { communityRoutes } from "./modules/community/community.routes";
import { aiRoutes } from "./modules/ai/ai.routes";
import { billingRoutes } from "./modules/billing/billing.routes";
import { notificationRoutes } from "./modules/notifications/notifications.routes";
import { analyticsRoutes } from "./modules/analytics/analytics.routes";
import { radarRoutes } from "./modules/radar/radar.routes";
import { journeyRoutes } from "./modules/journeys/journeys.routes";
import { mySlateRoutes } from "./modules/myslate/myslate.routes";
import { adminRoutes } from "./modules/admin/admin.routes";

export function buildApp() {
  const env = getEnv();

  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
    // Nothing Slate accepts is large; the biggest body is a 50-event
    // analytics batch. Cap well below Fastify's 1MB default so an oversized
    // payload is rejected before it's parsed.
    bodyLimit: 128 * 1024,
  });

  app.register(cors, { origin: true });
  app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  app.register(authenticatePlugin);

  /**
   * Global backstop rate limit. Individual routes tighten this via their own
   * config (see plugins/rate-limits.ts) — this exists so a route added later
   * without explicit limits is never completely unbounded.
   */
  app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.userId ?? req.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too many requests. Please slow down.",
      code: "RATE_LIMITED",
    }),
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", details: error.flatten() });
    }
    // Rate-limit rejections arrive here as the plain object built by
    // errorResponseBuilder. They're expected traffic shaping, not faults —
    // pass the 429 through instead of logging and masking them as a 500.
    if (error.code === "RATE_LIMITED") {
      // errorResponseBuilder puts the user-facing copy on `error`, not
      // `message`, so read that first — otherwise every tier collapses to
      // the same generic string and we lose the per-route guidance.
      const builderMessage = (error as unknown as { error?: string }).error;
      return reply
        .code(error.statusCode ?? 429)
        .send({ error: builderMessage ?? error.message ?? "Too many requests.", code: "RATE_LIMITED" });
    }
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    return reply.code(statusCode).send({ error: statusCode === 500 ? "Internal server error" : error.message });
  });

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  app.register(authRoutes, { prefix: "/api" });
  app.register(userRoutes, { prefix: "/api" });
  app.register(genresRoutes, { prefix: "/api" });
  app.register(moviesTvRoutes, { prefix: "/api" });
  app.register(gamesRoutes, { prefix: "/api" });
  app.register(discoveryRoutes, { prefix: "/api" });
  app.register(watchlistRoutes, { prefix: "/api" });
  app.register(followRoutes, { prefix: "/api" });
  app.register(communityRoutes, { prefix: "/api" });
  app.register(aiRoutes, { prefix: "/api" });
  app.register(billingRoutes, { prefix: "/api" });
  app.register(notificationRoutes, { prefix: "/api" });
  app.register(analyticsRoutes, { prefix: "/api" });
  app.register(radarRoutes, { prefix: "/api" });
  app.register(journeyRoutes, { prefix: "/api" });
  app.register(mySlateRoutes, { prefix: "/api" });
  app.register(adminRoutes, { prefix: "/api" });

  return app;
}
