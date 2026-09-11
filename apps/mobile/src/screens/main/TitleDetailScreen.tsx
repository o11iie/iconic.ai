import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import type { SeasonDetail, TitleDetail } from "@slate/shared";
import { api, ApiError } from "../../api/client";
import { colors } from "../../theme";

function SeasonList({ tvId, seasons }: { tvId: string; seasons: NonNullable<TitleDetail["seasons"]> }) {
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [seasonDetail, setSeasonDetail] = useState<SeasonDetail | null>(null);
  const [isLoadingSeason, setIsLoadingSeason] = useState(false);

  async function toggleSeason(seasonNumber: number) {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      setSeasonDetail(null);
      return;
    }
    setExpandedSeason(seasonNumber);
    setSeasonDetail(null);
    setIsLoadingSeason(true);
    try {
      const res = await api.get<{ season: SeasonDetail }>(`/tv/${tvId}/season/${seasonNumber}`);
      setSeasonDetail(res.season);
    } catch {
      setSeasonDetail(null);
    } finally {
      setIsLoadingSeason(false);
    }
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>Seasons</Text>
      {seasons.map((season) => (
        <View key={season.seasonNumber}>
          <TouchableOpacity style={styles.seasonRow} onPress={() => toggleSeason(season.seasonNumber)}>
            <Text style={styles.seasonName}>{season.name}</Text>
            <Text style={styles.seasonMeta}>
              {season.episodeCount} episode{season.episodeCount === 1 ? "" : "s"}
              {season.airDate ? ` · ${new Date(season.airDate).getFullYear()}` : ""}
            </Text>
          </TouchableOpacity>
          {expandedSeason === season.seasonNumber && (
            <View style={styles.episodeList}>
              {isLoadingSeason ? (
                <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
              ) : seasonDetail ? (
                seasonDetail.episodes.map((ep) => (
                  <View key={ep.episodeNumber} style={styles.episodeRow}>
                    <Text style={styles.episodeTitle}>
                      {ep.episodeNumber}. {ep.name}
                    </Text>
                    {ep.airDate && <Text style={styles.episodeMeta}>{ep.airDate}</Text>}
                    {ep.overview ? <Text style={styles.episodeOverview}>{ep.overview}</Text> : null}
                  </View>
                ))
              ) : (
                <Text style={styles.episodeMeta}>Couldn't load episodes for this season.</Text>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

type RouteParams = Record<string, object | undefined> & {
  TitleDetail: { titleId: string };
};

interface Props {
  route: RouteProp<RouteParams, "TitleDetail">;
  navigation: { navigate: (screen: string, params?: object) => void };
}

export function TitleDetailScreen({ route, navigation }: Props) {
  const { titleId } = route.params;
  const [detail, setDetail] = useState<(TitleDetail & { countdown?: { displayLabel: string } }) | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isOnWatchlist, setIsOnWatchlist] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const [mediaType, externalId] = titleId.split(":");
    api
      .get<{ title: TitleDetail; countdown: { displayLabel: string } }>(`/titles/${mediaType}/${externalId}`)
      .then((res) => setDetail({ ...res.title, countdown: res.countdown }))
      .catch(() => setError("Couldn't load this title."));
  }, [titleId]);

  async function toggleFollow() {
    try {
      if (isFollowing) {
        await api.delete(`/follows/${titleId}`);
        setIsFollowing(false);
      } else {
        await api.post("/follows", { titleId });
        setIsFollowing(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "PRO_REQUIRED") {
        navigation.navigate("ProUpgrade");
      }
    }
  }

  async function toggleWatchlist() {
    try {
      if (isOnWatchlist) {
        await api.delete(`/watchlist/${titleId}`);
        setIsOnWatchlist(false);
      } else {
        await api.post("/watchlist", { titleId });
        setIsOnWatchlist(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "PRO_REQUIRED") {
        navigation.navigate("ProUpgrade");
      }
    }
  }

  if (error) return <View style={styles.container}><Text style={styles.error}>{error}</Text></View>;
  if (!detail) return <View style={styles.container}><ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} /></View>;

  const trailer = detail.trailers.find((t) => t.site === "YouTube");

  return (
    <ScrollView style={styles.container}>
      {detail.backdropUrl && <Image source={{ uri: detail.backdropUrl }} style={styles.backdrop} />}
      <View style={styles.content}>
        <Text style={styles.name}>{detail.name}</Text>
        <Text style={styles.meta}>{detail.countdown?.displayLabel ?? "Release date TBA"}</Text>
        {detail.tagline ? <Text style={styles.tagline}>{detail.tagline}</Text> : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.actionButton, isOnWatchlist && styles.actionButtonActive]} onPress={toggleWatchlist}>
            <Text style={styles.actionText}>{isOnWatchlist ? "On Watchlist" : "+ Watchlist"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, isFollowing && styles.actionButtonActive]} onPress={toggleFollow}>
            <Text style={styles.actionText}>{isFollowing ? "Following" : "+ Follow"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate("AskSlate", { titleId })}
          >
            <Text style={styles.actionText}>Ask Slate</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.overview}>{detail.overview || "No overview available."}</Text>

        {trailer && (
          <TouchableOpacity onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${trailer.key}`)}>
            <Text style={styles.trailerLink}>▶ Watch trailer</Text>
          </TouchableOpacity>
        )}

        {detail.cast.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Cast</Text>
            <Text style={styles.castText}>{detail.cast.map((c) => c.name).join(", ")}</Text>
          </>
        )}

        {detail.mediaType === "game" && (
          <>
            {detail.developer && (
              <>
                <Text style={styles.sectionTitle}>Developer</Text>
                <Text style={styles.castText}>{detail.developer}</Text>
              </>
            )}
            {detail.platforms && detail.platforms.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Platforms</Text>
                <Text style={styles.castText}>{detail.platforms.join(", ")}</Text>
              </>
            )}
            {typeof detail.anticipationCount === "number" && detail.anticipationCount > 0 && (
              <Text style={styles.anticipationText}>
                🔥 {detail.anticipationCount.toLocaleString()} {detail.anticipationCount === 1 ? "person is" : "people are"} anticipating this on IGDB
              </Text>
            )}
          </>
        )}

        {detail.mediaType === "tv" && detail.seasons && detail.seasons.length > 0 && (
          <SeasonList tvId={titleId.split(":")[1]} seasons={detail.seasons} />
        )}

        <Text style={styles.attribution}>{detail.attribution.notice}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backdrop: { width: "100%", height: 220 },
  content: { padding: 20 },
  name: { color: colors.text, fontSize: 26, fontWeight: "800" },
  meta: { color: colors.accent, fontSize: 14, fontWeight: "600", marginTop: 4 },
  tagline: { color: colors.textMuted, fontStyle: "italic", marginTop: 4 },
  actionsRow: { flexDirection: "row", gap: 10, marginVertical: 18, flexWrap: "wrap" },
  actionButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  actionButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  overview: { color: colors.text, lineHeight: 21, marginBottom: 12 },
  trailerLink: { color: colors.accent, fontWeight: "700", marginBottom: 16 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 8, marginBottom: 4 },
  castText: { color: colors.textMuted, lineHeight: 20 },
  anticipationText: { color: colors.pro, fontSize: 13, fontWeight: "600", marginTop: 12 },
  attribution: { color: colors.textMuted, fontSize: 11, marginTop: 24 },
  error: { color: colors.accent, textAlign: "center", marginTop: 60 },
  seasonRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  seasonName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  seasonMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  episodeList: { paddingLeft: 12, paddingBottom: 8 },
  episodeRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  episodeTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  episodeMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  episodeOverview: { color: colors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
});
