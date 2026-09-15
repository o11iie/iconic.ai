import type { ProductCatalogEntry, SlateProProductId } from "@slate/shared";

/**
 * Single source of truth for Slate Pro pricing/product identifiers.
 * Every price the app displays must read from here — never hardcode
 * "$5.99" or "$49.99" in routes, mobile screens, or copy. The actual
 * charged price is always whatever Google Play displays/localizes at
 * purchase time; these are the reference values used for the product
 * catalog response and any server-rendered pricing before purchase.
 */
export const PRODUCT_CATALOG: Record<SlateProProductId, ProductCatalogEntry> = {
  SLATE_PRO_MONTHLY: {
    productId: "SLATE_PRO_MONTHLY",
    referencePriceUsd: 7.99,
    billingPeriod: "P1M",
  },
  SLATE_PRO_YEARLY: {
    productId: "SLATE_PRO_YEARLY",
    referencePriceUsd: 59.99,
    billingPeriod: "P1Y",
  },
};

/**
 * Annual savings, derived rather than written down, so the marketing claim
 * can never drift from the actual prices above. Presented as a real
 * comparison against 12 months at the monthly rate — no inflated
 * "was $120" anchor.
 */
export function annualSavings(): { percent: number; amountUsd: number; monthlyEquivalentUsd: number } {
  const monthly = PRODUCT_CATALOG.SLATE_PRO_MONTHLY.referencePriceUsd;
  const yearly = PRODUCT_CATALOG.SLATE_PRO_YEARLY.referencePriceUsd;
  const twelveMonths = monthly * 12;
  return {
    percent: Math.round(((twelveMonths - yearly) / twelveMonths) * 100),
    amountUsd: Math.round((twelveMonths - yearly) * 100) / 100,
    monthlyEquivalentUsd: Math.round((yearly / 12) * 100) / 100,
  };
}

export function getProductCatalog(): ProductCatalogEntry[] {
  return Object.values(PRODUCT_CATALOG);
}

export function isValidProductId(id: string): id is SlateProProductId {
  return id in PRODUCT_CATALOG;
}
