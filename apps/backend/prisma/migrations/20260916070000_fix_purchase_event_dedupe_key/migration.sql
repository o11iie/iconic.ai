-- The old deduplication key was (purchaseToken, rawStatus). A subscription
-- returns to the same state repeatedly -- every renewal reports ACTIVE again,
-- and a recovered payment goes IN_GRACE_PERIOD -> ACTIVE -- so a renewal was
-- indistinguishable from a redelivery and was dropped. Paying subscribers
-- stayed pinned to their first expiry date and lost Pro one period later.
--
-- The expiry Google reports is what separates a new notification from a
-- redelivery of one already seen, so it joins the key.

-- Backfill: existing audit rows predate the column. The entitlement's current
-- expiry is the closest true value available for them, and processedAt is the
-- fallback where the entitlement never recorded one. Both are only ever read
-- for deduplication of notifications that have already been applied.
ALTER TABLE "PurchaseEvent" ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "PurchaseEvent" pe
SET "expiresAt" = COALESCE(e."expiresAt", pe."processedAt")
FROM "Entitlement" e
WHERE pe."entitlementId" = e."id" AND pe."expiresAt" IS NULL;

UPDATE "PurchaseEvent" SET "expiresAt" = "processedAt" WHERE "expiresAt" IS NULL;

ALTER TABLE "PurchaseEvent" ALTER COLUMN "expiresAt" SET NOT NULL;

DROP INDEX IF EXISTS "PurchaseEvent_purchaseToken_rawStatus_key";

CREATE UNIQUE INDEX "PurchaseEvent_purchaseToken_rawStatus_expiresAt_key"
  ON "PurchaseEvent"("purchaseToken", "rawStatus", "expiresAt");
