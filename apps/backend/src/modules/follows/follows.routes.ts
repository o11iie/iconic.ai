import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { ensureTitleExists } from "../titles/ensure-title";
import { fromPrismaMediaType } from "../../lib/media-type";

const FREE_FOLLOW_LIMIT = 10;

export async function followRoutes(app: FastifyInstance) {
  app.get("/follows", { preHandler: [app.authenticate] }, async (req, reply) => {
    const follows = await prisma.follow.findMany({
      where: { userId: req.userId },
      include: { title: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({
      items: follows.map((f) => ({
        titleId: f.titleId,
        mediaType: fromPrismaMediaType(f.title.mediaType),
        name: f.title.name,
        releaseDate: f.title.releaseDate?.toISOString() ?? null,
      })),
    });
  });

  app.post("/follows", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({ titleId: z.string() }).parse(req.body);

    const [entitlement, currentCount] = await Promise.all([
      prisma.entitlement.findUnique({ where: { userId: req.userId } }),
      prisma.follow.count({ where: { userId: req.userId } }),
    ]);
    const isPro = entitlement?.status === "ACTIVE" || entitlement?.status === "GRACE_PERIOD";
    if (!isPro && currentCount >= FREE_FOLLOW_LIMIT) {
      return reply.code(403).send({
        error: `Free plan is limited to following ${FREE_FOLLOW_LIMIT} titles. Upgrade to Slate Pro for unlimited follows and smart release alerts.`,
        code: "PRO_REQUIRED",
      });
    }

    try {
      await ensureTitleExists(body.titleId);
    } catch {
      return reply.code(502).send({ error: "Could not load title from provider." });
    }

    const follow = await prisma.follow.upsert({
      where: { userId_titleId: { userId: req.userId, titleId: body.titleId } },
      create: { userId: req.userId, titleId: body.titleId },
      update: {},
    });
    return reply.code(201).send({ follow });
  });

  app.delete("/follows/:titleId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = z.object({ titleId: z.string() }).parse(req.params);
    await prisma.follow.deleteMany({ where: { userId: req.userId, titleId: params.titleId } });
    return reply.code(204).send();
  });
}
