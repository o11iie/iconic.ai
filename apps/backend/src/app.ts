import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { getEnv } from "./env";
import authenticatePlugin from "./plugins/authenticate";
import { authRoutes } from "./modules/auth/auth.routes";
import { moviesTvRoutes } from "./modules/tmdb/movies.routes";
import { gamesRoutes } from "./modules/igdb/games.routes";
import { discoveryRoutes } from "./modules/discovery/discovery.routes";
import { watchlistRoutes } from "./modules/watchlist/watchlist.routes";
import { followRoutes } from "./modules/follows/follows.routes";
import { communityRoutes } from "./modules/community/community.routes";
import { aiRoutes } from "./modules/ai/ai.routes";
import { billingRoutes } from "./modules/billing/billing.routes";
import { notificationRoutes } from "./modules/notifications/notifications.routes";
import { adminRoutes } from "./modules/admin/admin.routes";

export function buildApp() {
  const env = getEnv();

  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
  });

  app.register(cors, { origin: true });
  app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  app.register(authenticatePlugin);

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", details: error.flatten() });
    }
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    return reply.code(statusCode).send({ error: statusCode === 500 ? "Internal server error" : error.message });
  });

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  app.register(authRoutes, { prefix: "/api" });
  app.register(moviesTvRoutes, { prefix: "/api" });
  app.register(gamesRoutes, { prefix: "/api" });
  app.register(discoveryRoutes, { prefix: "/api" });
  app.register(watchlistRoutes, { prefix: "/api" });
  app.register(followRoutes, { prefix: "/api" });
  app.register(communityRoutes, { prefix: "/api" });
  app.register(aiRoutes, { prefix: "/api" });
  app.register(billingRoutes, { prefix: "/api" });
  app.register(notificationRoutes, { prefix: "/api" });
  app.register(adminRoutes, { prefix: "/api" });

  return app;
}
