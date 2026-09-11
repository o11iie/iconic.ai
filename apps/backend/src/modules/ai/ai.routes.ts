import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { openAiProvider } from "./openai-provider";
import { AiProviderNotConfiguredError } from "./provider";
import { assertWithinLimit, incrementUsage, AiRateLimitError, getDailyLimit, getUsedToday } from "./usage-limits";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";

const MAX_MESSAGE_LENGTH = 1000;

const SYSTEM_PROMPT = `You are Ask Slate, the in-app assistant for Slate, an entertainment app covering movies, TV, and video games.

Rules you must always follow:
- Only state facts about titles, release dates, cast, or plot that are given to you in the CONTEXT block below. If something is not in the context and you are not highly confident it is well-established public knowledge, say plainly that you don't have that information rather than guessing.
- Never invent release dates, review scores, cast members, or plot details.
- Respect the user's spoiler sensitivity given in the context. If it is "hide_all" or "hide_recent", do not reveal plot twists, endings, or recent-episode events even if asked directly — instead warn the user and ask if they want to proceed.
- Keep responses concise and conversational, suited for a mobile app chat bubble.
- You are not a general-purpose chatbot: politely redirect off-topic requests back to entertainment.`;

async function buildTitleContext(titleId?: string): Promise<string> {
  if (!titleId) return "No specific title is currently open.";
  const [prefix, externalId] = titleId.split(":");
  try {
    const detail =
      prefix === "game" ? await igdb.getGameDetail(externalId) : await tmdb.getDetail(prefix as "movie" | "tv", externalId);
    return [
      `Title: ${detail.name} (${detail.mediaType})`,
      `Release: ${detail.releaseWindow.date ?? "unknown"} (precision: ${detail.releaseWindow.precision})`,
      `Overview: ${detail.overview || "not provided"}`,
      detail.cast.length ? `Cast: ${detail.cast.slice(0, 6).map((c) => c.name).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "Title context could not be loaded right now.";
  }
}

export async function aiRoutes(app: FastifyInstance) {
  app.get("/ai/usage", { preHandler: [app.authenticate] }, async (req, reply) => {
    const [limit, used] = await Promise.all([getDailyLimit(req.userId), getUsedToday(req.userId)]);
    return reply.send({ limit, used, remaining: Math.max(0, limit - used) });
  });

  app.post("/ai/ask", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z
      .object({
        message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
        titleId: z.string().optional(),
        conversationId: z.string().optional(),
        spoilerSensitivity: z.enum(["hide_all", "hide_recent", "show_all"]).default("hide_recent"),
      })
      .parse(req.body);

    try {
      await assertWithinLimit(req.userId);
    } catch (err) {
      if (err instanceof AiRateLimitError) {
        return reply.code(429).send({
          error: `You've reached today's Ask Slate limit (${err.limit}). Upgrade to Slate Pro for a higher daily limit.`,
          code: "AI_LIMIT_REACHED",
        });
      }
      throw err;
    }

    let conversation = body.conversationId
      ? await prisma.aiConversation.findFirst({ where: { id: body.conversationId, userId: req.userId } })
      : null;
    if (!conversation) {
      conversation = await prisma.aiConversation.create({ data: { userId: req.userId, titleId: body.titleId } });
    }

    const priorMessages = await prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

    const titleContext = await buildTitleContext(body.titleId);

    try {
      const result = await openAiProvider.complete([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `CONTEXT:\nSpoiler sensitivity: ${body.spoilerSensitivity}\n${titleContext}` },
        ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: body.message },
      ]);

      await prisma.$transaction([
        prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "user", content: body.message } }),
        prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: result.content } }),
      ]);
      await incrementUsage(req.userId);

      const [limit, used] = await Promise.all([getDailyLimit(req.userId), getUsedToday(req.userId)]);

      return reply.send({
        conversationId: conversation.id,
        message: result.content,
        declinedToSpeculate: /don'?t have (that|enough) information|i'?m not sure|no information/i.test(result.content),
        usage: { requestsRemainingToday: Math.max(0, limit - used) },
      });
    } catch (err) {
      if (err instanceof AiProviderNotConfiguredError) {
        return reply.code(503).send({ error: err.message, code: "AI_NOT_CONFIGURED" });
      }
      app.log.error(err);
      return reply.code(502).send({ error: "Ask Slate is temporarily unavailable. Please try again." });
    }
  });
}
