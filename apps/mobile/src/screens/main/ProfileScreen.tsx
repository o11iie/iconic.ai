import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../../state/AuthContext";
import { useEntitlement } from "../../state/EntitlementContext";
import { api } from "../../api/client";
import { colors } from "../../theme";
import type { ProfileStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "Profile">;

function GenrePicker() {
  const { user, updatePreferences } = useAuth();
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const selected = new Set(user?.preferences.favoriteGenres ?? []);

  useEffect(() => {
    api.get<{ genres: string[] }>("/genres").then((res) => setAllGenres(res.genres)).catch(() => setAllGenres([]));
  }, []);

  async function toggleGenre(genre: string) {
    const next = selected.has(genre)
      ? (user?.preferences.favoriteGenres ?? []).filter((g) => g !== genre)
      : [...(user?.preferences.favoriteGenres ?? []), genre];
    setIsSaving(true);
    try {
      await updatePreferences({ favoriteGenres: next });
    } catch {
      // leave selection as-is; user can retry the tap
    } finally {
      setIsSaving(false);
    }
  }

  if (allGenres.length === 0) return null;

  return (
    <View style={styles.genreSection}>
      <View style={styles.genreHeaderRow}>
        <Text style={styles.sectionLabel}>Favorite genres</Text>
        {isSaving && <ActivityIndicator size="small" color={colors.accent} />}
      </View>
      <Text style={styles.sectionHint}>Powers your For You feed — pick a few to get started.</Text>
      <View style={styles.chipRow}>
        {allGenres.map((genre) => {
          const isSelected = selected.has(genre);
          return (
            <TouchableOpacity
              key={genre}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => toggleGenre(genre)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{genre}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

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

      <GenrePicker />

      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate("Settings")}
        accessibilityRole="button"
      >
        <Text style={styles.settingsText}>Settings, privacy & account</Text>
      </TouchableOpacity>

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
  genreSection: { marginBottom: 24 },
  genreHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sectionHint: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  chipTextSelected: { color: "#000" },
  settingsButton: { padding: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  settingsText: { color: colors.text, fontWeight: "600" },
  logoutButton: { padding: 14, alignItems: "center" },
  logoutText: { color: colors.accent, fontWeight: "600" },
});
