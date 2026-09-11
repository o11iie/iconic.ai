import { GoogleAuth } from "google-auth-library";
import { getEnv, isPlayBillingConfigured } from "../../env";

export class PlayBillingNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_SERVICE_ACCOUNT_JSON is not configured. Set it in apps/backend/.env to verify real purchases.");
  }
}

/**
 * Subset of the Play Developer API's subscription purchase resource that
 * Slate's entitlement logic needs. Full reference:
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
 */
export interface PlaySubscriptionPurchase {
  subscriptionState:
    | "SUBSCRIPTION_STATE_ACTIVE"
    | "SUBSCRIPTION_STATE_CANCELED"
    | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
    | "SUBSCRIPTION_STATE_ON_HOLD"
    | "SUBSCRIPTION_STATE_EXPIRED"
    | "SUBSCRIPTION_STATE_PENDING"
    | string;
  lineItems: Array<{
    productId: string;
    expiryTime: string;
    autoRenewingPlan?: { autoRenewEnabled: boolean };
  }>;
  acknowledgementState?: "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" | string;
}

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!isPlayBillingConfigured()) throw new PlayBillingNotConfiguredError();
  if (!cachedAuth) {
    const credentials = JSON.parse(getEnv().GOOGLE_SERVICE_ACCOUNT_JSON);
    cachedAuth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
  }
  return cachedAuth;
}

/**
 * Verifies a subscription purchase token against the Play Developer API
 * (subscriptionsv2.get). This is the ONLY source of truth for whether a
 * purchase is real and active — the mobile client's local purchase state
 * must never be trusted directly.
 */
export async function verifySubscriptionPurchase(purchaseToken: string): Promise<PlaySubscriptionPurchase> {
  const env = getEnv();
  const auth = getAuth();
  const client = await auth.getClient();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${env.GOOGLE_PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${purchaseToken}`;

  const res = await client.request<PlaySubscriptionPurchase>({ url });
  return res.data;
}

/** Acknowledges a purchase, required by Play within 3 days or it auto-refunds. */
export async function acknowledgeSubscriptionPurchase(productId: string, purchaseToken: string): Promise<void> {
  const env = getEnv();
  const auth = getAuth();
  const client = await auth.getClient();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${env.GOOGLE_PLAY_PACKAGE_NAME}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`;
  await client.request({ url, method: "POST", data: {} });
}
