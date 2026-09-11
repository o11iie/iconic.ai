import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";

const preferencesSchema = z.object({
  favoriteGenres: z.array(z.string().min(1).max(50)).max(20).optional(),
  spoilerSensitivity: z.enum(["HIDE_ALL", "HIDE_RECENT", "SHOW_ALL"]).optional(),
  notificationsEnabled: z.boolean().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  app.patch("/users/me/preferences", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = preferencesSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: body,
    });

    return reply.send({
      preferences: {
        favoriteGenres: user.favoriteGenres,
        spoilerSensitivity: user.spoilerSensitivity,
        notificationsEnabled: user.notificationsEnabled,
      },
    });
  });
}
