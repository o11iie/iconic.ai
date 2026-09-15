import { Platform } from "react-native";
import * as RNIap from "react-native-iap";
import type { SlateProProductId } from "@slate/shared";

/**
 * Thin wrapper around react-native-iap so the rest of the app never touches
 * the native purchase API directly.
 *
 * react-native-iap requires native code (autolinked via `expo prebuild` /
 * `expo run:android`) and does NOT work in Expo Go — this must be exercised
 * with a development build against a Play licence-tester account. See
 * SLATE_PRODUCTION_CONFIGURATION.md for the Play Console side.
 *
 * Nothing here decides whether a user is Pro. A purchase produces a token;
 * the token goes to Slate's backend, which asks Google. A successful
 * callback on this side means "ask the server", never "grant access".
 */

export interface PurchaseResult {
  productId: string;
  purchaseToken: string;
  /**
   * True when Google has taken the purchase but not completed it — a slow
   * payment method, a pending-transaction card. The user is not entitled
   * yet, and the backend will record PENDING rather than granting Pro.
   */
  isPending: boolean;
}

/** The user backed out of the Play sheet. Not an error worth alerting about. */
export class PurchaseCancelledError extends Error {
  constructor() {
    super("Purchase cancelled.");
  }
}

/** Play already has an active subscription for this account. Restore, don't re-buy. */
export class AlreadyOwnedError extends Error {
  constructor() {
    super("This Google account already has an active Slate Pro subscription.");
  }
}

export interface SubscriptionOption {
  productId: SlateProProductId;
  /** Play's localized price string — what the user will actually be charged. */
  formattedPrice: string | null;
  offerToken: string;
}

let connected = false;

export async function initIap(): Promise<void> {
  if (Platform.OS !== "android" || connected) return;
  await RNIap.initConnection();
  connected = true;
}

/** Closes the billing connection. Called when the paywall unmounts. */
export async function endIap(): Promise<void> {
  if (Platform.OS !== "android" || !connected) return;
  connected = false;
  await RNIap.endConnection().catch(() => undefined);
}

/**
 * Product discovery. Returns Play's own localized price alongside the offer
 * token needed to purchase.
 *
 * The offer token is not optional on Android: since Play Billing 5 a
 * subscription SKU is a container of base plans and offers, and a purchase
 * must name exactly one. Requesting a subscription without it fails.
 */
export async function fetchSubscriptionOptions(
  productIds: SlateProProductId[],
): Promise<SubscriptionOption[]> {
  const subscriptions = await RNIap.getSubscriptions({ skus: productIds });
  const options: SubscriptionOption[] = [];

  for (const sub of subscriptions) {
    const offers = (sub as RNIap.SubscriptionAndroid).subscriptionOfferDetails ?? [];
    // Offers are ordered with the most specific first; the base plan is what
    // Slate sells. Taking the first is what Play's own samples do.
    const offer = offers[0];
    if (!offer?.offerToken) continue;

    const phases = offer.pricingPhases?.pricingPhaseList ?? [];
    // Last phase is the recurring price — an introductory phase, if one is
    // ever configured in Play, comes first and is not the ongoing cost.
    const recurring = phases[phases.length - 1];

    options.push({
      productId: sub.productId as SlateProProductId,
      formattedPrice: recurring?.formattedPrice ?? null,
      offerToken: offer.offerToken,
    });
  }

  return options;
}

/**
 * Starts the Play purchase flow and returns the token to verify server-side.
 *
 * `obfuscatedAccountIdAndroid` ties the purchase to the Slate account that
 * initiated it. Google surfaces it in the Developer API, which gives support
 * and fraud review a way to tell whose purchase a token is — and it is the
 * identifier Play recommends for exactly this.
 */
export async function purchaseSubscription(
  option: SubscriptionOption,
  obfuscatedAccountId?: string,
): Promise<PurchaseResult> {
  try {
    const purchase = await RNIap.requestSubscription({
      sku: option.productId,
      subscriptionOffers: [{ sku: option.productId, offerToken: option.offerToken }],
      ...(obfuscatedAccountId ? { obfuscatedAccountIdAndroid: obfuscatedAccountId } : {}),
    });

    const result = Array.isArray(purchase) ? purchase[0] : purchase;
    if (!result?.purchaseToken) {
      throw new Error("Purchase did not return a token to verify.");
    }

    return {
      productId: option.productId,
      purchaseToken: result.purchaseToken,
      isPending:
        (result as RNIap.ProductPurchase).purchaseStateAndroid === RNIap.PurchaseStateAndroid.PENDING,
    };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === RNIap.ErrorCode.E_USER_CANCELLED) throw new PurchaseCancelledError();
    if (code === RNIap.ErrorCode.E_ALREADY_OWNED) throw new AlreadyOwnedError();
    throw err;
  }
}

/** Used for "Restore purchases": re-reads whatever Play already knows this device owns. */
export async function getExistingPurchases(): Promise<PurchaseResult[]> {
  const purchases = await RNIap.getAvailablePurchases();
  return purchases
    .filter((p) => !!p.purchaseToken)
    .map((p) => ({
      productId: p.productId,
      purchaseToken: p.purchaseToken!,
      isPending: p.purchaseStateAndroid === RNIap.PurchaseStateAndroid.PENDING,
    }));
}
