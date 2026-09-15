import { describe, expect, it } from "vitest";
import { isEntitlementActive } from "./entitlement.service";

const future = () => new Date(Date.now() + 30 * 86400_000);
const past = () => new Date(Date.now() - 86400_000);

/**
 * The single question the whole billing subsystem exists to answer: is this
 * user Pro right now? Everything else — Play verification, RTDN, restore —
 * feeds this function, so its edges are worth pinning down precisely.
 */
describe("isEntitlementActive", () => {
  it("grants Pro for an active subscription that has not expired", () => {
    expect(isEntitlementActive("ACTIVE", future())).toBe(true);
  });

  // A cancelled subscription is paid up to the end of the period the user
  // already bought. Revoking immediately on cancel would be taking money for
  // time not served.
  it("keeps Pro after cancellation until the paid period ends", () => {
    expect(isEntitlementActive("CANCELLED", future())).toBe(true);
    expect(isEntitlementActive("CANCELLED", past())).toBe(false);
  });

  // Google's grace period is for a failed payment it is still retrying.
  // Dropping the user to Free mid-retry punishes them for their bank.
  it("keeps Pro during a payment grace period", () => {
    expect(isEntitlementActive("GRACE_PERIOD", future())).toBe(true);
  });

  // The expiry check has to win over the status. An ACTIVE row whose expiry
  // has passed means a renewal notification was missed, not that the user
  // has paid — treating it as entitled would give away Pro indefinitely.
  it("denies Pro once expiry has passed, whatever the status says", () => {
    expect(isEntitlementActive("ACTIVE", past())).toBe(false);
    expect(isEntitlementActive("GRACE_PERIOD", past())).toBe(false);
  });

  // PENDING is a purchase Google has not completed — a slow card, a
  // pending-transaction payment method. It must not read as paid.
  it("denies Pro for a pending purchase", () => {
    expect(isEntitlementActive("PENDING", future())).toBe(false);
  });

  it("denies Pro for on-hold, expired, revoked and absent entitlements", () => {
    expect(isEntitlementActive("ON_HOLD", future())).toBe(false);
    expect(isEntitlementActive("EXPIRED", future())).toBe(false);
    expect(isEntitlementActive("REVOKED", future())).toBe(false);
    expect(isEntitlementActive("NONE", future())).toBe(false);
  });

  // No expiry means Slate never learned when the subscription ends. Failing
  // open here would be an unbounded free Pro grant.
  it("fails closed when expiry is unknown", () => {
    expect(isEntitlementActive("ACTIVE", null)).toBe(false);
  });
});
