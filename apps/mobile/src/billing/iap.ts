import { Platform } from "react-native";
import * as RNIap from "react-native-iap";
import type { SlateProProductId } from "@slate/shared";

/**
 * Thin wrapper around react-native-iap so the rest of the app never touches
 * the native purchase API directly. react-native-iap requires native code
 * (autolinked via `expo prebuild` / `expo run:android`) and does NOT work
 * inside Expo Go — this must be tested with a development build. See
 * SLATE_RISKS.md for what's still needed on the Play Console side
 * (app signed + uploaded to at least Internal Testing, license testers
 * added, products created in the Play Console matching SlateProProductId).
 */
export interface PurchaseResult {
  productId: string;
  purchaseToken: string;
}

export async function initIap(): Promise<void> {
  if (Platform.OS !== "android") return;
  await RNIap.initConnection();
}

export async function fetchSubscriptions(productIds: SlateProProductId[]) {
  return RNIap.getSubscriptions({ skus: productIds });
}

export async function purchaseSubscription(productId: SlateProProductId): Promise<PurchaseResult> {
  const purchase = await RNIap.requestSubscription({ sku: productId });
  const result = Array.isArray(purchase) ? purchase[0] : purchase;
  if (!result?.purchaseToken) throw new Error("Purchase did not return a token to verify.");
  return { productId, purchaseToken: result.purchaseToken };
}

/** Used for "Restore purchases": re-reads whatever Play already knows this device owns. */
export async function getExistingPurchases(): Promise<PurchaseResult[]> {
  const purchases = await RNIap.getAvailablePurchases();
  return purchases
    .filter((p) => !!p.purchaseToken)
    .map((p) => ({ productId: p.productId, purchaseToken: p.purchaseToken! }));
}
