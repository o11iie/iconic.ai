import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import type { ProductCatalogEntry, SlateProProductId } from "@slate/shared";
import { api } from "../../api/client";
import { colors } from "../../theme";
import { useEntitlement } from "../../state/EntitlementContext";
import { getExistingPurchases, purchaseSubscription } from "../../billing/iap";
import { track } from "../../analytics/analytics";

const BENEFITS = [
  "Unlimited follows & watchlist",
  "Smart release alerts, the moment they're announced",
  "Expanded Ask Slate — more questions per day",
  "Advanced spoiler controls & watch journeys",
  "Ad-free, always",
];

export function ProUpgradeScreen() {
  const { refresh } = useEntitlement();
  const [products, setProducts] = useState<ProductCatalogEntry[]>([]);
  const [purchasingId, setPurchasingId] = useState<SlateProProductId | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    track("paywall_view");
    api.get<{ products: ProductCatalogEntry[] }>("/billing/products").then((res) => setProducts(res.products));
  }, []);

  async function handlePurchase(productId: SlateProProductId) {
    setPurchasingId(productId);
    track("purchase_started", { productId });
    try {
      const { purchaseToken } = await purchaseSubscription(productId);
      await api.post("/billing/verify-purchase", { productId, purchaseToken });
      await refresh();
      track("purchase_completed", { productId });
      Alert.alert("Welcome to Slate Pro", "Your subscription is active.");
    } catch (err) {
      track("purchase_failed", { productId, reason: err instanceof Error ? err.message : "unknown" });
      Alert.alert("Purchase failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setPurchasingId(null);
    }
  }

  async function handleRestore() {
    setIsRestoring(true);
    try {
      const purchases = await getExistingPurchases();
      for (const p of purchases) {
        await api.post("/billing/verify-purchase", p);
      }
      await refresh();
      track("purchase_restored", { count: purchases.length });
      Alert.alert(purchases.length ? "Purchases restored" : "Nothing to restore", "");
    } catch (err) {
      Alert.alert("Restore failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your entertainment. Smarter.</Text>
      <View style={styles.benefits}>
        {BENEFITS.map((b) => (
          <Text key={b} style={styles.benefit}>✓ {b}</Text>
        ))}
      </View>

      {products.length === 0 ? (
        <ActivityIndicator color={colors.pro} style={{ marginTop: 30 }} />
      ) : (
        products.map((p) => (
          <TouchableOpacity
            key={p.productId}
            style={styles.planButton}
            onPress={() => handlePurchase(p.productId)}
            disabled={purchasingId !== null}
          >
            {purchasingId === p.productId ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.planButtonText}>
                {p.billingPeriod === "P1Y" ? "Yearly" : "Monthly"} — ${p.referencePriceUsd.toFixed(2)}
                {p.billingPeriod === "P1Y" ? "/yr" : "/mo"}
              </Text>
            )}
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity onPress={handleRestore} disabled={isRestoring}>
        <Text style={styles.restoreLink}>{isRestoring ? "Restoring…" : "Restore purchases"}</Text>
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        Billed through Google Play. Cancel anytime in your Play Store subscriptions. Prices shown are reference
        values — final price and currency are set by Google Play at checkout.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 60 },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", marginBottom: 20 },
  benefits: { marginBottom: 30 },
  benefit: { color: colors.text, marginBottom: 10, fontSize: 15 },
  planButton: { backgroundColor: colors.pro, borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 12 },
  planButtonText: { color: "#000", fontWeight: "700", fontSize: 16 },
  restoreLink: { color: colors.textMuted, textAlign: "center", marginTop: 8 },
  disclaimer: { color: colors.textMuted, fontSize: 11, marginTop: 24, lineHeight: 16, textAlign: "center" },
});
