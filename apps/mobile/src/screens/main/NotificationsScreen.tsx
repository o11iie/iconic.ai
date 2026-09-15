import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { SlateNotification } from "@slate/shared";
import { api } from "../../api/client";
import { colors, spacing, radii, type as typography } from "../../theme";
import { track } from "../../analytics/analytics";
import { EmptyState } from "../../components/EmptyState";

interface Props {
  navigation: { navigate: (screen: string, params?: object) => void };
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationsScreen({ navigation }: Props) {
  const [notifications, setNotifications] = useState<SlateNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ notifications: SlateNotification[] }>("/notifications");
      setNotifications(res.notifications);
    } catch {
      setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function markAllRead() {
    await api.post("/notifications/read-all").catch(() => undefined);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  async function open(notification: SlateNotification) {
    track("notification_opened", { type: notification.type });
    if (!notification.readAt) {
      api.post(`/notifications/${notification.id}/read`).catch(() => undefined);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    }

    const titleId = notification.data?.titleId;
    const postId = notification.data?.postId;
    if (typeof titleId === "string") navigation.navigate("TitleDetail", { titleId });
    else if (typeof postId === "string") navigation.navigate("PostDetail", { postId });
  }

  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Notifications</Text>
        {hasUnread && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, !item.readAt && styles.rowUnread]} onPress={() => open(item)}>
            <View style={styles.rowContent}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowBody}>{item.body}</Text>
              <Text style={styles.rowTime}>{relativeTime(item.createdAt)}</Text>
            </View>
            {!item.readAt && <View style={styles.unreadDot} />}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              title="Nothing yet"
              message="Follow a few titles and Slate will let you know when they're close."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  header: { ...typography.h2, color: colors.text },
  markAll: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  rowUnread: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  rowContent: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowBody: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  rowTime: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginLeft: spacing.sm },
});
