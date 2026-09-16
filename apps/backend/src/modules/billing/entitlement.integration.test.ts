import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../prisma";
import { hashPassword } from "../auth/auth.service";
import {
  applyVerifiedPurchase,
  getEntitlement,
  isEntitlementActive,
  InvalidPurchaseError,
  PurchaseTokenAlreadyBoundError,
} from "./entitlement.service";
import type { PlaySubscriptionPurchase } from "./play-verification";

/**
 * Billing behaviour that only a real database can demonstrate: idempotency
 * under redelivery, purchase-token ownership, and the entitlement state
 * transitions that decide whether a paying user has Pro.
 *
 * These drive `applyVerifiedPurchase` with the shape Google's
 * subscriptionsv2.get actually returns. The Play API itself is not called
 * and not faked — the code under test is Slate's handling of the answer,
 * which is where every bug in this subsystem has been.
 *
 * Skipped automatically when no database is configured, so `vitest run`
 * stays green on a machine without Postgres.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const run = Math.floor(Math.random() * 1e9);
const createdUserIds: string[] = [];

function purchase(
  state: string,
  productId = "SLATE_PRO_MONTHLY",
  expiry: Date = new Date(Date.now() + 30 * 86400_000),
): PlaySubscriptionPurchase {
  return {
    subscriptionState: state,
    lineItems: [
      { productId, expiryTime: expiry.toISOString(), autoRenewingPlan: { autoRenewEnabled: true } },
    ],
  };
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `bill_${tag}_${run}@slate.test`,
      passwordHash: await hashPassword("CorrectHorse1!"),
      handle: `bill_${tag}_${run}`.slice(0, 20),
      displayName: tag,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function isPro(userId: string): Promise<boolean> {
  const e = await getEntitlement(userId);
  return e ? isEntitlementActive(e.status, e.expiresAt) : false;
}

suite("billing entitlement (database-backed)", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    // Cascades remove the entitlements and purchase events with the users.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("A: a user with no entitlement is Free", async () => {
    expect(await isPro(await makeUser("a"))).toBe(false);
  });

  it("B: a verified monthly purchase grants Pro", async () => {
    const userId = await makeUser("b");
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE"), `tok-b-${run}`);
    expect(await isPro(userId)).toBe(true);
    expect((await getEntitlement(userId))?.productId).toBe("SLATE_PRO_MONTHLY");
  });

  it("C: a verified annual purchase grants Pro", async () => {
    const userId = await makeUser("c");
    const expiry = new Date(Date.now() + 365 * 86400_000);
    await applyVerifiedPurchase(
      userId,
      purchase("SUBSCRIPTION_STATE_ACTIVE", "SLATE_PRO_YEARLY", expiry),
      `tok-c-${run}`,
    );
    expect(await isPro(userId)).toBe(true);
    expect((await getEntitlement(userId))?.productId).toBe("SLATE_PRO_YEARLY");
  });

  it("D: an expired subscription drops the user to Free", async () => {
    const userId = await makeUser("d");
    await applyVerifiedPurchase(
      userId,
      purchase("SUBSCRIPTION_STATE_EXPIRED", "SLATE_PRO_MONTHLY", new Date(Date.now() - 86400_000)),
      `tok-d-${run}`,
    );
    expect(await isPro(userId)).toBe(false);
  });

  it("E: a pending purchase does not grant Pro", async () => {
    const userId = await makeUser("e");
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_PENDING"), `tok-e-${run}`);
    expect(await isPro(userId)).toBe(false);
    expect((await getEntitlement(userId))?.status).toBe("PENDING");
  });

  it("F: a purchase for an unknown product is rejected", async () => {
    const userId = await makeUser("f");
    await expect(
      applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE", "SOME_OTHER_APP_SKU"), `tok-f-${run}`),
    ).rejects.toBeInstanceOf(InvalidPurchaseError);
    expect(await isPro(userId)).toBe(false);
  });

  it("F2: a purchase with an unusable expiry is rejected rather than silently denied", async () => {
    const userId = await makeUser("f2");
    const broken = purchase("SUBSCRIPTION_STATE_ACTIVE");
    broken.lineItems[0].expiryTime = "not-a-date";
    await expect(applyVerifiedPurchase(userId, broken, `tok-f2-${run}`)).rejects.toBeInstanceOf(
      InvalidPurchaseError,
    );
  });

  it("G: replaying the same notification is idempotent", async () => {
    const userId = await makeUser("g");
    const token = `tok-g-${run}`;

    // A Pub/Sub redelivery is the *same* message arriving again, so it carries
    // the identical expiry Google already sent. Building the purchase once and
    // replaying that object is what redelivery actually looks like; rebuilding
    // it would produce a later expiry, which is a renewal, not a duplicate.
    const notification = purchase("SUBSCRIPTION_STATE_ACTIVE");
    await applyVerifiedPurchase(userId, notification, token);
    await applyVerifiedPurchase(userId, notification, token);
    await applyVerifiedPurchase(userId, notification, token);

    const events = await prisma.purchaseEvent.count({ where: { purchaseToken: token } });
    expect(events).toBe(1);
    expect(await isPro(userId)).toBe(true);
  });

  it("G2: concurrent redelivery of one notification does not error", async () => {
    // Pub/Sub delivers at-least-once and can deliver in parallel. Both
    // callers pass the check-then-act guard; the loser must be swallowed,
    // or the webhook 500s and Google retries the same message forever.
    const userId = await makeUser("g2");
    const token = `tok-g2-${run}`;
    const p = purchase("SUBSCRIPTION_STATE_ACTIVE");
    await expect(
      Promise.all([
        applyVerifiedPurchase(userId, p, token),
        applyVerifiedPurchase(userId, p, token),
        applyVerifiedPurchase(userId, p, token),
      ]),
    ).resolves.toBeDefined();
    expect(await prisma.purchaseEvent.count({ where: { purchaseToken: token } })).toBe(1);
  });

  it("J: restore re-applies the same token for the same user without duplicating state", async () => {
    const userId = await makeUser("j");
    const token = `tok-j-${run}`;
    const owned = purchase("SUBSCRIPTION_STATE_ACTIVE");
    await applyVerifiedPurchase(userId, owned, token);

    // Reinstall: the client replays the same purchase Play still reports.
    await applyVerifiedPurchase(userId, owned, token);

    expect(await isPro(userId)).toBe(true);
    expect(await prisma.entitlement.count({ where: { userId } })).toBe(1);
  });

  it("K: a purchase token cannot be moved to a second account", async () => {
    const victim = await makeUser("k1");
    const attacker = await makeUser("k2");
    const token = `tok-k-${run}`;

    await applyVerifiedPurchase(victim, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);

    // The naive replay is caught by the (token, status) uniqueness. The real
    // opening is a state Slate has not recorded for this token yet, which
    // any renewal or payment hiccup produces.
    await expect(
      applyVerifiedPurchase(attacker, purchase("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), token),
    ).rejects.toBeInstanceOf(PurchaseTokenAlreadyBoundError);

    expect(await isPro(attacker)).toBe(false);
    expect(await isPro(victim)).toBe(true);

    // RTDN carries no Slate identity and matches on the token alone, so
    // exactly one entitlement may ever hold it.
    expect(await prisma.entitlement.count({ where: { latestPurchaseToken: token } })).toBe(1);
  });

  it("K2: the original owner can still resubmit their own token", async () => {
    const userId = await makeUser("k3");
    const token = `tok-k3-${run}`;
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), token);
    expect(await isPro(userId)).toBe(true);
    expect((await getEntitlement(userId))?.status).toBe("GRACE_PERIOD");
  });

  // Part 2 of Gate 3.5: every transition Google can report, checked for both
  // the entitlement outcome and — the security property — that no transition
  // lets a stale token move ownership to another account.
  // The single most common notification Slate will ever receive, and the one
  // that was being silently dropped: a renewal reports ACTIVE again with a
  // later expiry. If this regresses, every subscriber loses Pro one billing
  // period after paying, while Google keeps charging them.
  it("applies a renewal that repeats the ACTIVE state with a later expiry", async () => {
    const userId = await makeUser("rn");
    const token = `tok-rn-${run}`;

    const period1 = new Date(Date.now() + 30 * 86400_000);
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE", "SLATE_PRO_MONTHLY", period1), token);
    expect((await getEntitlement(userId))?.expiresAt?.getTime()).toBe(period1.getTime());

    const period2 = new Date(Date.now() + 60 * 86400_000);
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE", "SLATE_PRO_MONTHLY", period2), token);

    expect((await getEntitlement(userId))?.expiresAt?.getTime()).toBe(period2.getTime());
    expect(await isPro(userId)).toBe(true);
    // Both renewals are real, distinct events and both belong in the audit log.
    expect(await prisma.purchaseEvent.count({ where: { purchaseToken: token } })).toBe(2);
  });

  it("ACTIVE -> IN_GRACE_PERIOD -> ACTIVE keeps Pro throughout", async () => {
    const userId = await makeUser("t1");
    const token = `tok-t1-${run}`;

    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);
    expect(await isPro(userId)).toBe(true);

    // A card fails; Google retries. Dropping the user to Free mid-retry
    // punishes them for their bank.
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), token);
    expect(await isPro(userId)).toBe(true);
    expect((await getEntitlement(userId))?.status).toBe("GRACE_PERIOD");

    // Payment recovers.
    await applyVerifiedPurchase(
      userId,
      purchase("SUBSCRIPTION_STATE_ACTIVE", "SLATE_PRO_MONTHLY", new Date(Date.now() + 31 * 86400_000)),
      token,
    );
    expect(await isPro(userId)).toBe(true);
    expect((await getEntitlement(userId))?.status).toBe("ACTIVE");
  });

  it("ACTIVE -> EXPIRED drops to Free", async () => {
    const userId = await makeUser("t2");
    const token = `tok-t2-${run}`;
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);
    await applyVerifiedPurchase(
      userId,
      purchase("SUBSCRIPTION_STATE_EXPIRED", "SLATE_PRO_MONTHLY", new Date(Date.now() - 1000)),
      token,
    );
    expect(await isPro(userId)).toBe(false);
  });

  it("PENDING -> PURCHASED grants Pro only once Google completes it", async () => {
    const userId = await makeUser("t3");
    const token = `tok-t3-${run}`;

    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_PENDING"), token);
    expect(await isPro(userId)).toBe(false);

    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);
    expect(await isPro(userId)).toBe(true);
  });

  it("PENDING -> CANCELED never grants Pro", async () => {
    const userId = await makeUser("t4");
    const token = `tok-t4-${run}`;

    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_PENDING"), token);
    expect(await isPro(userId)).toBe(false);

    // Cancelled before it ever completed: expiry is in the past, so the
    // "cancelled but paid up" allowance must not apply.
    await applyVerifiedPurchase(
      userId,
      purchase("SUBSCRIPTION_STATE_CANCELED", "SLATE_PRO_MONTHLY", new Date(Date.now() - 1000)),
      token,
    );
    expect(await isPro(userId)).toBe(false);
  });

  it("no state transition lets a stale token move ownership", async () => {
    const victim = await makeUser("t5a");
    const attacker = await makeUser("t5b");
    const token = `tok-t5-${run}`;

    await applyVerifiedPurchase(victim, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);

    // Every state Google can report, replayed by a second account. Each is a
    // (token, status) pair Slate has not recorded, so the idempotency
    // constraint does not fire — only the ownership check stands between the
    // attacker and Pro.
    const states = [
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_ON_HOLD",
      "SUBSCRIPTION_STATE_CANCELED",
      "SUBSCRIPTION_STATE_EXPIRED",
      "SUBSCRIPTION_STATE_PENDING",
      "SUBSCRIPTION_STATE_UNSPECIFIED",
    ];
    for (const state of states) {
      await expect(
        applyVerifiedPurchase(attacker, purchase(state), token),
      ).rejects.toBeInstanceOf(PurchaseTokenAlreadyBoundError);
    }

    expect(await isPro(attacker)).toBe(false);
    expect(await getEntitlement(attacker)).toBeNull();
    expect(await isPro(victim)).toBe(true);
    // RTDN matches on the token alone, so exactly one entitlement may hold it.
    expect(await prisma.entitlement.count({ where: { latestPurchaseToken: token } })).toBe(1);
  });

  it("ownership survives the victim's own subscription expiring", async () => {
    // The dangerous window: once the original owner lapses, a stale token
    // must still not be redeemable by anyone else.
    const victim = await makeUser("t6a");
    const attacker = await makeUser("t6b");
    const token = `tok-t6-${run}`;

    await applyVerifiedPurchase(victim, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);
    await applyVerifiedPurchase(
      victim,
      purchase("SUBSCRIPTION_STATE_EXPIRED", "SLATE_PRO_MONTHLY", new Date(Date.now() - 1000)),
      token,
    );
    expect(await isPro(victim)).toBe(false);

    await expect(
      applyVerifiedPurchase(attacker, purchase("SUBSCRIPTION_STATE_ACTIVE"), token),
    ).rejects.toBeInstanceOf(PurchaseTokenAlreadyBoundError);
    expect(await isPro(attacker)).toBe(false);
  });

  it("transitions ACTIVE -> CANCELLED -> EXPIRED as Google reports them", async () => {
    const userId = await makeUser("t");
    const token = `tok-t-${run}`;

    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_ACTIVE"), token);
    expect(await isPro(userId)).toBe(true);

    // Cancelled but still inside the paid period: access continues.
    await applyVerifiedPurchase(userId, purchase("SUBSCRIPTION_STATE_CANCELED"), token);
    expect(await isPro(userId)).toBe(true);

    // Period over: access ends.
    await applyVerifiedPurchase(
      userId,
      purchase("SUBSCRIPTION_STATE_EXPIRED", "SLATE_PRO_MONTHLY", new Date(Date.now() - 1000)),
      token,
    );
    expect(await isPro(userId)).toBe(false);
  });
});
