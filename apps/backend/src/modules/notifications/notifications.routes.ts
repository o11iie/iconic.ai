import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { requireRole } from "../../plugins/require-role";
import { runReleaseAlertSweep } from "./release-alerts";

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

  app.get("/notifications/unread-count", { preHandler: [app.authenticate] }, async (req, reply) => {
    const count = await prisma.notification.count({ where: { userId: req.userId, readAt: null } });
    return reply.send({ count });
  });

  /**
   * Runs the release-alert sweep. Intended to be called on a schedule (a
   * cron job or platform scheduler hitting this with an admin token) rather
   * than from an in-process timer, so it works the same on one instance or
   * ten. The sweep is idempotent, so a duplicate run is harmless.
   */
  app.post(
    "/notifications/sweep-release-alerts",
    { preHandler: [app.authenticate, requireRole("ADMIN")] },
    async (_req, reply) => {
      const result = await runReleaseAlertSweep();
      return reply.send(result);
    },
  );
}
