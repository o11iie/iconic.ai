import React, { useRef, useState } from "react";
import { View, Text, TextInput, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TitleSummary } from "@slate/shared";
import { api } from "../../api/client";
import { colors } from "../../theme";
import type { SearchStackParamList } from "../../navigation/types";
import { TitleCard } from "../../components/TitleCard";
import { EmptyState } from "../../components/EmptyState";

type Props = NativeStackScreenProps<SearchStackParamList, "Search">;

interface SearchResponse {
  results: TitleSummary[];
  page: number;
  hasMore: boolean;
}

export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TitleSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // React 19 requires an explicit initial value for useRef; the undefined
  // case is real here (no timer scheduled yet) and clearTimeout accepts it.
  const debounceHandle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeQuery = useRef("");

  function onChangeQuery(text: string) {
    setQuery(text);
    clearTimeout(debounceHandle.current);
    if (text.trim().length < 2) {
      setResults([]);
      setHasMore(false);
      return;
    }
    debounceHandle.current = setTimeout(async () => {
      const trimmed = text.trim();
      activeQuery.current = trimmed;
      setIsLoading(true);
      try {
        const res = await api.get<SearchResponse>(`/search?q=${encodeURIComponent(trimmed)}`);
        if (activeQuery.current !== trimmed) return; // a newer query already started
        setResults(res.results);
        setPage(res.page);
        setHasMore(res.hasMore);
      } catch {
        setResults([]);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    }, 350);
  }

  async function loadMore() {
    if (isLoadingMore || !hasMore || activeQuery.current.length < 2) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get<SearchResponse>(`/search?q=${encodeURIComponent(activeQuery.current)}&page=${page + 1}`);
      setResults((prev) => [...prev, ...res.results]);
      setPage(res.page);
      setHasMore(res.hasMore);
    } catch {
      // leave hasMore as-is; user can pull to try scrolling again
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Search movies, TV, games"
        placeholderTextColor={colors.textMuted}
        value={query}
        onChangeText={onChangeQuery}
        autoFocus
      />
      {isLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ gap: 12, paddingTop: 16, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TitleCard title={item} onPress={() => navigation.navigate("TitleDetail", { titleId: item.id })} />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={loadMore}
        ListFooterComponent={isLoadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}
        ListEmptyComponent={
          !isLoading && query.length >= 2 ? (
            <EmptyState title={`No results for "${query}"`} message="Try a different spelling, or search for a franchise or actor instead." />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    color: colors.text,
  },
  empty: { color: colors.textMuted, marginTop: 24, textAlign: "center" },
});
