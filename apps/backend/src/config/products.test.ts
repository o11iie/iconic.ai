import { describe, expect, it } from "vitest";
import { getProductCatalog, isValidProductId, PRODUCT_CATALOG } from "./products";

describe("product catalog", () => {
  it("exposes exactly the monthly and yearly Slate Pro products", () => {
    const ids = getProductCatalog().map((p) => p.productId);
    expect(ids).toEqual(["SLATE_PRO_MONTHLY", "SLATE_PRO_YEARLY"]);
  });

  it("matches the pricing hypothesis without hardcoding it elsewhere", () => {
    expect(PRODUCT_CATALOG.SLATE_PRO_MONTHLY.referencePriceUsd).toBe(5.99);
    expect(PRODUCT_CATALOG.SLATE_PRO_YEARLY.referencePriceUsd).toBe(49.99);
  });

  it("rejects unknown product ids", () => {
    expect(isValidProductId("SLATE_PRO_MONTHLY")).toBe(true);
    expect(isValidProductId("NOT_A_PRODUCT")).toBe(false);
  });
});
