import { prisma } from "../../prisma";

/**
 * User blocking.
 *
 * Google Play's User Generated Content policy requires an app with social
 * features to offer both reporting *and* blocking. Reporting asks Slate to
 * act; blocking lets a user act for themselves, immediately, without
 * waiting on a moderator.
 *
 * Design decisions:
 *
 *   One-directional. Blocking hides the blocked user from the blocker's
 *   view. It does not hide the blocker from the blocked user, because a
 *   two-way disappearance tells the blocked user they were blocked, which
 *   invites retaliation.
 *
 *   Silent. The blocked user is never notified and cannot enumerate who
 *   blocked them — no endpoint exposes `blocksReceived`.
 *
 *   Filtering, not deleting. Blocked content still exists for everyone
 *   else; it is removed from the blocker's reads at query time.
 */

export class BlockError extends Error {
  constructor(message: string, readonly code: "SELF_BLOCK" | "USER_NOT_FOUND") {
    super(message);
  }
}

/** Ids the viewer has blocked. Empty for anonymous viewers. */
export async function blockedIdsFor(viewerId: string | undefined): Promise<string[]> {
  if (!viewerId) return [];
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: viewerId },
    select: { blockedId: true },
  });
  return rows.map((r) => r.blockedId);
}

/**
 * Prisma `where` fragment hiding blocked authors. Returns `{}` when there
 * is nothing to hide, so it can be spread into any query unconditionally
 * without adding a pointless `notIn: []`.
 */
export function excludeBlockedAuthors(blockedIds: string[]): { authorId?: { notIn: string[] } } {
  return blockedIds.length > 0 ? { authorId: { notIn: blockedIds } } : {};
}

export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) {
    throw new BlockError("You cannot block yourself.", "SELF_BLOCK");
  }

  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) throw new BlockError("That user does not exist.", "USER_NOT_FOUND");

  // Idempotent: blocking someone already blocked is a no-op, not an error.
  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
  });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
}

export async function listBlockedUsers(blockerId: string) {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId },
    include: { blocked: { select: { id: true, handle: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({
    userId: r.blocked.id,
    handle: r.blocked.handle,
    displayName: r.blocked.displayName,
    blockedAt: r.createdAt.toISOString(),
  }));
}
