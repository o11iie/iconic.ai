import React, { useState } from "react";
import { View, Text, TextInput, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TitleSummary } from "@slate/shared";
import { api } from "../../api/client";
import { colors } from "../../theme";
import type { SearchStackParamList } from "../../navigation/types";
import { TitleCard } from "../../components/TitleCard";

type Props = NativeStackScreenProps<SearchStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TitleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  let debounceHandle: ReturnType<typeof setTimeout>;

  function onChangeQuery(text: string) {
    setQuery(text);
    clearTimeout(debounceHandle);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceHandle = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await api.get<{ results: TitleSummary[] }>(`/search?q=${encodeURIComponent(text.trim())}`);
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 350);
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
        contentContainerStyle={{ gap: 12, paddingTop: 16 }}
        renderItem={({ item }) => (
          <TitleCard title={item} onPress={() => navigation.navigate("TitleDetail", { titleId: item.id })} />
        )}
        ListEmptyComponent={
          !isLoading && query.length >= 2 ? <Text style={styles.empty}>No results for "{query}"</Text> : null
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
