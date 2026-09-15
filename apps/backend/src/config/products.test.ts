import { describe, expect, it } from "vitest";
import { annualSavings, getProductCatalog, isValidProductId, PRODUCT_CATALOG } from "./products";

describe("product catalog", () => {
  it("exposes exactly the monthly and yearly Slate Pro products", () => {
    const ids = getProductCatalog().map((p) => p.productId);
    expect(ids).toEqual(["SLATE_PRO_MONTHLY", "SLATE_PRO_YEARLY"]);
  });

  it("matches the current pricing without hardcoding it elsewhere", () => {
    expect(PRODUCT_CATALOG.SLATE_PRO_MONTHLY.referencePriceUsd).toBe(7.99);
    expect(PRODUCT_CATALOG.SLATE_PRO_YEARLY.referencePriceUsd).toBe(59.99);
  });

  // The annual pitch is computed from the real prices, so marketing copy
  // can never drift from what a user is actually charged.
  it("derives annual savings from the catalog rather than a written-down claim", () => {
    const savings = annualSavings();
    expect(savings.percent).toBe(37); // (95.88 - 59.99) / 95.88
    expect(savings.amountUsd).toBe(35.89);
    expect(savings.monthlyEquivalentUsd).toBe(5);
  });

  it("keeps the annual plan genuinely cheaper than paying monthly", () => {
    const monthlyYearlyTotal = PRODUCT_CATALOG.SLATE_PRO_MONTHLY.referencePriceUsd * 12;
    expect(PRODUCT_CATALOG.SLATE_PRO_YEARLY.referencePriceUsd).toBeLessThan(monthlyYearlyTotal);
  });

  it("rejects unknown product ids", () => {
    expect(isValidProductId("SLATE_PRO_MONTHLY")).toBe(true);
    expect(isValidProductId("NOT_A_PRODUCT")).toBe(false);
  });
});
