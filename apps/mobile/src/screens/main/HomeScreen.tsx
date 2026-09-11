import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TitleSummary } from "@slate/shared";
import { api } from "../../api/client";
import { colors } from "../../theme";
import { TitleCard } from "../../components/TitleCard";
import type { HomeStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "Home">;

function Section({ title, data, onPressTitle }: { title: string; data: TitleSummary[]; onPressTitle: (id: string) => void }) {
  if (data.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {data.map((t) => (
          <TitleCard key={t.id} title={t} onPress={() => onPressTitle(t.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

export function HomeScreen({ navigation }: Props) {
  const [trending, setTrending] = useState<TitleSummary[]>([]);
  const [upcoming, setUpcoming] = useState<TitleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [trendingRes, upcomingRes] = await Promise.all([
        api.get<{ results: TitleSummary[] }>("/discover/trending"),
        api.get<{ results: TitleSummary[] }>("/discover/upcoming"),
      ]);
      setTrending(trendingRes.results);
      setUpcoming(upcomingRes.results);
    } catch {
      setError("Couldn't load Slate right now. Pull to refresh to try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const goToDetail = (titleId: string) => navigation.navigate("TitleDetail", { titleId });

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.header}>Slate</Text>
      <Text style={styles.tagline}>The home of entertainment hype.</Text>

      {isLoading && trending.length === 0 && upcoming.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          <Section title="Trending now" data={trending} onPressTitle={goToDetail} />
          <Section title="Coming up" data={upcoming} onPressTitle={goToDetail} />
          {trending.length === 0 && upcoming.length === 0 && (
            <Text style={styles.empty}>
              No data configured yet. Add TMDB_API_KEY / TWITCH_CLIENT_ID+SECRET to the backend .env to populate Slate.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  header: { color: colors.text, fontSize: 32, fontWeight: "800", marginTop: 12 },
  tagline: { color: colors.textMuted, fontSize: 14, marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 10 },
  error: { color: colors.accent, marginTop: 20 },
  empty: { color: colors.textMuted, marginTop: 20, lineHeight: 20 },
});
