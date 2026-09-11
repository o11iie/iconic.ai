import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { ensureTitleExists } from "../titles/ensure-title";
import { fromPrismaMediaType } from "../../lib/media-type";

const FREE_WATCHLIST_LIMIT = 25;

export async function watchlistRoutes(app: FastifyInstance) {
  app.get("/watchlist", { preHandler: [app.authenticate] }, async (req, reply) => {
    const items = await prisma.watchlistItem.findMany({
      where: { userId: req.userId },
      include: { title: true },
      orderBy: { addedAt: "desc" },
    });
    return reply.send({
      items: items.map((i) => ({
        titleId: i.titleId,
        mediaType: fromPrismaMediaType(i.title.mediaType),
        name: i.title.name,
        status: i.status,
        addedAt: i.addedAt.toISOString(),
      })),
    });
  });

  app.post("/watchlist", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({ titleId: z.string() }).parse(req.body);

    const [entitlement, currentCount] = await Promise.all([
      prisma.entitlement.findUnique({ where: { userId: req.userId } }),
      prisma.watchlistItem.count({ where: { userId: req.userId } }),
    ]);
    const isPro = entitlement?.status === "ACTIVE" || entitlement?.status === "GRACE_PERIOD";
    if (!isPro && currentCount >= FREE_WATCHLIST_LIMIT) {
      return reply.code(403).send({
        error: `Free watchlist is limited to ${FREE_WATCHLIST_LIMIT} titles. Upgrade to Slate Pro for unlimited watchlist.`,
        code: "PRO_REQUIRED",
      });
    }

    try {
      await ensureTitleExists(body.titleId);
    } catch {
      return reply.code(502).send({ error: "Could not load title from provider." });
    }

    const item = await prisma.watchlistItem.upsert({
      where: { userId_titleId: { userId: req.userId, titleId: body.titleId } },
      create: { userId: req.userId, titleId: body.titleId },
      update: {},
    });
    return reply.code(201).send({ item });
  });

  app.patch("/watchlist/:titleId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = z.object({ titleId: z.string() }).parse(req.params);
    const body = z.object({ status: z.enum(["WANT_TO_WATCH", "WATCHING", "COMPLETED", "DROPPED"]) }).parse(req.body);
    const updated = await prisma.watchlistItem.updateMany({
      where: { userId: req.userId, titleId: params.titleId },
      data: { status: body.status },
    });
    if (updated.count === 0) return reply.code(404).send({ error: "Not on watchlist." });
    return reply.send({ ok: true });
  });

  app.delete("/watchlist/:titleId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = z.object({ titleId: z.string() }).parse(req.params);
    await prisma.watchlistItem.deleteMany({ where: { userId: req.userId, titleId: params.titleId } });
    return reply.code(204).send();
  });
}
