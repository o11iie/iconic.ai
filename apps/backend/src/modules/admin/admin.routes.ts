import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { requireRole } from "../../plugins/require-role";

/**
 * Minimal admin surface for V1: moderation queue + coarse product stats.
 * Everything here is role-gated (ADMIN or MODERATOR) on top of standard
 * auth — never exposed to regular users.
 */
export async function adminRoutes(app: FastifyInstance) {
  app.get(
    "/admin/reports",
    { preHandler: [app.authenticate, requireRole("MODERATOR", "ADMIN")] },
    async (req, reply) => {
      const query = z.object({ status: z.enum(["OPEN", "ACTIONED", "DISMISSED"]).default("OPEN") }).parse(req.query);
      const reports = await prisma.report.findMany({
        where: { status: query.status },
        include: { reporter: true, post: true, comment: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return reply.send({ reports });
    },
  );

  app.post(
    "/admin/reports/:id/resolve",
    { preHandler: [app.authenticate, requireRole("MODERATOR", "ADMIN")] },
    async (req, reply) => {
      const params = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ status: z.enum(["ACTIONED", "DISMISSED"]) }).parse(req.body);
      const report = await prisma.report.update({ where: { id: params.id }, data: { status: body.status } });
      return reply.send({ report });
    },
  );

  app.get("/admin/stats", { preHandler: [app.authenticate, requireRole("ADMIN")] }, async (_req, reply) => {
    const [userCount, proCount, postCount, openReports] = await Promise.all([
      prisma.user.count(),
      prisma.entitlement.count({ where: { status: { in: ["ACTIVE", "GRACE_PERIOD"] } } }),
      prisma.communityPost.count({ where: { deletedAt: null } }),
      prisma.report.count({ where: { status: "OPEN" } }),
    ]);
    return reply.send({ userCount, proSubscriberCount: proCount, postCount, openReports });
  });
}
