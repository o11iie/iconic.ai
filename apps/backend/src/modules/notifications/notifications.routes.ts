import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = z.object({ unreadOnly: z.coerce.boolean().default(false) }).parse(req.query);
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId, ...(query.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  });

  app.post("/notifications/:id/read", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    await prisma.notification.updateMany({
      where: { id: params.id, userId: req.userId },
      data: { readAt: new Date() },
    });
    return reply.send({ ok: true });
  });

  app.post("/notifications/read-all", { preHandler: [app.authenticate] }, async (req, reply) => {
    await prisma.notification.updateMany({
      where: { userId: req.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.send({ ok: true });
  });
}
