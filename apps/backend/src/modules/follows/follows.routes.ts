import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { ensureTitleExists } from "../titles/ensure-title";
import { fromPrismaMediaType } from "../../lib/media-type";
import { getPlan, paywall } from "../billing/plan.service";

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

    const [{ limits }, currentCount] = await Promise.all([
      getPlan(req.userId),
      prisma.follow.count({ where: { userId: req.userId } }),
    ]);
    if (limits.maxFollows !== null && currentCount >= limits.maxFollows) {
      return reply
        .code(403)
        .send(
          paywall(
            "FOLLOW_LIMIT",
            `You're following ${limits.maxFollows} titles — the Free limit. Slate Pro gives you unlimited follows across movies, TV and games, so nothing you care about slips past.`,
          ),
        );
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
