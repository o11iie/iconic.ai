import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import type { TitleSummary } from "@slate/shared";
import { colors } from "../theme";

interface Props {
  title: TitleSummary & { countdown?: { displayLabel: string } };
  onPress: () => void;
}

export function TitleCard({ title, onPress }: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      // One coherent sentence rather than three separate nodes, so a screen
      // reader announces "Dune Part Two, movie, in 12 days" instead of
      // reading the poster, the name and the metadata as unrelated items.
      accessibilityLabel={`${title.name}, ${title.mediaType.toLowerCase()}, ${
        title.countdown?.displayLabel ?? title.releaseWindow.label ?? "release date to be announced"
      }`}
    >
      {title.posterUrl ? (
        <Image source={{ uri: title.posterUrl }} style={styles.poster} accessible={false} />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          <Text style={styles.posterFallbackText}>{title.name.slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <Text numberOfLines={2} style={styles.name} accessible={false}>{title.name}</Text>
      <Text style={styles.meta} accessible={false}>
        {title.mediaType.toUpperCase()} · {title.countdown?.displayLabel ?? title.releaseWindow.label ?? "TBA"}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { width: 130, marginRight: 12 },
  poster: { width: 130, height: 190, borderRadius: 10, backgroundColor: colors.surface },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  posterFallbackText: { color: colors.textMuted, fontSize: 24, fontWeight: "700" },
  name: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 6 },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
