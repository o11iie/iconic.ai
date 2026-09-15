import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Switch, Alert } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import type { CommunityComment, CommunityPost, ReactionKind, ReportReason } from "@slate/shared";
import { api } from "../../api/client";
import { colors } from "../../theme";
import { SpoilerGate } from "../../components/SpoilerGate";

type RouteParams = Record<string, object | undefined> & {
  PostDetail: { postId: string };
};

interface Props {
  route: RouteProp<RouteParams, "PostDetail">;
}

const REACTION_EMOJI: Record<ReactionKind, string> = {
  HYPE: "🔥",
  LOVE: "❤️",
  MINDBLOWN: "🤯",
  LAUGH: "😂",
  SKEPTICAL: "🤔",
};

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "UNMARKED_SPOILER", label: "Unmarked spoiler" },
  { value: "MISINFORMATION", label: "Misinformation" },
  { value: "OTHER", label: "Other" },
];

export function PostDetailScreen({ route }: Props) {
  const { postId } = route.params;
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentHasSpoilers, setCommentHasSpoilers] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "sent">("idle");
  const [isBlocked, setIsBlocked] = useState(false);

  async function loadComments() {
    const res = await api.get<{ comments: CommunityComment[] }>(`/community/posts/${postId}/comments`);
    setComments(res.comments);
  }

  useEffect(() => {
    api
      .get<{ post: CommunityPost }>(`/community/posts/${postId}`)
      .then((res) => setPost(res.post))
      .catch(() => setPost(null));
    loadComments();
  }, [postId]);

  async function react(kind: ReactionKind) {
    if (!post) return;
    try {
      const res = await api.post<{ counts: Record<ReactionKind, number> }>(`/community/posts/${postId}/reactions`, { kind });
      setPost({ ...post, reactionCounts: res.counts });
    } catch {
      // best-effort
    }
  }

  async function submitComment() {
    if (!commentBody.trim()) return;
    setIsSubmittingComment(true);
    try {
      await api.post(`/community/posts/${postId}/comments`, { body: commentBody.trim(), containsSpoilers: commentHasSpoilers });
      setCommentBody("");
      setCommentHasSpoilers(false);
      await loadComments();
    } catch {
      // leave the draft in place so the user can retry
    } finally {
      setIsSubmittingComment(false);
    }
  }

  /**
   * Blocking is the self-service counterpart to reporting: reporting asks
   * moderators to act, blocking takes effect for this user immediately.
   * Google Play's UGC policy requires both.
   */
  function confirmBlock() {
    if (!post) return;
    Alert.alert(
      `Block @${post.authorHandle}?`,
      "You won't see their posts, comments or replies anywhere in Slate. They aren't told, and you can unblock them any time in Settings.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await api.post("/community/blocks", { userId: post.authorId });
              setIsBlocked(true);
            } catch {
              Alert.alert("Couldn't block", "Please try again.");
            }
          },
        },
      ],
    );
  }

  async function submitReport(reason: ReportReason) {
    try {
      await api.post("/community/reports", { targetType: "post", targetId: postId, reason });
      setReportStatus("sent");
      setIsReportOpen(false);
    } catch {
      // leave the report UI open so the user can retry
    }
  }

  if (!post) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.author}>@{post.authorHandle}</Text>
      <SpoilerGate containsSpoilers={post.containsSpoilers}>
        <Text style={styles.body}>{post.body}</Text>
      </SpoilerGate>

      <View style={styles.reactionRow}>
        {(Object.keys(REACTION_EMOJI) as ReactionKind[]).map((kind) => (
          <TouchableOpacity key={kind} style={styles.reactionButton} onPress={() => react(kind)}>
            <Text style={styles.reactionText}>
              {REACTION_EMOJI[kind]} {post.reactionCounts[kind] || ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {reportStatus === "sent" ? (
        <Text style={styles.reportedText}>Reported. Our moderators will take a look.</Text>
      ) : isReportOpen ? (
        <View style={styles.reportPanel}>
          <Text style={styles.reportPrompt}>Why are you reporting this post?</Text>
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity key={r.value} style={styles.reportOption} onPress={() => submitReport(r.value)}>
              <Text style={styles.reportOptionText}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.moderationRow}>
          <TouchableOpacity onPress={() => setIsReportOpen(true)} accessibilityRole="button">
            <Text style={styles.reportLink}>Report</Text>
          </TouchableOpacity>
          {isBlocked ? (
            <Text style={styles.blockedText}>Blocked — manage in Settings</Text>
          ) : (
            <TouchableOpacity onPress={confirmBlock} accessibilityRole="button">
              <Text style={styles.reportLink}>Block @{post.authorHandle}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Comments</Text>
      {comments.length === 0 ? (
        <Text style={styles.empty}>No comments yet.</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.commentRow}>
            <Text style={styles.commentAuthor}>@{c.authorHandle}</Text>
            <SpoilerGate containsSpoilers={c.containsSpoilers}>
              <Text style={styles.commentBody}>{c.body}</Text>
            </SpoilerGate>
          </View>
        ))
      )}

      <View style={styles.commentComposer}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textMuted}
          value={commentBody}
          onChangeText={setCommentBody}
          multiline
        />
        <View style={styles.commentComposerFooter}>
          <View style={styles.spoilerToggleRow}>
            <Text style={styles.spoilerToggleLabel}>Spoilers</Text>
            <Switch value={commentHasSpoilers} onValueChange={setCommentHasSpoilers} trackColor={{ true: colors.accent }} />
          </View>
          <TouchableOpacity style={styles.sendButton} onPress={submitComment} disabled={isSubmittingComment || !commentBody.trim()}>
            {isSubmittingComment ? <ActivityIndicator color="#000" /> : <Text style={styles.sendButtonText}>Send</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  author: { color: colors.textMuted, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  reactionRow: { flexDirection: "row", gap: 16, marginTop: 16, marginBottom: 12 },
  reactionButton: { paddingVertical: 4 },
  reactionText: { color: colors.textMuted, fontSize: 14 },
  reportLink: { color: colors.textMuted, fontSize: 12 },
  moderationRow: { flexDirection: "row", gap: 20, marginBottom: 20 },
  blockedText: { color: colors.pro, fontSize: 12 },
  reportedText: { color: colors.pro, fontSize: 12, marginBottom: 20 },
  reportPanel: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 20 },
  reportPrompt: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  reportOption: { paddingVertical: 8 },
  reportOptionText: { color: colors.textMuted, fontSize: 13 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 8, marginBottom: 12 },
  empty: { color: colors.textMuted, fontSize: 13 },
  commentRow: { marginBottom: 16 },
  commentAuthor: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginBottom: 4 },
  commentBody: { color: colors.text, fontSize: 14, lineHeight: 19 },
  commentComposer: { marginTop: 12, marginBottom: 40 },
  commentInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
    minHeight: 70,
    textAlignVertical: "top",
  },
  commentComposerFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  spoilerToggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  spoilerToggleLabel: { color: colors.textMuted, fontSize: 12 },
  sendButton: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  sendButtonText: { color: "#000", fontWeight: "700" },
});
