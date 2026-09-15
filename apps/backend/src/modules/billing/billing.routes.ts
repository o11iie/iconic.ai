import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "../../env";
import { annualSavings, getProductCatalog, isValidProductId } from "../../config/products";
import { PLAN_LIMITS } from "@slate/shared";
import { verifySubscriptionPurchase, acknowledgeSubscriptionPurchase, PlayBillingNotConfiguredError } from "./play-verification";
import {
  applyVerifiedPurchase,
  getEntitlement,
  isEntitlementActive,
  InvalidPurchaseError,
  PurchaseTokenAlreadyBoundError,
} from "./entitlement.service";
import { prisma } from "../../prisma";

export async function billingRoutes(app: FastifyInstance) {
  app.get("/billing/products", async (_req, reply) => {
    // Savings are derived from the catalog, never a written-down claim, so
    // the annual pitch can't drift from what's actually charged.
    return reply.send({ products: getProductCatalog(), annual: annualSavings(), limits: PLAN_LIMITS });
  });

  app.get("/billing/entitlement", { preHandler: [app.authenticate] }, async (req, reply) => {
    const entitlement = await getEntitlement(req.userId);
    if (!entitlement) return reply.send({ status: "NONE", isActive: false });
    return reply.send({
      status: entitlement.status,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt?.toISOString() ?? null,
      autoRenewing: entitlement.autoRenewing,
      isActive: isEntitlementActive(entitlement.status, entitlement.expiresAt),
    });
  });

  // Called by the mobile client immediately after Google Play Billing
  // returns a purchase, AND used for "Restore purchases" (client re-sends
  // whatever active purchase tokens Play Billing's queryPurchases returns).
  app.post("/billing/verify-purchase", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({ productId: z.string(), purchaseToken: z.string().min(1) }).parse(req.body);
    if (!isValidProductId(body.productId)) {
      return reply.code(400).send({ error: "Unknown product id." });
    }

    try {
      const purchase = await verifySubscriptionPurchase(body.purchaseToken);
      await applyVerifiedPurchase(req.userId, purchase, body.purchaseToken);

      if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
        await acknowledgeSubscriptionPurchase(body.productId, body.purchaseToken).catch((err) =>
          app.log.warn({ err }, "Failed to acknowledge Play purchase"),
        );
      }

      const entitlement = await getEntitlement(req.userId);
      return reply.send({
        status: entitlement?.status,
        expiresAt: entitlement?.expiresAt?.toISOString() ?? null,
        isActive: entitlement ? isEntitlementActive(entitlement.status, entitlement.expiresAt) : false,
      });
    } catch (err) {
      if (err instanceof PlayBillingNotConfiguredError) {
        return reply.code(503).send({ error: err.message, code: "BILLING_NOT_CONFIGURED" });
      }
      if (err instanceof PurchaseTokenAlreadyBoundError) {
        // 409, not 403: the purchase is genuine, it just belongs to another
        // account. The message deliberately does not say which one.
        app.log.warn(
          { userId: req.userId },
          "Rejected a purchase token already bound to a different account",
        );
        return reply.code(409).send({ error: err.message, code: "PURCHASE_ALREADY_LINKED" });
      }
      if (err instanceof InvalidPurchaseError) {
        return reply.code(400).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(502).send({ error: "Could not verify purchase with Google Play. Please try again." });
    }
  });

  /**
   * Real-Time Developer Notifications webhook (Google Pub/Sub push
   * subscription). Google delivers a base64-encoded JSON payload containing
   * a purchaseToken + subscriptionId; Slate re-verifies via the Developer
   * API rather than trusting the notification body directly, and every
   * notification includes a userId lookup via the stored purchase token
   * since RTDN itself carries no Slate user identity.
   * https://developer.android.com/google/play/billing/rtdn-reference
   */
  app.post("/billing/rtdn", async (req, reply) => {
    // Verify the caller is really our Pub/Sub push subscription before doing
    // any work. Without this, anyone who learns the URL can make Slate issue
    // Play Developer API calls on demand. Compared in constant time so the
    // secret can't be recovered by timing the response.
    const expected = getEnv().RTDN_SHARED_SECRET;
    if (!expected) {
      app.log.error("RTDN webhook called but RTDN_SHARED_SECRET is not configured; refusing to process.");
      return reply.code(503).send({ error: "Webhook not configured.", code: "RTDN_NOT_CONFIGURED" });
    }
    const presented = (req.query as { token?: string }).token ?? "";
    const expectedBuf = Buffer.from(expected);
    const presentedBuf = Buffer.from(presented);
    const authorized =
      expectedBuf.length === presentedBuf.length && timingSafeEqual(expectedBuf, presentedBuf);
    if (!authorized) {
      app.log.warn("Rejected RTDN webhook with missing or invalid token.");
      return reply.code(401).send({ error: "Unauthorized." });
    }

    const body = z
      .object({ message: z.object({ data: z.string(), messageId: z.string() }) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Malformed Pub/Sub push payload." });

    const decoded = JSON.parse(Buffer.from(body.data.message.data, "base64").toString("utf8")) as {
      subscriptionNotification?: { purchaseToken: string; subscriptionId: string };
    };
    const purchaseToken = decoded.subscriptionNotification?.purchaseToken;
    if (!purchaseToken) return reply.code(200).send({ ok: true }); // not a subscription event we handle; ack to stop redelivery

    const entitlement = await prisma.entitlement.findFirst({ where: { latestPurchaseToken: purchaseToken } });
    if (!entitlement) {
      app.log.warn({ purchaseToken }, "RTDN for unknown purchase token — user has not yet linked this purchase.");
      return reply.code(200).send({ ok: true });
    }

    try {
      const purchase = await verifySubscriptionPurchase(purchaseToken);
      await applyVerifiedPurchase(entitlement.userId, purchase, purchaseToken);
    } catch (err) {
      if (err instanceof PlayBillingNotConfiguredError) {
        // A deployment problem, not a bad notification. 503 so Pub/Sub keeps
        // the message and redelivers once credentials are in place, and so
        // this is distinguishable from a genuine processing fault in logs.
        app.log.error("RTDN received but Play Billing credentials are not configured; cannot verify.");
        return reply.code(503).send({ error: "Billing not configured.", code: "BILLING_NOT_CONFIGURED" });
      }
      if (err instanceof PurchaseTokenAlreadyBoundError) {
        // The token routed to an entitlement that no longer owns it. Retrying
        // will never fix that, so acknowledge and surface it for a human.
        app.log.error({ purchaseToken }, "RTDN token is bound to a different account; not retrying.");
        return reply.code(200).send({ ok: true });
      }
      app.log.error({ err }, "Failed to process RTDN");
      return reply.code(500).send({ error: "Processing failed, please redeliver." });
    }

    return reply.code(200).send({ ok: true });
  });
}
