import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { ensureTitleExists } from "../titles/ensure-title";
import { dispatchNotification } from "../notifications/dispatch";
import { WRITE_RATE_LIMIT, PROVIDER_RATE_LIMIT } from "../../plugins/rate-limits";
import { canModerate } from "./authorization";
import { BlockError, blockUser, blockedIdsFor, excludeBlockedAuthors, listBlockedUsers, unblockUser } from "./blocks.service";

const postKindSchema = z.enum(["DISCUSSION", "PREDICTION", "THEORY", "REVIEW"]);
const reactionKindSchema = z.enum(["HYPE", "LOVE", "MINDBLOWN", "LAUGH", "SKEPTICAL"]);
const reportReasonSchema = z.enum(["SPAM", "HARASSMENT", "UNMARKED_SPOILER", "MISINFORMATION", "OTHER"]);

async function reactionCounts(postId: string) {
  const grouped = await prisma.reaction.groupBy({ by: ["kind"], where: { postId }, _count: true });
  const counts: Record<string, number> = { HYPE: 0, LOVE: 0, MINDBLOWN: 0, LAUGH: 0, SKEPTICAL: 0 };
  for (const g of grouped) counts[g.kind] = g._count;
  return counts;
}

export async function communityRoutes(app: FastifyInstance) {
  app.get(
    "/community/posts",
    { preHandler: [app.optionalAuthenticate], config: { rateLimit: PROVIDER_RATE_LIMIT } },
    async (req, reply) => {
    const query = z
      .object({ titleId: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().min(1).max(50).default(20) })
      .parse(req.query);

    const blockedIds = await blockedIdsFor(req.viewerId);

    const posts = await prisma.communityPost.findMany({
      where: { titleId: query.titleId, deletedAt: null, ...excludeBlockedAuthors(blockedIds) },
      include: { author: true, _count: { select: { comments: true } } },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const withCounts = await Promise.all(
      posts.map(async (p) => ({
        id: p.id,
        authorId: p.authorId,
        authorHandle: p.author.handle,
        titleId: p.titleId,
        kind: p.kind,
        body: p.body,
        containsSpoilers: p.containsSpoilers,
        createdAt: p.createdAt.toISOString(),
        commentCount: p._count.comments,
        reactionCounts: await reactionCounts(p.id),
      })),
    );

    return reply.send({ posts: withCounts, nextCursor: posts.length === query.limit ? posts[posts.length - 1].id : null });
    },
  );

  app.get(
    "/community/posts/:id",
    { preHandler: [app.optionalAuthenticate], config: { rateLimit: PROVIDER_RATE_LIMIT } },
    async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const post = await prisma.communityPost.findUnique({
      where: { id: params.id },
      include: { author: true, _count: { select: { comments: true } } },
    });
    if (!post || post.deletedAt) return reply.code(404).send({ error: "Post not found." });

    // A blocked author's post is treated as not existing for this viewer,
    // rather than 403 — which would confirm the post is there and who wrote
    // it. Deep links to blocked content dead-end quietly.
    const blockedIds = await blockedIdsFor(req.viewerId);
    if (blockedIds.includes(post.authorId)) return reply.code(404).send({ error: "Post not found." });

    return reply.send({
      post: {
        id: post.id,
        authorId: post.authorId,
        authorHandle: post.author.handle,
        titleId: post.titleId,
        kind: post.kind,
        body: post.body,
        containsSpoilers: post.containsSpoilers,
        createdAt: post.createdAt.toISOString(),
        commentCount: post._count.comments,
        reactionCounts: await reactionCounts(post.id),
      },
    });
    },
  );

  app.post("/community/posts", { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } }, async (req, reply) => {
    const body = z
      .object({
        titleId: z.string(),
        kind: postKindSchema.default("DISCUSSION"),
        body: z.string().min(1).max(2000),
        containsSpoilers: z.boolean().default(false),
      })
      .parse(req.body);

    try {
      await ensureTitleExists(body.titleId);
    } catch {
      return reply.code(502).send({ error: "Could not resolve title." });
    }

    const post = await prisma.communityPost.create({
      data: {
        authorId: req.userId,
        titleId: body.titleId,
        kind: body.kind,
        body: body.body,
        containsSpoilers: body.containsSpoilers,
      },
    });
    return reply.code(201).send({ post });
  });

  app.delete("/community/posts/:id", { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const post = await prisma.communityPost.findUnique({ where: { id: params.id } });
    if (!post) return reply.code(404).send({ error: "Not found." });
    if (!canModerate(req.userId, req.userRole, post.authorId)) {
      return reply.code(403).send({ error: "Not authorized to delete this post." });
    }
    await prisma.communityPost.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    return reply.code(204).send();
  });

  /**
   * Users must be able to remove their own comments — previously there was
   * no way to, which left content permanently un-deletable by its author.
   * Soft-deleted so moderation history stays intact.
   */
  app.delete(
    "/community/comments/:id",
    { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } },
    async (req, reply) => {
      const params = z.object({ id: z.string() }).parse(req.params);
      const comment = await prisma.communityComment.findUnique({ where: { id: params.id } });
      if (!comment || comment.deletedAt) return reply.code(404).send({ error: "Not found." });
      if (!canModerate(req.userId, req.userRole, comment.authorId)) {
        return reply.code(403).send({ error: "Not authorized to delete this comment." });
      }
      await prisma.communityComment.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
      return reply.code(204).send();
    },
  );

  app.get(
    "/community/posts/:id/comments",
    { preHandler: [app.optionalAuthenticate], config: { rateLimit: PROVIDER_RATE_LIMIT } },
    async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const blockedIds = await blockedIdsFor(req.viewerId);
    const comments = await prisma.communityComment.findMany({
      where: { postId: params.id, deletedAt: null, ...excludeBlockedAuthors(blockedIds) },
      include: { author: true },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({
      comments: comments.map((c) => ({
        id: c.id,
        postId: c.postId,
        authorId: c.authorId,
        authorHandle: c.author.handle,
        body: c.body,
        containsSpoilers: c.containsSpoilers,
        parentCommentId: c.parentCommentId,
        createdAt: c.createdAt.toISOString(),
      })),
    });
    },
  );

  app.post("/community/posts/:id/comments", { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ body: z.string().min(1).max(1000), containsSpoilers: z.boolean().default(false), parentCommentId: z.string().optional() })
      .parse(req.body);

    const post = await prisma.communityPost.findUnique({ where: { id: params.id } });
    if (!post || post.deletedAt) return reply.code(404).send({ error: "Post not found." });

    const comment = await prisma.communityComment.create({
      data: { postId: params.id, authorId: req.userId, ...body },
    });

    if (post.authorId !== req.userId) {
      await dispatchNotification({
        userId: post.authorId,
        type: "COMMUNITY_REPLY",
        title: "New reply on your post",
        body: body.body.slice(0, 140),
        data: { postId: post.id, commentId: comment.id },
      });
    }

    return reply.code(201).send({ comment });
  });

  app.post("/community/posts/:id/reactions", { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ kind: reactionKindSchema }).parse(req.body);

    await prisma.reaction.upsert({
      where: { userId_postId_kind: { userId: req.userId, postId: params.id, kind: body.kind } },
      create: { userId: req.userId, postId: params.id, kind: body.kind },
      update: {},
    });
    return reply.code(201).send({ counts: await reactionCounts(params.id) });
  });

  app.delete("/community/posts/:id/reactions/:kind", { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } }, async (req, reply) => {
    const params = z.object({ id: z.string(), kind: reactionKindSchema }).parse(req.params);
    await prisma.reaction.deleteMany({ where: { userId: req.userId, postId: params.id, kind: params.kind } });
    return reply.send({ counts: await reactionCounts(params.id) });
  });

  app.post("/community/reports", { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } }, async (req, reply) => {
    const body = z
      .object({
        targetType: z.enum(["post", "comment"]),
        targetId: z.string(),
        reason: reportReasonSchema,
        details: z.string().max(500).optional(),
      })
      .parse(req.body);

    const report = await prisma.report.create({
      data: {
        reporterId: req.userId,
        reason: body.reason,
        details: body.details,
        postId: body.targetType === "post" ? body.targetId : undefined,
        commentId: body.targetType === "comment" ? body.targetId : undefined,
      },
    });
    return reply.code(201).send({ report });
  });

  /**
   * Blocking. Required by Google Play's User Generated Content policy
   * alongside reporting: reporting asks Slate to act, blocking lets the
   * user act immediately for themselves.
   */
  app.get("/community/blocks", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send({ blocked: await listBlockedUsers(req.userId) });
  });

  app.post(
    "/community/blocks",
    { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } },
    async (req, reply) => {
      const body = z.object({ userId: z.string() }).parse(req.body);
      try {
        await blockUser(req.userId, body.userId);
      } catch (err) {
        if (err instanceof BlockError) return reply.code(400).send({ error: err.message, code: err.code });
        throw err;
      }
      return reply.code(201).send({ blocked: true });
    },
  );

  app.delete(
    "/community/blocks/:userId",
    { preHandler: [app.authenticate], config: { rateLimit: WRITE_RATE_LIMIT } },
    async (req, reply) => {
      const params = z.object({ userId: z.string() }).parse(req.params);
      await unblockUser(req.userId, params.userId);
      return reply.code(204).send();
    },
  );
}
