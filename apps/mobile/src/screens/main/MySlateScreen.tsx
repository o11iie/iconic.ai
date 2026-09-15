import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { PlanLimits, PlanTier, RadarBucket, ReleaseRadar, TitleSummary } from "@slate/shared";
import { api } from "../../api/client";
import { colors, radii, spacing, type } from "../../theme";
import { TitleCard } from "../../components/TitleCard";
import { PosterRowSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { track } from "../../analytics/analytics";

interface Props {
  navigation: { navigate: (screen: string, params?: object) => void };
}

interface MySlateResponse {
  displayName: string;
  tier: PlanTier;
  limits: PlanLimits;
  following: { total: number; movies: number; tv: number; games: number; items: TitleSummary[] };
  watchlist: {
    total: number;
    completed: number;
    movies: number;
    tv: number;
    games: number;
    items: (TitleSummary & { status: string })[];
  };
  radar: ReleaseRadar;
  journeys: { id: string; name: string; kind: string; mediaType: string; totalCount: number; completedCount: number }[];
  recommendations: TitleSummary[];
  unreadNotifications: number;
}

const BUCKET_LABEL: Record<RadarBucket, string> = {
  TODAY: "Today",
  THIS_WEEK: "This week",
  NEXT_WEEK: "Next week",
  THIS_MONTH: "This month",
  LATER: "Later",
};

function CategoryCounts({ movies, tv, games }: { movies: number; tv: number; games: number }) {
  return (
    <Text style={styles.counts}>
      {movies} movies · {tv} TV · {games} games
    </Text>
  );
}

export function MySlateScreen({ navigation }: Props) {
  const [data, setData] = useState<MySlateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<MySlateResponse>("/my-slate");
      setData(res);
    } catch {
      setError("Slate couldn't load your command center right now.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const goToDetail = (titleId: string) => navigation.navigate("TitleDetail", { titleId });

  if (isLoading && !data) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.header}>My Slate</Text>
        <PosterRowSkeleton />
      </ScrollView>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.container}>
        <EmptyState title="Slate couldn't load this" message={error ?? "Please try again."} actionLabel="Retry" onAction={load} />
      </View>
    );
  }

  const radarBuckets = (Object.keys(BUCKET_LABEL) as RadarBucket[]).filter((b) => data.radar.buckets[b].length > 0);
  const isEmpty = data.following.total === 0 && data.watchlist.total === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.accent} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.header}>My Slate</Text>
          <Text style={styles.subheader}>
            {data.tier === "PRO" ? "Your entertainment universe" : "Everything you're following"}
          </Text>
        </View>
        {data.tier === "PRO" && (
          <View style={styles.proBadge}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
        )}
      </View>

      {isEmpty ? (
        <EmptyState
          title="Your Slate is empty"
          message="Follow a few movies, shows or games and this becomes your command center — countdowns, releases and journeys in one place."
        />
      ) : (
        <>
          {/* Release Radar — the signature Pro surface, useful on Free too. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Release Radar</Text>
            {radarBuckets.length === 0 ? (
              <Text style={styles.muted}>Nothing on the radar in the next {data.radar.horizonDays} days.</Text>
            ) : (
              radarBuckets.map((bucket) => (
                <View key={bucket} style={styles.bucket}>
                  <Text style={styles.bucketLabel}>{BUCKET_LABEL[bucket]}</Text>
                  {data.radar.buckets[bucket].slice(0, 5).map((entry) => (
                    <TouchableOpacity
                      key={entry.title.id}
                      style={styles.radarRow}
                      onPress={() => goToDetail(entry.title.id)}
                      accessibilityRole="button"
                    >
                      <View style={styles.radarRowMain}>
                        <Text style={styles.radarName}>{entry.title.name}</Text>
                        <Text style={styles.radarMeta}>
                          {entry.mediaType.toUpperCase()} · {entry.releaseLabel}
                        </Text>
                      </View>
                      {entry.reasons.includes("FOLLOWED") && <Text style={styles.reasonTag}>Following</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}

            {/* Honest upsell: only shown when the horizon actually hid something. */}
            {data.radar.truncatedByPlan && (
              <TouchableOpacity
                style={styles.upsell}
                onPress={() => navigation.navigate("ProUpgrade", { trigger: "ADVANCED_RELEASE_RADAR" })}
                accessibilityRole="button"
              >
                <Text style={styles.upsellText}>
                  More releases are beyond your {data.radar.horizonDays}-day window. Slate Pro shows the full year →
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {data.journeys.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Journeys</Text>
              {data.journeys.map((j) => (
                <View key={j.id} style={styles.journeyRow}>
                  <Text style={styles.radarName}>{j.name}</Text>
                  <Text style={styles.radarMeta}>
                    {j.kind === "PLAY" ? "Play journey" : "Watch journey"} · {j.completedCount}/{j.totalCount} complete
                  </Text>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${j.totalCount ? (j.completedCount / j.totalCount) * 100 : 0}%` },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Following ({data.following.total})</Text>
            <CategoryCounts movies={data.following.movies} tv={data.following.tv} games={data.following.games} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
              {data.following.items.map((t) => (
                <TitleCard key={t.id} title={t} onPress={() => goToDetail(t.id)} />
              ))}
            </ScrollView>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Watchlist ({data.watchlist.total})</Text>
            <CategoryCounts movies={data.watchlist.movies} tv={data.watchlist.tv} games={data.watchlist.games} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
              {data.watchlist.items.map((t) => (
                <TitleCard key={t.id} title={t} onPress={() => goToDetail(t.id)} />
              ))}
            </ScrollView>
          </View>

          {data.limits.personalizedRecommendations ? (
            data.recommendations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recommended for you</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
                  {data.recommendations.map((t) => (
                    <TitleCard key={t.id} title={t} onPress={() => goToDetail(t.id)} />
                  ))}
                </ScrollView>
              </View>
            )
          ) : (
            <TouchableOpacity
              style={styles.upsell}
              onPress={() => {
                track("paywall_view", { trigger: "PERSONALIZATION" });
                navigation.navigate("ProUpgrade", { trigger: "PERSONALIZATION" });
              }}
              accessibilityRole="button"
            >
              <Text style={styles.upsellText}>
                Slate Pro learns what you're into and recommends across movies, TV and games →
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  header: { ...type.display, color: colors.text },
  subheader: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  proBadge: { backgroundColor: colors.pro, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  proBadgeText: { color: "#000", fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...type.h3, color: colors.text },
  counts: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  muted: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  bucket: { marginTop: spacing.md },
  bucketLabel: { ...type.caption, color: colors.accent, fontWeight: "800", letterSpacing: 0.8, marginBottom: spacing.sm },
  radarRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  radarRowMain: { flex: 1 },
  radarName: { ...type.body, color: colors.text, fontWeight: "700" },
  radarMeta: { ...type.micro, color: colors.textMuted, marginTop: 2 },
  reasonTag: { ...type.micro, color: colors.accent, fontWeight: "700" },
  journeyRow: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm },
  progressTrack: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: spacing.sm, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: colors.pro },
  upsell: {
    borderWidth: 1,
    borderColor: colors.pro,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  upsellText: { ...type.caption, color: colors.pro, lineHeight: 18, fontWeight: "600" },
});
