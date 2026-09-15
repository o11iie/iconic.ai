import type { FastifyInstance } from "fastify";
import type { NotificationType, SpoilerSensitivity } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../prisma";
import {
  ACCESS_TOKEN_TTL,
  hashPassword,
  isValidHandle,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyPassword,
} from "./auth.service";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  handle: z.string().min(3).max(20),
  displayName: z.string().min(1).max(50),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function toPublicUser(user: { id: string; handle: string; displayName: string; avatarUrl: string | null; email: string; spoilerSensitivity: SpoilerSensitivity; notificationsEnabled: boolean; mutedNotificationTypes: NotificationType[]; favoriteGenres: string[]; createdAt: Date }) {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? undefined,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    preferences: {
      spoilerSensitivity: user.spoilerSensitivity,
      notificationsEnabled: user.notificationsEnabled,
      favoriteGenres: user.favoriteGenres,
      mutedNotificationTypes: user.mutedNotificationTypes,
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", async (req, reply) => {
    const body = signupSchema.parse(req.body);
    if (!isValidHandle(body.handle)) {
      return reply.code(400).send({ error: "Handle must be 3-20 lowercase letters, numbers, or underscores." });
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { handle: body.handle }] },
    });
    if (existing) {
      return reply.code(409).send({ error: "Email or handle already in use." });
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        handle: body.handle,
        displayName: body.displayName,
        entitlement: { create: { status: "NONE" } },
      },
    });

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await issueRefreshToken(user.id);

    return reply.code(201).send({ user: toPublicUser(user), accessToken, refreshToken });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await issueRefreshToken(user.id);

    return reply.send({ user: toPublicUser(user), accessToken, refreshToken });
  });

  app.post("/auth/refresh", async (req, reply) => {
    const body = z.object({ refreshToken: z.string() }).parse(req.body);
    try {
      const { userId, newToken } = await rotateRefreshToken(body.refreshToken);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const accessToken = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: ACCESS_TOKEN_TTL });
      return reply.send({ accessToken, refreshToken: newToken });
    } catch {
      return reply.code(401).send({ error: "Invalid or expired refresh token." });
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const body = z.object({ refreshToken: z.string() }).parse(req.body);
    await revokeRefreshToken(body.refreshToken);
    return reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    return reply.send({ user: toPublicUser(user) });
  });
}
