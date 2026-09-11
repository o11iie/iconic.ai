import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { CommunityPost, ReactionKind } from "@slate/shared";
import { colors } from "../theme";
import { SpoilerGate } from "./SpoilerGate";

const REACTION_EMOJI: Record<ReactionKind, string> = {
  HYPE: "🔥",
  LOVE: "❤️",
  MINDBLOWN: "🤯",
  LAUGH: "😂",
  SKEPTICAL: "🤔",
};

const KIND_LABEL: Record<CommunityPost["kind"], string> = {
  DISCUSSION: "Discussion",
  PREDICTION: "Prediction",
  THEORY: "Theory",
  REVIEW: "Review",
};

export function CommunityPostCard({
  post,
  onPress,
  onReact,
}: {
  post: CommunityPost;
  onPress: () => void;
  onReact: (kind: ReactionKind) => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.headerRow}>
        <Text style={styles.author}>@{post.authorHandle}</Text>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{KIND_LABEL[post.kind]}</Text>
        </View>
      </View>

      <SpoilerGate containsSpoilers={post.containsSpoilers}>
        <Text style={styles.body} numberOfLines={4}>
          {post.body}
        </Text>
      </SpoilerGate>

      <View style={styles.footerRow}>
        {(Object.keys(REACTION_EMOJI) as ReactionKind[]).map((kind) => (
          <TouchableOpacity key={kind} style={styles.reactionButton} onPress={() => onReact(kind)}>
            <Text style={styles.reactionText}>
              {REACTION_EMOJI[kind]} {post.reactionCounts[kind] || ""}
            </Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.commentCount}>💬 {post.commentCount}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  author: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  kindBadge: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  kindBadgeText: { color: colors.accent, fontSize: 10, fontWeight: "700" },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  footerRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 12 },
  reactionButton: { paddingVertical: 2 },
  reactionText: { color: colors.textMuted, fontSize: 12 },
  commentCount: { color: colors.textMuted, fontSize: 12, marginLeft: "auto" },
});
