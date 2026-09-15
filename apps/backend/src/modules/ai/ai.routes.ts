import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { AI_RATE_LIMIT } from "../../plugins/rate-limits";
import { openAiProvider } from "./openai-provider";
import { AiProviderNotConfiguredError } from "./provider";
import { assertWithinLimit, incrementUsage, AiRateLimitError, getDailyLimit, getUsedToday } from "./usage-limits";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";

const MAX_MESSAGE_LENGTH = 1000;

const SYSTEM_PROMPT = `You are Ask Slate, the in-app assistant for Slate, an entertainment app covering movies, TV, and video games.

Movies, TV and games are equally first-class. A question about what to play next deserves the same depth as one about what to watch next.

Rules you must always follow:
- Only state facts about titles, release dates, cast, or plot that are given to you in the CONTEXT block below. If something is not in the context and you are not highly confident it is well-established public knowledge, say plainly that you don't have that information rather than guessing.
- Never invent release dates, review scores, cast members, platforms, or plot details.
- Respect the user's spoiler sensitivity given in the context. If it is "hide_all" or "hide_recent", do not reveal plot twists, endings, or recent-episode events even if asked directly — instead warn the user and ask if they want to proceed.
- Keep responses concise and conversational, suited for a mobile app chat bubble.
- You are not a general-purpose chatbot: politely redirect off-topic requests back to entertainment.

You are good at these in particular:
- Watch and play order ("what should I watch/play before this?"). Build the order from the franchise entries in the context. If Slate has a Journey for this franchise, say so — the user can track progress on it.
- Spoiler-free recaps and franchise catch-ups. Default to spoiler-free unless the user's sensitivity is "show_all" and they explicitly ask.
- "What should I watch tonight / play this weekend?" — ground these in the user's followed titles and watchlist from the context when present, rather than generic popular picks.
- Cross-category suggestions ("games similar to this show") — only when you can justify the connection from genre, franchise or setting in the context.`;

async function buildTitleContext(titleId?: string): Promise<string> {
  if (!titleId) return "No specific title is currently open.";
  const [prefix, externalId] = titleId.split(":");
  try {
    const detail =
      prefix === "game" ? await igdb.getGameDetail(externalId) : await tmdb.getDetail(prefix as "movie" | "tv", externalId);

    // Games carry different meaningful facts than film/TV (platforms and
    // developer rather than cast), so the context includes whichever the
    // provider actually returned instead of a film-shaped summary for
    // everything.
    return [
      `Title: ${detail.name} (${detail.mediaType})`,
      `Release: ${detail.releaseWindow.date ?? "unknown"} (precision: ${detail.releaseWindow.precision})`,
      `Overview: ${detail.overview || "not provided"}`,
      detail.genres.length ? `Genres: ${detail.genres.map((g) => g.name).join(", ")}` : "",
      detail.cast.length ? `Cast: ${detail.cast.slice(0, 6).map((c) => c.name).join(", ")}` : "",
      detail.developer ? `Developer: ${detail.developer}` : "",
      detail.platforms?.length ? `Platforms: ${detail.platforms.join(", ")}` : "",
      detail.seasons?.length ? `Seasons: ${detail.seasons.length}` : "",
      detail.franchise ? `Franchise: ${detail.franchise.name} (Slate can build a journey for this franchise)` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "Title context could not be loaded right now.";
  }
}

/**
 * The user's own entertainment universe, so "what should I watch tonight?"
 * is answered from what they actually follow rather than generic picks.
 * Capped to keep the prompt small and the token cost predictable.
 */
async function buildUserContext(userId: string): Promise<string> {
  const [follows, watchlist] = await Promise.all([
    prisma.follow.findMany({ where: { userId }, include: { title: true }, take: 15, orderBy: { createdAt: "desc" } }),
    prisma.watchlistItem.findMany({
      where: { userId, status: { in: ["WANT_TO_WATCH", "WATCHING"] } },
      include: { title: true },
      take: 15,
      orderBy: { addedAt: "desc" },
    }),
  ]);

  if (follows.length === 0 && watchlist.length === 0) {
    return "The user hasn't followed or watchlisted anything yet.";
  }

  const describe = (items: { title: { name: string; mediaType: string } }[]) =>
    items.map((i) => `${i.title.name} (${i.title.mediaType.toLowerCase()})`).join(", ");

  return [
    follows.length ? `User follows: ${describe(follows)}` : "",
    watchlist.length ? `User's watchlist: ${describe(watchlist)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function aiRoutes(app: FastifyInstance) {
  app.get("/ai/usage", { preHandler: [app.authenticate] }, async (req, reply) => {
    const [limit, used] = await Promise.all([getDailyLimit(req.userId), getUsedToday(req.userId)]);
    return reply.send({ limit, used, remaining: Math.max(0, limit - used) });
  });

  app.post("/ai/ask", { preHandler: [app.authenticate], config: { rateLimit: AI_RATE_LIMIT } }, async (req, reply) => {
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

    const [titleContext, userContext] = await Promise.all([
      buildTitleContext(body.titleId),
      buildUserContext(req.userId),
    ]);

    try {
      const result = await openAiProvider.complete([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "system",
          content: `CONTEXT:\nSpoiler sensitivity: ${body.spoilerSensitivity}\n${titleContext}\n${userContext}`,
        },
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
