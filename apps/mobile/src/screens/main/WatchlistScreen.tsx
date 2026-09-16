import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../api/client";
import { colors } from "../../theme";
import type { WatchlistStackParamList } from "../../navigation/types";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";

type Props = NativeStackScreenProps<WatchlistStackParamList, "Watchlist">;

interface WatchlistItem {
  titleId: string;
  mediaType: string;
  name: string;
  status: string;
  addedAt: string;
}

export function WatchlistScreen({ navigation }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  // Three distinct states. Without the loading one, an empty `items` array on
  // first paint rendered "Your watchlist is empty" to everyone, including
  // people whose watchlist was about to load — and a failed request rendered
  // the same thing, telling users their saved titles were gone when the
  // request had simply failed.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (isPullToRefresh = false) => {
    if (isPullToRefresh) setIsRefreshing(true);
    try {
      const res = await api.get<{ items: WatchlistItem[] }>("/watchlist");
      setItems(res.items);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (status === "loading") {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Your Watchlist</Text>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={52} style={{ marginBottom: 12 }} />
        ))}
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Your Watchlist</Text>
        <ErrorState
          message="Slate couldn't load your watchlist right now. Your saved titles are safe."
          onRetry={() => {
            setStatus("loading");
            load();
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Your Watchlist</Text>
      <FlatList
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
        }
        data={items}
        keyExtractor={(i) => i.titleId}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate("TitleDetail", { titleId: item.titleId })}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.mediaType.toLowerCase()}, ${item.status.replace(/_/g, " ").toLowerCase()}`}
          >
            <View>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.mediaType.toUpperCase()} · {item.status.replace(/_/g, " ")}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            title="Your watchlist is empty"
            message="Find something you're excited about and add it here — Slate will keep track of when it lands."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  header: { color: colors.text, fontSize: 24, fontWeight: "800", marginBottom: 16 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
