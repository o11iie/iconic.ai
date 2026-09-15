import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import * as igdb from "./igdb.client";
import { IgdbNotConfiguredError, IgdbApiError } from "./igdb.client";
import { PROVIDER_RATE_LIMIT } from "../../plugins/rate-limits";

async function handleIgdbErrors<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof IgdbNotConfiguredError) {
      return reply.code(503).send({ error: err.message, code: "IGDB_NOT_CONFIGURED" });
    }
    if (err instanceof IgdbApiError) {
      return reply.code(err.statusCode === 404 ? 404 : 502).send({ error: err.message });
    }
    throw err;
  }
}

export async function gamesRoutes(app: FastifyInstance) {
  app.get("/games/upcoming", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (_req, reply) => {
    const results = await handleIgdbErrors(reply, () => igdb.upcomingGames());
    if (results) return reply.send({ results });
  });

  app.get("/games/anticipated", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (_req, reply) => {
    const results = await handleIgdbErrors(reply, () => igdb.anticipatedGames());
    if (results) return reply.send({ results });
  });

  app.get("/games/search", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const query = z.object({ q: z.string().min(1) }).parse(req.query);
    const results = await handleIgdbErrors(reply, () => igdb.searchGames(query.q));
    if (results) return reply.send({ results });
  });

  app.get("/games/:id", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const detail = await handleIgdbErrors(reply, () => igdb.getGameDetail(params.id));
    if (detail) return reply.send({ title: detail });
  });
}
