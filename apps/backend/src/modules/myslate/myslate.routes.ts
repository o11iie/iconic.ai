import type { FastifyInstance } from "fastify";
import type { TitleSummary } from "@slate/shared";
import { prisma } from "../../prisma";
import { getPlan } from "../billing/plan.service";
import { buildReleaseRadar, mergeInputs, type RadarInput } from "../radar/radar.service";
import { fromPrismaMediaType } from "../../lib/media-type";
import { sortByPersonalizedScore, dedupeById } from "../discovery/personalization";
import { PROVIDER_RATE_LIMIT } from "../../plugins/rate-limits";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";
import { isIgdbConfigured, isTmdbConfigured } from "../../env";

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

export async function mySlateRoutes(app: FastifyInstance) {
  /**
   * My Slate — the user's command center: everything they follow, are
   * watching, and are counting down to, across movies, TV and games, in one
   * response so the screen renders in a single round-trip.
   *
   * Free users get a real version of this (their own follows, watchlist and
   * near-term radar). Pro adds personalized recommendations and the full
   * radar horizon. The `tier`/`limits` in the response let the UI show
   * honestly what's capped rather than silently truncating.
   */
  app.get("/my-slate", { preHandler: [app.authenticate], config: { rateLimit: PROVIDER_RATE_LIMIT } }, async (req, reply) => {
    const { tier, limits } = await getPlan(req.userId);

    const [user, follows, watchlist, savedJourneys, unreadNotifications] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { favoriteGenres: true, displayName: true } }),
      prisma.follow.findMany({ where: { userId: req.userId }, include: { title: true }, orderBy: { createdAt: "desc" } }),
      prisma.watchlistItem.findMany({
        where: { userId: req.userId },
        include: { title: true },
        orderBy: { addedAt: "desc" },
      }),
      prisma.savedJourney.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.notification.count({ where: { userId: req.userId, readAt: null } }),
    ]);

    const completedIds = new Set(
      watchlist.filter((w) => w.status === "COMPLETED").map((w) => w.titleId),
    );

    const followInputs: RadarInput[] = follows.map((f) => ({
      title: summaryFromCachedTitle(f.title),
      reasons: ["FOLLOWED"],
    }));
    const watchlistInputs: RadarInput[] = watchlist
      .filter((w) => w.status === "WANT_TO_WATCH" || w.status === "WATCHING")
      .map((w) => ({ title: summaryFromCachedTitle(w.title), reasons: ["WATCHLISTED"] }));

    const radar = buildReleaseRadar(mergeInputs([followInputs, watchlistInputs]), limits.releaseRadarHorizonDays);

    // Personalized recommendations are a Pro pillar. Free users get the
    // section omitted entirely rather than filled with a teaser they can't use.
    let recommendations: TitleSummary[] = [];
    if (limits.personalizedRecommendations) {
      const fetchers: Array<Promise<TitleSummary[]>> = [];
      if (isTmdbConfigured()) {
        fetchers.push(tmdb.trending("movie", "week"), tmdb.trending("tv", "week"));
      }
      if (isIgdbConfigured()) {
        fetchers.push(igdb.anticipatedGames());
      }
      const settled = await Promise.allSettled(fetchers);
      const pool = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      // Exclude what they already follow/watchlist — recommending something
      // already in their universe isn't a recommendation.
      const known = new Set([...follows.map((f) => f.titleId), ...watchlist.map((w) => w.titleId)]);
      recommendations = sortByPersonalizedScore(
        dedupeById(pool).filter((t) => !known.has(t.id)),
        user.favoriteGenres,
      ).slice(0, 12);
    }

    const byMediaType = (list: { title: { mediaType: "MOVIE" | "TV" | "GAME" } }[], type: "MOVIE" | "TV" | "GAME") =>
      list.filter((i) => i.title.mediaType === type).length;

    return reply.send({
      displayName: user.displayName,
      tier,
      limits,
      following: {
        total: follows.length,
        movies: byMediaType(follows, "MOVIE"),
        tv: byMediaType(follows, "TV"),
        games: byMediaType(follows, "GAME"),
        items: follows.slice(0, 20).map((f) => summaryFromCachedTitle(f.title)),
      },
      watchlist: {
        total: watchlist.length,
        completed: completedIds.size,
        movies: byMediaType(watchlist, "MOVIE"),
        tv: byMediaType(watchlist, "TV"),
        games: byMediaType(watchlist, "GAME"),
        items: watchlist.slice(0, 20).map((w) => ({
          ...summaryFromCachedTitle(w.title),
          status: w.status,
        })),
      },
      radar,
      journeys: savedJourneys.map((j) => ({
        id: j.id,
        name: j.name,
        kind: j.kind,
        mediaType: j.mediaType.toLowerCase(),
        totalCount: j.stepTitleIds.length,
        completedCount: j.stepTitleIds.filter((id) => completedIds.has(id)).length,
      })),
      recommendations,
      unreadNotifications,
    });
  });
}
