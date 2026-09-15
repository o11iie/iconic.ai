import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../api/client";
import { colors } from "../../theme";
import type { WatchlistStackParamList } from "../../navigation/types";
import { EmptyState } from "../../components/EmptyState";

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

  useFocusEffect(
    useCallback(() => {
      api.get<{ items: WatchlistItem[] }>("/watchlist").then((res) => setItems(res.items)).catch(() => setItems([]));
    }, []),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Your Watchlist</Text>
      <FlatList
        data={items}
        keyExtractor={(i) => i.titleId}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("TitleDetail", { titleId: item.titleId })}>
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
  empty: { color: colors.textMuted, marginTop: 40, textAlign: "center" },
});
