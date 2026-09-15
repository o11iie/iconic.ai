import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { verifyPassword } from "../auth/auth.service";
import { deleteAccount } from "./account-deletion.service";
import { AUTH_RATE_LIMIT } from "../../plugins/rate-limits";

const notificationTypeSchema = z.enum([
  "RELEASE_REMINDER",
  "FOLLOWED_TITLE_UPDATE",
  "COMMUNITY_REPLY",
  "COMMUNITY_MENTION",
  "SUBSCRIPTION_STATUS",
]);

const preferencesSchema = z.object({
  favoriteGenres: z.array(z.string().min(1).max(50)).max(20).optional(),
  spoilerSensitivity: z.enum(["HIDE_ALL", "HIDE_RECENT", "SHOW_ALL"]).optional(),
  notificationsEnabled: z.boolean().optional(),
  mutedNotificationTypes: z.array(notificationTypeSchema).max(10).optional(),
});

export async function userRoutes(app: FastifyInstance) {
  /**
   * Permanent account deletion (Google Play requirement for apps with
   * account creation).
   *
   * Re-authentication is required: a leaked or borrowed access token must
   * not be enough to destroy someone's account. The user must supply their
   * current password, which is verified before anything is touched.
   */
  app.post(
    "/users/me/delete",
    { preHandler: [app.authenticate], config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const body = z.object({ password: z.string().min(1), confirm: z.literal("DELETE") }).parse(req.body);

      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { passwordHash: true },
      });
      if (!user) return reply.code(404).send({ error: "Account not found." });

      if (!(await verifyPassword(body.password, user.passwordHash))) {
        // 403, not 401: the caller's session is valid — it is the re-auth
        // password that is wrong. A 401 here would make the mobile client
        // treat it as an expired access token and burn a refresh-token
        // rotation before surfacing the real error.
        return reply.code(403).send({ error: "Password is incorrect.", code: "REAUTH_FAILED" });
      }

      const summary = await deleteAccount(req.userId);
      app.log.info({ summary }, "Account deleted");

      // 200 with a summary rather than 204: the client shows the user what
      // happened to their community content before signing them out.
      return reply.send({
        deleted: true,
        ...summary,
        message: "Your account and personal data have been deleted.",
      });
    },
  );

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
        mutedNotificationTypes: user.mutedNotificationTypes,
      },
    });
  });
}
