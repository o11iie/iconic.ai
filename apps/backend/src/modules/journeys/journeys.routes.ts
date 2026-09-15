import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { buildJourney } from "./journey.service";
import { getPlan, paywall } from "../billing/plan.service";
import { PROVIDER_RATE_LIMIT } from "../../plugins/rate-limits";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";

/**
 * Titles the user has actually finished, used to compute journey progress.
 * Only COMPLETED counts — having something on the watchlist isn't progress.
 */
async function completedTitleIds(userId: string): Promise<Set<string>> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId, status: "COMPLETED" },
    select: { titleId: true },
  });
  return new Set(items.map((i) => i.titleId));
}

export async function journeyRoutes(app: FastifyInstance) {
  /**
   * Builds the journey leading to a given title, from its franchise.
   *
   * Free users can see a journey for a title they're looking at — that's
   * genuinely useful and shows what Pro offers. The Pro gate is on *saving*
   * journeys to track progress across many franchises at once.
   */
  app.get(
    "/journeys/for-title/:mediaType/:externalId",
    { preHandler: [app.authenticate], config: { rateLimit: PROVIDER_RATE_LIMIT } },
    async (req, reply) => {
      const params = z
        .object({ mediaType: z.enum(["movie", "tv", "game"]), externalId: z.string() })
        .parse(req.params);
      const titleId = `${params.mediaType}:${params.externalId}`;

      try {
        const detail =
          params.mediaType === "game"
            ? await igdb.getGameDetail(params.externalId)
            : await tmdb.getDetail(params.mediaType, params.externalId);

        if (!detail.franchise) {
          return reply.send({
            journey: null,
            reason: "This title isn't part of a franchise Slate can build a journey from.",
          });
        }

        const parts =
          params.mediaType === "game"
            ? await igdb.getCollectionGames(detail.franchise.id)
            : (await tmdb.getCollection(detail.franchise.id)).parts;

        if (parts.length === 0) {
          return reply.send({ journey: null, reason: "No franchise entries available for this title." });
        }

        const journey = buildJourney({
          id: `${params.mediaType}:franchise:${detail.franchise.id}`,
          name: detail.franchise.name,
          kind: params.mediaType === "game" ? "PLAY" : "WATCH",
          source: params.mediaType === "game" ? "igdb" : "tmdb",
          parts,
          completedTitleIds: await completedTitleIds(req.userId),
          targetTitleId: titleId,
        });

        return reply.send({ journey });
      } catch (err) {
        app.log.error(err);
        return reply.code(502).send({ error: "Slate couldn't build a journey for this title right now." });
      }
    },
  );

  /** The user's saved journeys, with live progress recomputed from their watch history. */
  app.get("/journeys", { preHandler: [app.authenticate] }, async (req, reply) => {
    const saved = await prisma.savedJourney.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    const completed = await completedTitleIds(req.userId);

    return reply.send({
      journeys: saved.map((j) => {
        const steps = j.stepTitleIds;
        const done = steps.filter((id) => completed.has(id)).length;
        return {
          id: j.id,
          kind: j.kind,
          name: j.name,
          mediaType: j.mediaType.toLowerCase(),
          completedCount: done,
          totalCount: steps.length,
          nextStepName: null,
        };
      }),
    });
  });

  app.post("/journeys", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(120),
        kind: z.enum(["WATCH", "PLAY"]),
        mediaType: z.enum(["MOVIE", "TV", "GAME"]),
        stepTitleIds: z.array(z.string()).min(1).max(100),
        targetTitleId: z.string().optional(),
      })
      .parse(req.body);

    const [{ limits }, currentCount] = await Promise.all([
      getPlan(req.userId),
      prisma.savedJourney.count({ where: { userId: req.userId } }),
    ]);

    if (limits.maxSavedJourneys !== null && currentCount >= limits.maxSavedJourneys) {
      return reply
        .code(403)
        .send(
          paywall(
            "ADVANCED_JOURNEY",
            `Free includes ${limits.maxSavedJourneys} saved journey. Slate Pro lets you track unlimited watch and play journeys at once — every franchise you're working through, in one place.`,
          ),
        );
    }

    const journey = await prisma.savedJourney.create({
      data: {
        userId: req.userId,
        name: body.name,
        kind: body.kind,
        mediaType: body.mediaType,
        stepTitleIds: body.stepTitleIds,
        targetTitleId: body.targetTitleId,
      },
    });
    return reply.code(201).send({ journey });
  });

  app.delete("/journeys/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    // Scoped by userId so one user can never delete another's journey.
    const deleted = await prisma.savedJourney.deleteMany({ where: { id: params.id, userId: req.userId } });
    if (deleted.count === 0) return reply.code(404).send({ error: "Journey not found." });
    return reply.code(204).send();
  });
}
