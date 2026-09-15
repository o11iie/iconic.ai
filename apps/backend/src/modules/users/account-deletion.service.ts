import { EntitlementStatus } from "@prisma/client";
import { prisma } from "../../prisma";

/**
 * Account deletion, as required by Google Play for any app that lets users
 * create an account.
 *
 * The hard design problem: community posts and comments are threaded. A
 * plain cascade delete of the user would cascade to their posts, and from
 * there to *other people's* comments on those posts — destroying data
 * belonging to users who never asked for anything to be deleted.
 *
 * So Slate splits the work:
 *
 *   DELETED outright — everything personal to the user: profile, email,
 *   credentials, sessions, follows, watchlist, notifications, AI
 *   conversations and usage, reactions, blocks, entitlement.
 *
 *   ANONYMIZED — authored community content and filed reports. Authorship
 *   is reassigned to a single non-login sentinel account and the body text
 *   is scrubbed, so the user's words and identity are gone while the
 *   thread other people participated in stays intact, and moderation
 *   records remain reviewable.
 *
 *   AUTO-ANONYMIZED — analytics events, whose userId is already
 *   `onDelete: SetNull`, so they survive as unattributed counts.
 *
 * This is deletion, not deactivation: the User row is removed and the
 * account cannot be recovered or logged into afterwards.
 */

/**
 * Statuses where Google Play may still bill the user. ON_HOLD and
 * GRACE_PERIOD count: the subscription is not cancelled, it is in
 * recovery, so the user still needs to cancel it in Play.
 */
const BILLING_ACTIVE_STATUSES: EntitlementStatus[] = [
  EntitlementStatus.ACTIVE,
  EntitlementStatus.PENDING,
  EntitlementStatus.GRACE_PERIOD,
  EntitlementStatus.ON_HOLD,
];

/** Stable id for the tombstone account that owns anonymized content. */
const DELETED_USER_ID = "__deleted_user__";
const SCRUBBED_BODY = "[deleted]";

/**
 * The sentinel is a real row (so foreign keys stay valid) but can never be
 * logged into: its password hash is an impossible bcrypt value, and its
 * email is reserved.
 */
async function ensureSentinelUser(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { id: DELETED_USER_ID }, select: { id: true } });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {
      id: DELETED_USER_ID,
      email: "deleted-user@slate.invalid",
      // Not a valid bcrypt hash, so no password can ever match it.
      passwordHash: "ACCOUNT_DELETED_NO_LOGIN",
      handle: "deleted",
      displayName: "[deleted]",
      notificationsEnabled: false,
    },
  });
  return created.id;
}

export interface DeletionSummary {
  postsAnonymized: number;
  commentsAnonymized: number;
  reportsAnonymized: number;
  /**
   * True when the account still held a Play-billed entitlement at deletion
   * time. Deleting a Slate account does NOT cancel a Google Play
   * subscription — only Google can do that — so the caller must tell the
   * user to cancel it themselves or they will keep being charged.
   */
  hadActiveSubscription: boolean;
}

export async function deleteAccount(userId: string): Promise<DeletionSummary> {
  if (userId === DELETED_USER_ID) {
    throw new Error("The deleted-user sentinel cannot be deleted.");
  }

  const sentinelId = await ensureSentinelUser();

  // One transaction so a partial failure can't leave an account half
  // deleted — either the user is gone and their content anonymized, or
  // nothing changed and the caller can retry.
  return prisma.$transaction(async (tx) => {
    // Read before the cascade removes it.
    const entitlement = await tx.entitlement.findUnique({
      where: { userId },
      select: { status: true },
    });
    const hadActiveSubscription =
      entitlement != null && BILLING_ACTIVE_STATUSES.includes(entitlement.status);

    const posts = await tx.communityPost.updateMany({
      where: { authorId: userId },
      data: { authorId: sentinelId, body: SCRUBBED_BODY, deletedAt: new Date() },
    });

    const comments = await tx.communityComment.updateMany({
      where: { authorId: userId },
      data: { authorId: sentinelId, body: SCRUBBED_BODY, deletedAt: new Date() },
    });

    // Reports stay reviewable by moderators, but stop pointing at a real
    // person. The reported content itself is unaffected.
    const reports = await tx.report.updateMany({
      where: { reporterId: userId },
      data: { reporterId: sentinelId },
    });

    // Reactions are personal signal, not shared thread content — remove
    // them outright rather than attributing them to the sentinel.
    await tx.reaction.deleteMany({ where: { userId } });

    // Everything else personal is removed by the schema's cascade rules
    // when the User row goes: refresh tokens, follows, watchlist, saved
    // journeys, notifications, AI conversations/messages/usage, blocks in
    // both directions, and the entitlement plus its purchase-event audit
    // trail.
    await tx.user.delete({ where: { id: userId } });

    return {
      postsAnonymized: posts.count,
      commentsAnonymized: comments.count,
      reportsAnonymized: reports.count,
      hadActiveSubscription,
    };
  });
}
