import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as tmdb from "./tmdb.client";
import { TmdbNotConfiguredError, TmdbApiError } from "./tmdb.client";
import { PROVIDER_RATE_LIMIT } from "../../plugins/rate-limits";

async function handleTmdbErrors<T>(reply: import("fastify").FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TmdbNotConfiguredError) {
      return reply.code(503).send({ error: err.message, code: "TMDB_NOT_CONFIGURED" });
    }
    if (err instanceof TmdbApiError) {
      return reply.code(err.statusCode >= 400 && err.statusCode < 500 ? 502 : 502).send({ error: err.message });
    }
    throw err;
  }
}

export async function moviesTvRoutes(app: FastifyInstance) {
  app.get("/movies/upcoming", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const query = z.object({ page: z.coerce.number().min(1).max(500).default(1) }).parse(req.query);
    const results = await handleTmdbErrors(reply, () => tmdb.upcomingMovies(query.page));
    if (results) return reply.send({ results });
  });

  app.get("/tv/on-the-air", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const query = z.object({ page: z.coerce.number().min(1).max(500).default(1) }).parse(req.query);
    const results = await handleTmdbErrors(reply, () => tmdb.onTheAirTv(query.page));
    if (results) return reply.send({ results });
  });

  app.get("/movies/search", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const query = z.object({ q: z.string().min(1), page: z.coerce.number().min(1).default(1) }).parse(req.query);
    const results = await handleTmdbErrors(reply, () => tmdb.search("movie", query.q, query.page));
    if (results) return reply.send({ results });
  });

  app.get("/tv/search", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const query = z.object({ q: z.string().min(1), page: z.coerce.number().min(1).default(1) }).parse(req.query);
    const results = await handleTmdbErrors(reply, () => tmdb.search("tv", query.q, query.page));
    if (results) return reply.send({ results });
  });

  app.get("/movies/:id", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const detail = await handleTmdbErrors(reply, () => tmdb.getDetail("movie", params.id));
    if (detail) return reply.send({ title: detail });
  });

  app.get("/tv/:id", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const detail = await handleTmdbErrors(reply, () => tmdb.getDetail("tv", params.id));
    if (detail) return reply.send({ title: detail });
  });

  app.get("/tv/:id/season/:seasonNumber", { config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const params = z
      .object({ id: z.string(), seasonNumber: z.coerce.number().int().min(1) })
      .parse(req.params);
    const season = await handleTmdbErrors(reply, () => tmdb.getSeasonDetail(params.id, params.seasonNumber));
    if (season) return reply.send({ season });
  });
}
