import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TitleSummary } from "@slate/shared";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";
import { isIgdbConfigured, isTmdbConfigured } from "../../env";
import { sortByHype } from "./hype";
import { computeCountdown } from "./countdown";

/** Runs each provider call independently so one down/unconfigured provider never blanks the whole feed. */
async function settleAll(fns: Array<() => Promise<TitleSummary[]>>): Promise<TitleSummary[]> {
  const results = await Promise.allSettled(fns.map((fn) => fn()));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export async function discoveryRoutes(app: FastifyInstance) {
  app.get("/discover/trending", async (req, reply) => {
    const query = z.object({ mediaType: z.enum(["movie", "tv", "game", "all"]).default("all") }).parse(req.query);

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if ((query.mediaType === "movie" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.trending("movie", "week"));
    }
    if ((query.mediaType === "tv" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.trending("tv", "week"));
    }
    if ((query.mediaType === "game" || query.mediaType === "all") && isIgdbConfigured()) {
      fetchers.push(() => igdb.anticipatedGames());
    }

    const combined = await settleAll(fetchers);
    return reply.send({ results: sortByHype(combined) });
  });

  app.get("/discover/upcoming", async (req, reply) => {
    const query = z.object({ mediaType: z.enum(["movie", "tv", "game", "all"]).default("all") }).parse(req.query);

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if ((query.mediaType === "movie" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.upcomingMovies());
    }
    if ((query.mediaType === "tv" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.onTheAirTv());
    }
    if ((query.mediaType === "game" || query.mediaType === "all") && isIgdbConfigured()) {
      fetchers.push(() => igdb.upcomingGames());
    }

    const combined = await settleAll(fetchers);
    const withCountdowns = combined
      .map((t) => ({ ...t, countdown: computeCountdown(t.releaseWindow) }))
      .sort((a, b) => (a.countdown.msRemaining ?? Infinity) - (b.countdown.msRemaining ?? Infinity));
    return reply.send({ results: withCountdowns });
  });

  app.get("/search", async (req, reply) => {
    const query = z
      .object({ q: z.string().min(1), mediaType: z.enum(["movie", "tv", "game", "all"]).default("all") })
      .parse(req.query);

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if ((query.mediaType === "movie" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.search("movie", query.q));
    }
    if ((query.mediaType === "tv" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.search("tv", query.q));
    }
    if ((query.mediaType === "game" || query.mediaType === "all") && isIgdbConfigured()) {
      fetchers.push(() => igdb.searchGames(query.q));
    }

    const combined = await settleAll(fetchers);
    return reply.send({ results: combined });
  });

  app.get("/titles/:mediaType/:externalId", async (req, reply) => {
    const params = z.object({ mediaType: z.enum(["movie", "tv", "game"]), externalId: z.string() }).parse(req.params);
    try {
      const detail =
        params.mediaType === "game"
          ? await igdb.getGameDetail(params.externalId)
          : await tmdb.getDetail(params.mediaType, params.externalId);
      return reply.send({ title: detail, countdown: computeCountdown(detail.releaseWindow) });
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: "Failed to load title detail." });
    }
  });
}
