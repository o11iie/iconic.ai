import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../../state/AuthContext";
import { useEntitlement } from "../../state/EntitlementContext";
import { colors } from "../../theme";
import type { ProfileStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "Profile">;

export function ProfileScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const { entitlement } = useEntitlement();

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{user?.displayName}</Text>
      <Text style={styles.handle}>@{user?.handle}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{entitlement.isActive ? "Slate Pro" : "Free plan"}</Text>
        <Text style={styles.cardBody}>
          {entitlement.isActive
            ? `Active until ${entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString() : "—"}`
            : "Unlock unlimited follows, watchlist, smart alerts, and more Ask Slate."}
        </Text>
        {!entitlement.isActive && (
          <TouchableOpacity style={styles.upgradeButton} onPress={() => navigation.navigate("ProUpgrade")}>
            <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  name: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 12 },
  handle: { color: colors.textMuted, fontSize: 14, marginBottom: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 18, marginBottom: 24 },
  cardTitle: { color: colors.pro, fontSize: 16, fontWeight: "700" },
  cardBody: { color: colors.textMuted, marginTop: 6, lineHeight: 19 },
  upgradeButton: { backgroundColor: colors.pro, borderRadius: 10, padding: 12, alignItems: "center", marginTop: 14 },
  upgradeButtonText: { color: "#000", fontWeight: "700" },
  logoutButton: { padding: 14, alignItems: "center" },
  logoutText: { color: colors.accent, fontWeight: "600" },
});
