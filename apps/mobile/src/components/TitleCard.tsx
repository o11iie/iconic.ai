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
    <TouchableOpacity style={styles.card} onPress={onPress}>
      {title.posterUrl ? (
        <Image source={{ uri: title.posterUrl }} style={styles.poster} />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          <Text style={styles.posterFallbackText}>{title.name.slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <Text numberOfLines={2} style={styles.name}>{title.name}</Text>
      <Text style={styles.meta}>
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
