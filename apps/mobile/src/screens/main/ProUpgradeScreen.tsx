import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import type { PaywallTrigger, ProductCatalogEntry, SlateProProductId } from "@slate/shared";
import { api, ApiError } from "../../api/client";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "../../theme";
import { useEntitlement } from "../../state/EntitlementContext";
import {
  AlreadyOwnedError,
  PurchaseCancelledError,
  type SubscriptionOption,
  completePurchase,
  endIap,
  fetchSubscriptionOptions,
  getExistingPurchases,
  initIap,
  purchaseSubscription,
} from "../../billing/iap";
import { useAuth } from "../../state/AuthContext";
import { track } from "../../analytics/analytics";

type RouteParams = Record<string, object | undefined> & {
  ProUpgrade: { trigger?: PaywallTrigger } | undefined;
};

interface Props {
  route?: RouteProp<RouteParams, "ProUpgrade">;
}

interface ProductsResponse {
  products: ProductCatalogEntry[];
  annual: { percent: number; amountUsd: number; monthlyEquivalentUsd: number };
}

/**
 * Lead with the benefit the user was actually reaching for. Someone who hit
 * the follow limit cares about follows, not a generic pitch — the rest of
 * the value is still listed below, but the headline meets them where they are.
 */
const TRIGGER_HEADLINE: Record<PaywallTrigger, { title: string; body: string }> = {
  FOLLOW_LIMIT: {
    title: "Follow everything you care about",
    body: "You've hit the Free follow limit. Pro removes it across movies, TV and games.",
  },
  WATCHLIST_LIMIT: {
    title: "A watchlist without a ceiling",
    body: "Your Free watchlist is full. Pro keeps everything you mean to get to in one place.",
  },
  AI_LIMIT: {
    title: "Go deeper with Slate Intelligence",
    body: "You've used today's Free questions. Pro raises the daily limit substantially.",
  },
  ADVANCED_RELEASE_RADAR: {
    title: "See the whole year ahead",
    body: "Free Radar looks two weeks out. Pro shows your full release horizon.",
  },
  ADVANCED_JOURNEY: {
    title: "Track every journey at once",
    body: "Pro lets you run unlimited watch and play journeys side by side.",
  },
  PERSONALIZATION: {
    title: "Slate, tuned to you",
    body: "Pro unlocks personalized recommendations across all three categories.",
  },
  SPOILER_CONTROLS: {
    title: "Spoiler control, per title",
    body: "Pro adds per-title spoiler rules instead of one global setting.",
  },
  DIRECT: {
    title: "Your entertainment. Smarter.",
    body: "Own your entertainment universe across movies, TV and games.",
  },
};

const PILLARS = [
  "Unlimited follows",
  "Advanced Release Radar",
  "Expanded Slate Intelligence",
  "Advanced Watch Journeys",
  "Personalized entertainment",
  "Hype Intelligence",
  "Advanced spoiler controls",
  "Ad-free",
];

export function ProUpgradeScreen({ route }: Props) {
  const trigger: PaywallTrigger = route?.params?.trigger ?? "DIRECT";
  const { refresh } = useEntitlement();
  const { user } = useAuth();
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [purchasingId, setPurchasingId] = useState<SlateProProductId | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  /**
   * Play's own offer tokens and localized prices. Purchases cannot be made
   * without an offer token, and the price Google shows at checkout is the
   * price that should be on this screen — the backend catalog is only a
   * reference value for copy and analytics.
   */
  const [offers, setOffers] = useState<SubscriptionOption[]>([]);

  useEffect(() => {
    track("paywall_view", { trigger });
    api.get<ProductsResponse>("/billing/products").then(setData).catch(() => setData(null));
  }, [trigger]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initIap();
        const ids: SlateProProductId[] = ["SLATE_PRO_YEARLY", "SLATE_PRO_MONTHLY"];
        const found = await fetchSubscriptionOptions(ids);
        if (!cancelled) setOffers(found);
      } catch {
        // Play unavailable (no Play Services, offline, products not yet
        // published). The screen still renders with reference pricing and
        // the buttons explain themselves rather than failing on tap.
        if (!cancelled) setOffers([]);
      }
    })();
    return () => {
      cancelled = true;
      endIap();
    };
  }, []);

  function offerFor(productId: SlateProProductId) {
    return offers.find((o) => o.productId === productId) ?? null;
  }

  async function handlePurchase(productId: SlateProProductId) {
    const offer = offerFor(productId);
    if (!offer) {
      Alert.alert(
        "Subscriptions unavailable",
        "Slate couldn't reach Google Play. Check your connection and try again.",
      );
      return;
    }

    setPurchasingId(productId);
    track("purchase_started", { productId, trigger });
    try {
      // The account id is passed to Play so a purchase can be traced back to
      // the Slate account that made it. Entitlement still comes from the
      // server's own verification, never from this callback.
      const result = await purchaseSubscription(offer, user?.id);
      await api.post("/billing/verify-purchase", {
        productId,
        purchaseToken: result.purchaseToken,
      });

      // Only now: acknowledging tells Google the goods were delivered, and
      // that claim should follow verification, not precede it. Play
      // auto-refunds anything unacknowledged after three days.
      await completePurchase(result).catch(() => undefined);
      await refresh();

      if (result.isSuspended) {
        // Billing 8.1+: the subscription exists but payment failed. Play is
        // explicit that entitlements must not be granted in this state.
        track("purchase_failed", { productId, reason: "suspended" });
        Alert.alert(
          "Payment needs attention",
          "Google Play couldn't take payment for this subscription. Fix your payment method in the Play Store and Slate Pro will unlock automatically.",
        );
      } else if (result.isPending) {
        // Google has the purchase but has not completed it. Saying "you're
        // Pro" here would be a lie the server correctly refuses to back.
        track("purchase_pending", { productId, trigger });
        Alert.alert(
          "Purchase pending",
          "Google Play is still processing your payment. Slate Pro unlocks as soon as it completes — you don't need to do anything.",
        );
      } else {
        track("purchase_completed", { productId, trigger });
        Alert.alert("Welcome to Slate Pro", "Your subscription is active.");
      }
    } catch (err) {
      if (err instanceof PurchaseCancelledError) {
        // Backing out of the Play sheet is a normal choice, not a failure.
        track("purchase_cancelled", { productId, trigger });
        return;
      }
      if (err instanceof AlreadyOwnedError) {
        track("purchase_failed", { productId, reason: "already_owned" });
        Alert.alert("Already subscribed", `${err.message} Use "Restore purchases" to link it to this account.`);
        return;
      }
      track("purchase_failed", { productId, reason: err instanceof Error ? err.message : "unknown" });
      Alert.alert("Purchase failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setPurchasingId(null);
    }
  }

  async function handleRestore() {
    setIsRestoring(true);
    try {
      await initIap();
      const purchases = await getExistingPurchases();
      let linked = 0;
      let claimedByAnother = false;

      for (const p of purchases) {
        // A suspended subscription is not an entitlement to restore; Play
        // needs the payment method fixed first.
        if (p.isSuspended) continue;
        try {
          await api.post("/billing/verify-purchase", {
            productId: p.productId,
            purchaseToken: p.purchaseToken,
          });
          await completePurchase(p).catch(() => undefined);
          linked++;
        } catch (err) {
          // A purchase belonging to a different Slate account is a real
          // situation (shared device, second account) and must not read as
          // a generic failure.
          if (err instanceof ApiError && err.code === "PURCHASE_ALREADY_LINKED") {
            claimedByAnother = true;
            continue;
          }
          throw err;
        }
      }

      await refresh();
      track("purchase_restored", { count: linked });

      if (claimedByAnother && linked === 0) {
        Alert.alert(
          "Already linked elsewhere",
          "This Google Play subscription belongs to a different Slate account. Sign in with that account to use Pro.",
        );
      } else {
        Alert.alert(
          linked > 0 ? "Purchases restored" : "Nothing to restore",
          linked > 0 ? "Slate Pro is active on this account." : "Google Play has no active Slate subscription for this account.",
        );
      }
    } catch (err) {
      Alert.alert("Restore failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setIsRestoring(false);
    }
  }

  const headline = TRIGGER_HEADLINE[trigger];
  const monthly = data?.products.find((p) => p.billingPeriod === "P1M");
  const yearly = data?.products.find((p) => p.billingPeriod === "P1Y");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>SLATE PRO</Text>
      <Text style={styles.title}>{headline.title}</Text>
      <Text style={styles.subtitle}>{headline.body}</Text>

      <View style={styles.pillars}>
        {PILLARS.map((p) => (
          <View key={p} style={styles.pillarRow}>
            <Text style={styles.check}>✓</Text>
            <Text style={styles.pillarText}>{p}</Text>
          </View>
        ))}
      </View>

      {!data ? (
        <ActivityIndicator color={colors.pro} style={{ marginTop: spacing.lg }} />
      ) : (
        <>
          {yearly && (
            <TouchableOpacity
              style={[styles.planButton, styles.planPrimary]}
              onPress={() => handlePurchase(yearly.productId)}
              disabled={purchasingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Subscribe yearly, ${yearly.referencePriceUsd} dollars per year`}
            >
              {purchasingId === yearly.productId ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Text style={styles.planPrimaryText}>Yearly · ${yearly.referencePriceUsd.toFixed(2)}</Text>
                  {data.annual && (
                    <Text style={styles.planSubtext}>
                      ${data.annual.monthlyEquivalentUsd.toFixed(2)}/mo · save {data.annual.percent}% vs monthly
                    </Text>
                  )}
                </>
              )}
            </TouchableOpacity>
          )}

          {monthly && (
            <TouchableOpacity
              style={[styles.planButton, styles.planSecondary]}
              onPress={() => handlePurchase(monthly.productId)}
              disabled={purchasingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Subscribe monthly, ${monthly.referencePriceUsd} dollars per month`}
            >
              {purchasingId === monthly.productId ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.planSecondaryText}>Monthly · ${monthly.referencePriceUsd.toFixed(2)}/mo</Text>
              )}
            </TouchableOpacity>
          )}
        </>
      )}

      <TouchableOpacity onPress={handleRestore} disabled={isRestoring} accessibilityRole="button">
        <Text style={styles.restoreLink}>{isRestoring ? "Restoring…" : "Restore purchases"}</Text>
      </TouchableOpacity>

      <Text style={styles.freeNote}>
        Free keeps full discovery, search, details, countdowns, community and a real watchlist. Pro adds scale and
        intelligence on top.
      </Text>

      <Text style={styles.disclaimer}>
        Billed through Google Play. Cancel anytime in your Play Store subscriptions. Prices shown are reference values —
        your final price and currency are set by Google Play at checkout.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  eyebrow: { color: colors.pro, ...type.caption, fontWeight: "800", letterSpacing: 1.5 },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.lg },
  pillars: { marginBottom: spacing.xl },
  pillarRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  check: { color: colors.pro, fontSize: 15, fontWeight: "800", marginRight: spacing.md },
  pillarText: { ...type.bodyLarge, color: colors.text },
  planButton: {
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: MIN_TOUCH_TARGET + 8,
    marginBottom: spacing.md,
  },
  planPrimary: { backgroundColor: colors.pro },
  planPrimaryText: { color: "#000", fontWeight: "800", fontSize: 16 },
  planSubtext: { color: "#000", opacity: 0.75, fontSize: 12, marginTop: 2, fontWeight: "600" },
  planSecondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  planSecondaryText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  restoreLink: { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, paddingVertical: spacing.sm },
  freeNote: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.lg,
    lineHeight: 17,
  },
  disclaimer: { ...type.micro, color: colors.textMuted, marginTop: spacing.md, lineHeight: 15, textAlign: "center" },
});
