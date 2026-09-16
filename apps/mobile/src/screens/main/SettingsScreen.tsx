import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Switch,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import type { NotificationType } from "@slate/shared";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../state/AuthContext";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "../../theme";
import { legalLinks, supportEmail } from "../../config/links";

interface BlockedUser {
  userId: string;
  handle: string;
  displayName: string;
  blockedAt: string;
}

const NOTIFICATION_TYPES: { value: NotificationType; label: string }[] = [
  { value: "RELEASE_REMINDER", label: "Release reminders" },
  { value: "FOLLOWED_TITLE_UPDATE", label: "Updates to titles I follow" },
  { value: "COMMUNITY_REPLY", label: "Replies to my posts" },
  { value: "COMMUNITY_MENTION", label: "Mentions" },
  { value: "SUBSCRIPTION_STATUS", label: "Subscription status" },
];

/**
 * Account, notification and legal settings.
 *
 * Google Play requires an in-app path to account deletion for any app that
 * offers account creation, and requires the privacy policy to be reachable.
 * Both live here.
 */
export function SettingsScreen() {
  const { user, logout, updatePreferences } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);

  const loadBlocked = useCallback(async () => {
    try {
      const res = await api.get<{ blocked: BlockedUser[] }>("/community/blocks");
      setBlocked(res.blocked);
    } catch {
      // A failed load leaves the list empty; the section explains that
      // blocking exists rather than silently disappearing.
      setBlocked([]);
    }
  }, []);

  useEffect(() => {
    loadBlocked();
  }, [loadBlocked]);

  async function unblock(user: BlockedUser) {
    try {
      await api.delete(`/community/blocks/${user.userId}`);
      setBlocked((current) => current.filter((b) => b.userId !== user.userId));
    } catch {
      Alert.alert("Couldn't unblock", "Please try again.");
    }
  }

  const muted = new Set(user?.preferences.mutedNotificationTypes ?? []);
  const notificationsOn = user?.preferences.notificationsEnabled ?? true;

  async function toggleAllNotifications(value: boolean) {
    await updatePreferences({ notificationsEnabled: value }).catch(() => undefined);
  }

  async function toggleType(t: NotificationType, enabled: boolean) {
    const next = enabled
      ? (user?.preferences.mutedNotificationTypes ?? []).filter((m) => m !== t)
      : [...(user?.preferences.mutedNotificationTypes ?? []), t];
    await updatePreferences({ mutedNotificationTypes: next }).catch(() => undefined);
  }

  function openLink(url: string | null, label: string) {
    if (!url) {
      Alert.alert(`${label} unavailable`, "This link isn't configured for this build yet.");
      return;
    }
    Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", url));
  }

  async function confirmDelete() {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const result = await api.post<{ deleted: boolean; hadActiveSubscription: boolean }>(
        "/users/me/delete",
        { password, confirm: "DELETE" },
      );
      // The account no longer exists, so clear local session state.
      await logout();
      Alert.alert(
        "Account deleted",
        result.hadActiveSubscription
          ? "Your account and personal data have been deleted.\n\nYour Slate Pro subscription is billed by Google Play and is NOT cancelled by deleting your account. Cancel it in the Play Store under Payments & subscriptions to stop being charged."
          : "Your account and personal data have been deleted.",
      );
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.code === "REAUTH_FAILED"
          ? "That password isn't correct."
          : "Slate couldn't delete your account right now. Please try again.",
      );
    } finally {
      setIsDeleting(false);
      setPassword("");
    }
  }

  function startDelete() {
    Alert.alert(
      "Delete your Slate account?",
      "This permanently deletes your account, follows, watchlist, journeys and Ask Slate history. Posts and comments you wrote are removed and anonymized. This cannot be undone.\n\nA Slate Pro subscription is billed by Google Play and must be cancelled separately in the Play Store.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", style: "destructive", onPress: () => setShowDeleteFlow(true) },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Settings</Text>

      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.rowLabel}>{user?.displayName}</Text>
        <Text style={styles.rowMeta}>@{user?.handle} · {user?.email}</Text>
      </View>

      <Text style={styles.sectionTitle}>Notifications</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>All notifications</Text>
          <Switch value={notificationsOn} onValueChange={toggleAllNotifications} trackColor={{ true: colors.accent }} />
        </View>
        {NOTIFICATION_TYPES.map((t) => (
          <View key={t.value} style={styles.switchRow}>
            <Text style={[styles.rowMeta, !notificationsOn && styles.disabled]}>{t.label}</Text>
            <Switch
              value={notificationsOn && !muted.has(t.value)}
              disabled={!notificationsOn}
              onValueChange={(v) => toggleType(t.value, v)}
              trackColor={{ true: colors.accent }}
            />
          </View>
        ))}
        <Text style={styles.note}>
          Slate delivers these inside the app. Push notifications while Slate is closed are not enabled in this build.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Legal & support</Text>
      <View style={styles.card}>
        {!legalLinks.isConfigured && (
          <Text style={styles.note}>These open Slate's public site, which isn't configured in this build.</Text>
        )}
        {[
          { label: "Privacy Policy", url: legalLinks.privacyPolicy },
          { label: "Terms of Service", url: legalLinks.terms },
          { label: "Community Guidelines", url: legalLinks.communityGuidelines },
          { label: "Copyright / DMCA", url: legalLinks.copyright },
          { label: "Support", url: legalLinks.support },
        ].map((l) => (
          <TouchableOpacity key={l.label} style={styles.linkRow} onPress={() => openLink(l.url, l.label)} accessibilityRole="link">
            <Text style={styles.linkText}>{l.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
        {supportEmail && (
          <TouchableOpacity style={styles.linkRow} onPress={() => openLink(`mailto:${supportEmail}`, "Email support")}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Email support</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionTitle}>Data sources</Text>
      <View style={styles.card}>
        {/*
          TMDB's and IGDB's terms require attribution wherever their data is
          shown. Slate carried this on its website and store listing but not
          in the app, which is where the data actually appears.
        */}
        <Text style={styles.note}>
          Film and television information is supplied by TMDB. Slate uses the TMDB API but is not
          endorsed or certified by TMDB.
        </Text>
        <Text style={styles.note}>
          Game information is supplied by IGDB. Slate is not endorsed or certified by IGDB or Twitch.
        </Text>
        <Text style={styles.note}>
          Release dates are shown at the precision the provider supplies. Where only a month, quarter
          or year is known, Slate says so rather than guessing a day.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Blocked accounts</Text>
      <View style={styles.card}>
        {blocked.length === 0 ? (
          <Text style={styles.note}>
            You haven't blocked anyone. Use Block on any post to stop seeing that account's posts
            and comments — they aren't told, and you can undo it here.
          </Text>
        ) : (
          blocked.map((b) => (
            <View key={b.userId} style={styles.switchRow}>
              <View style={styles.blockedInfo}>
                <Text style={styles.rowLabel}>@{b.handle}</Text>
                <Text style={styles.rowMeta}>{b.displayName}</Text>
              </View>
              <TouchableOpacity onPress={() => unblock(b)} accessibilityRole="button">
                <Text style={styles.unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionTitle}>Subscription</Text>
      <View style={styles.card}>
        <Text style={styles.note}>
          Slate Pro is billed through Google Play. Manage or cancel your subscription in the Play Store under
          Payments &amp; subscriptions.
        </Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => openLink("https://play.google.com/store/account/subscriptions", "Play subscriptions")}
          accessibilityRole="link"
        >
          <Text style={styles.linkText}>Manage subscription in Google Play</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Danger zone</Text>
      <View style={styles.card}>
        {!showDeleteFlow ? (
          <TouchableOpacity style={styles.deleteButton} onPress={startDelete} accessibilityRole="button">
            <Text style={styles.deleteButtonText}>Delete account</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.note}>Confirm your password to permanently delete your account.</Text>
            <TextInput
              style={styles.input}
              placeholder="Current password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              accessibilityLabel="Current password"
            />
            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
            <TouchableOpacity
              style={[styles.deleteButton, !password && styles.deleteDisabled]}
              onPress={confirmDelete}
              disabled={isDeleting || !password}
              accessibilityRole="button"
            >
              {isDeleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.deleteButtonText}>Permanently delete my account</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowDeleteFlow(false); setPassword(""); setDeleteError(null); }}
            accessibilityRole="button"
          >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout} accessibilityRole="button">
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { ...type.h1, color: colors.text, marginBottom: spacing.lg },
  sectionTitle: { ...type.caption, color: colors.textMuted, fontWeight: "800", letterSpacing: 1, marginBottom: spacing.sm, marginTop: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md },
  rowLabel: { ...type.bodyLarge, color: colors.text, fontWeight: "600" },
  rowMeta: { ...type.body, color: colors.textMuted },
  disabled: { opacity: 0.4 },
  blockedInfo: { flex: 1, paddingRight: spacing.md },
  unblockText: { color: colors.accent, fontWeight: "600" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm },
  note: { ...type.caption, color: colors.textMuted, lineHeight: 17, marginTop: spacing.sm },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: MIN_TOUCH_TARGET,
  },
  linkText: { ...type.body, color: colors.text },
  chevron: { color: colors.textMuted, fontSize: 20 },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.text,
    marginTop: spacing.md,
  },
  deleteButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  deleteDisabled: { opacity: 0.5 },
  deleteButtonText: { color: "#fff", fontWeight: "700" },
  cancelText: { color: colors.textMuted, textAlign: "center", paddingVertical: spacing.md },
  error: { color: colors.accent, ...type.caption, marginTop: spacing.sm },
  logoutButton: { minHeight: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
  logoutText: { color: colors.accent, fontWeight: "600" },
});
