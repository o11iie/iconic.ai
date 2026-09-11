import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TitleSummary } from "@slate/shared";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";
import { isIgdbConfigured, isTmdbConfigured } from "../../env";
import { sortByHype } from "./hype";
import { computeCountdown } from "./countdown";
import { dedupeById, sortByPersonalizedScore } from "./personalization";
import { prisma } from "../../prisma";

/** TMDB and IGDB both default to 20 results per page; a fetcher returning a full page means there's likely a next one. */
const PROVIDER_PAGE_SIZE = 20;

/**
 * Runs each provider call independently so one down/unconfigured provider
 * never blanks the whole feed, and reports whether ANY of them returned a
 * full page — the honest signal that more results may exist, rather than
 * guessing from the merged total (which depends on how many providers ran).
 */
async function settleAll(fns: Array<() => Promise<TitleSummary[]>>): Promise<{ results: TitleSummary[]; hasMore: boolean }> {
  const settled = await Promise.allSettled(fns.map((fn) => fn()));
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<TitleSummary[]> => r.status === "fulfilled");
  return {
    results: fulfilled.flatMap((r) => r.value),
    hasMore: fulfilled.some((r) => r.value.length >= PROVIDER_PAGE_SIZE),
  };
}

const pageSchema = z.coerce.number().int().min(1).max(50).default(1);

export async function discoveryRoutes(app: FastifyInstance) {
  app.get("/discover/trending", async (req, reply) => {
    const query = z
      .object({ mediaType: z.enum(["movie", "tv", "game", "all"]).default("all"), page: pageSchema })
      .parse(req.query);

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if ((query.mediaType === "movie" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.trending("movie", "week", query.page));
    }
    if ((query.mediaType === "tv" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.trending("tv", "week", query.page));
    }
    if ((query.mediaType === "game" || query.mediaType === "all") && isIgdbConfigured()) {
      fetchers.push(() => igdb.anticipatedGames(query.page));
    }

    const { results, hasMore } = await settleAll(fetchers);
    return reply.send({ results: sortByHype(results), page: query.page, hasMore });
  });

  app.get("/discover/upcoming", async (req, reply) => {
    const query = z
      .object({ mediaType: z.enum(["movie", "tv", "game", "all"]).default("all"), page: pageSchema })
      .parse(req.query);

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if ((query.mediaType === "movie" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.upcomingMovies(query.page));
    }
    if ((query.mediaType === "tv" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.onTheAirTv(query.page));
    }
    if ((query.mediaType === "game" || query.mediaType === "all") && isIgdbConfigured()) {
      fetchers.push(() => igdb.upcomingGames(query.page));
    }

    const { results, hasMore } = await settleAll(fetchers);
    const withCountdowns = results
      .map((t) => ({ ...t, countdown: computeCountdown(t.releaseWindow) }))
      .sort((a, b) => (a.countdown.msRemaining ?? Infinity) - (b.countdown.msRemaining ?? Infinity));
    return reply.send({ results: withCountdowns, page: query.page, hasMore });
  });

  app.get("/search", async (req, reply) => {
    const query = z
      .object({ q: z.string().min(1), mediaType: z.enum(["movie", "tv", "game", "all"]).default("all"), page: pageSchema })
      .parse(req.query);

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if ((query.mediaType === "movie" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.search("movie", query.q, query.page));
    }
    if ((query.mediaType === "tv" || query.mediaType === "all") && isTmdbConfigured()) {
      fetchers.push(() => tmdb.search("tv", query.q, query.page));
    }
    if ((query.mediaType === "game" || query.mediaType === "all") && isIgdbConfigured()) {
      fetchers.push(() => igdb.searchGames(query.q, query.page));
    }

    const { results, hasMore } = await settleAll(fetchers);
    return reply.send({ results, page: query.page, hasMore });
  });

  /**
   * "For You" — trending + upcoming across every configured provider,
   * re-ranked by the user's favorite genres on top of Hype Score. With no
   * favorite genres set, this is equivalent to a hype-sorted merge of both
   * feeds (still useful, just not yet personalized) — `personalized: false`
   * tells the client that honestly rather than pretending to personalize
   * with no signal to personalize from.
   */
  app.get("/discover/for-you", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { favoriteGenres: true } });

    const fetchers: Array<() => Promise<TitleSummary[]>> = [];
    if (isTmdbConfigured()) {
      fetchers.push(() => tmdb.trending("movie", "week"));
      fetchers.push(() => tmdb.trending("tv", "week"));
      fetchers.push(() => tmdb.upcomingMovies());
      fetchers.push(() => tmdb.onTheAirTv());
    }
    if (isIgdbConfigured()) {
      fetchers.push(() => igdb.anticipatedGames());
    }

    const { results } = await settleAll(fetchers);
    const ranked = sortByPersonalizedScore(dedupeById(results), user.favoriteGenres);

    return reply.send({ results: ranked, personalized: user.favoriteGenres.length > 0 });
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
