import type { FastifyInstance } from "fastify";
import type { RadarInput } from "./radar.service";
import type { TitleSummary } from "@slate/shared";
import { prisma } from "../../prisma";
import { buildReleaseRadar, mergeInputs } from "./radar.service";
import { getPlan } from "../billing/plan.service";
import { fromPrismaMediaType } from "../../lib/media-type";
import { PROVIDER_RATE_LIMIT } from "../../plugins/rate-limits";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";
import { isIgdbConfigured, isTmdbConfigured } from "../../env";

/**
 * Builds a TitleSummary from the locally cached Title row. Radar needs
 * release timing and identity, not full metadata, so this avoids a provider
 * round-trip per followed title — which would be dozens of API calls for an
 * engaged user and would burn provider quota on every radar load.
 */
function summaryFromCachedTitle(title: {
  id: string;
  mediaType: "MOVIE" | "TV" | "GAME";
  name: string;
  releaseDate: Date | null;
  releaseDatePrecision: string;
}): TitleSummary {
  return {
    id: title.id,
    mediaType: fromPrismaMediaType(title.mediaType),
    name: title.name,
    releaseWindow: title.releaseDate
      ? {
          precision: title.releaseDatePrecision === "exact_datetime" ? "exact_datetime" : "date_only",
          date: title.releaseDate.toISOString(),
        }
      : { precision: "unknown" },
    genres: [],
  };
}

export async function radarRoutes(app: FastifyInstance) {
  /**
   * Release Radar — what's coming, across movies, TV and games, weighted by
   * what the user actually follows and watchlists.
   *
   * Available to Free users with a shorter horizon rather than withheld
   * entirely: knowing what lands this week is core utility, not a premium
   * feature. Pro extends the horizon to a full planning year.
   */
  app.get("/radar", { preHandler: [app.authenticate], config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const { tier, limits } = await getPlan(req.userId);

    const [follows, watchlist] = await Promise.all([
      prisma.follow.findMany({ where: { userId: req.userId }, include: { title: true } }),
      prisma.watchlistItem.findMany({
        where: { userId: req.userId, status: { in: ["WANT_TO_WATCH", "WATCHING"] } },
        include: { title: true },
      }),
    ]);

    const followInputs: RadarInput[] = follows.map((f) => ({
      title: summaryFromCachedTitle(f.title),
      reasons: ["FOLLOWED"],
    }));
    const watchlistInputs: RadarInput[] = watchlist.map((w) => ({
      title: summaryFromCachedTitle(w.title),
      reasons: ["WATCHLISTED"],
    }));

    // Pro also gets broader upcoming releases folded in, so the radar stays
    // useful before the user has followed much. Provider failure must never
    // blank the user's own followed/watchlisted entries.
    const trendingInputs: RadarInput[] = [];
    if (limits.personalizedRecommendations) {
      const fetchers: Array<Promise<TitleSummary[]>> = [];
      if (isTmdbConfigured()) {
        fetchers.push(tmdb.upcomingMovies(), tmdb.onTheAirTv());
      }
      if (isIgdbConfigured()) {
        fetchers.push(igdb.upcomingGames());
      }
      const settled = await Promise.allSettled(fetchers);
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        for (const title of result.value) trendingInputs.push({ title, reasons: ["TRENDING"] });
      }
    }

    const radar = buildReleaseRadar(
      mergeInputs([followInputs, watchlistInputs, trendingInputs]),
      limits.releaseRadarHorizonDays,
    );

    return reply.send({ ...radar, tier });
  });
}
