import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TitleSummary } from "@slate/shared";
import { api } from "../../api/client";
import { colors } from "../../theme";
import { TitleCard } from "../../components/TitleCard";
import type { HomeStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "Home">;

interface DiscoverResponse {
  results: TitleSummary[];
  page: number;
  hasMore: boolean;
}

interface SectionState {
  items: TitleSummary[];
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}

const EMPTY_SECTION: SectionState = { items: [], page: 1, hasMore: false, isLoadingMore: false };

function Section({
  title,
  state,
  onPressTitle,
  onLoadMore,
}: {
  title: string;
  state: SectionState;
  onPressTitle: (id: string) => void;
  onLoadMore: () => void;
}) {
  if (state.items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {state.items.map((t) => (
          <TitleCard key={t.id} title={t} onPress={() => onPressTitle(t.id)} />
        ))}
        {state.hasMore && (
          <TouchableOpacity style={styles.moreCard} onPress={onLoadMore} disabled={state.isLoadingMore}>
            {state.isLoadingMore ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.moreCardText}>Load more →</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

export function HomeScreen({ navigation }: Props) {
  const [forYou, setForYou] = useState<SectionState>(EMPTY_SECTION);
  const [isPersonalized, setIsPersonalized] = useState(false);
  const [trending, setTrending] = useState<SectionState>(EMPTY_SECTION);
  const [upcoming, setUpcoming] = useState<SectionState>(EMPTY_SECTION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [forYouRes, trendingRes, upcomingRes] = await Promise.all([
        api.get<{ results: TitleSummary[]; personalized: boolean }>("/discover/for-you"),
        api.get<DiscoverResponse>("/discover/trending"),
        api.get<DiscoverResponse>("/discover/upcoming"),
      ]);
      setForYou({ items: forYouRes.results.slice(0, 20), page: 1, hasMore: false, isLoadingMore: false });
      setIsPersonalized(forYouRes.personalized);
      setTrending({ items: trendingRes.results, page: trendingRes.page, hasMore: trendingRes.hasMore, isLoadingMore: false });
      setUpcoming({ items: upcomingRes.results, page: upcomingRes.page, hasMore: upcomingRes.hasMore, isLoadingMore: false });
    } catch {
      setError("Couldn't load Slate right now. Pull to refresh to try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMoreTrending() {
    setTrending((prev) => ({ ...prev, isLoadingMore: true }));
    try {
      const res = await api.get<DiscoverResponse>(`/discover/trending?page=${trending.page + 1}`);
      setTrending((prev) => ({ items: [...prev.items, ...res.results], page: res.page, hasMore: res.hasMore, isLoadingMore: false }));
    } catch {
      setTrending((prev) => ({ ...prev, isLoadingMore: false }));
    }
  }

  async function loadMoreUpcoming() {
    setUpcoming((prev) => ({ ...prev, isLoadingMore: true }));
    try {
      const res = await api.get<DiscoverResponse>(`/discover/upcoming?page=${upcoming.page + 1}`);
      setUpcoming((prev) => ({ items: [...prev.items, ...res.results], page: res.page, hasMore: res.hasMore, isLoadingMore: false }));
    } catch {
      setUpcoming((prev) => ({ ...prev, isLoadingMore: false }));
    }
  }

  const goToDetail = (titleId: string) => navigation.navigate("TitleDetail", { titleId });

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.header}>Slate</Text>
      <Text style={styles.tagline}>The home of entertainment hype.</Text>

      {isLoading && trending.items.length === 0 && upcoming.items.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          {forYou.items.length > 0 && (
            <>
              <Section title="For You" state={forYou} onPressTitle={goToDetail} onLoadMore={() => {}} />
              {!isPersonalized && (
                <Text style={styles.personalizeHint}>Pick favorite genres in Profile to personalize this feed.</Text>
              )}
            </>
          )}
          <Section title="Trending now" state={trending} onPressTitle={goToDetail} onLoadMore={loadMoreTrending} />
          <Section title="Coming up" state={upcoming} onPressTitle={goToDetail} onLoadMore={loadMoreUpcoming} />
          {trending.items.length === 0 && upcoming.items.length === 0 && (
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
  personalizeHint: { color: colors.textMuted, fontSize: 12, marginTop: -14, marginBottom: 24 },
  moreCard: { width: 100, height: 190, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  moreCardText: { color: colors.accent, fontWeight: "600", fontSize: 13, textAlign: "center" },
});
