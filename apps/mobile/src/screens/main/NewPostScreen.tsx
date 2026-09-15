import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Switch, ActivityIndicator } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import type { PostKind } from "@slate/shared";
import { api } from "../../api/client";
import { track } from "../../analytics/analytics";
import { colors } from "../../theme";

type RouteParams = Record<string, object | undefined> & {
  NewPost: { titleId: string };
};

interface Props {
  route: RouteProp<RouteParams, "NewPost">;
  navigation: { goBack: () => void };
}

const KINDS: { value: PostKind; label: string }[] = [
  { value: "DISCUSSION", label: "Discussion" },
  { value: "PREDICTION", label: "Prediction" },
  { value: "THEORY", label: "Theory" },
  { value: "REVIEW", label: "Review" },
];

export function NewPostScreen({ route, navigation }: Props) {
  const { titleId } = route.params;
  const [kind, setKind] = useState<PostKind>("DISCUSSION");
  const [body, setBody] = useState("");
  const [containsSpoilers, setContainsSpoilers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!body.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post("/community/posts", { titleId, kind, body: body.trim(), containsSpoilers });
      track("community_post", { kind, containsSpoilers });
      navigation.goBack();
    } catch {
      setError("Couldn't post right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Type</Text>
      <View style={styles.kindRow}>
        {KINDS.map((k) => (
          <TouchableOpacity
            key={k.value}
            style={[styles.kindChip, kind === k.value && styles.kindChipSelected]}
            onPress={() => setKind(k.value)}
          >
            <Text style={[styles.kindChipText, kind === k.value && styles.kindChipTextSelected]}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>What's on your mind?</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Share a discussion, prediction, or theory…"
        placeholderTextColor={colors.textMuted}
        multiline
        numberOfLines={6}
        value={body}
        onChangeText={setBody}
        maxLength={2000}
      />

      <View style={styles.spoilerRow}>
        <Text style={styles.label}>Contains spoilers</Text>
        <Switch value={containsSpoilers} onValueChange={setContainsSpoilers} trackColor={{ true: colors.accent }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={isSubmitting || !body.trim()}>
        {isSubmitting ? <ActivityIndicator color="#000" /> : <Text style={styles.submitButtonText}>Post</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 8, marginTop: 4 },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  kindChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 14 },
  kindChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindChipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  kindChipTextSelected: { color: "#000" },
  textArea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    color: colors.text,
    minHeight: 140,
    textAlignVertical: "top",
    marginBottom: 20,
  },
  spoilerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  error: { color: colors.accent, marginBottom: 12 },
  submitButton: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: "center" },
  submitButtonText: { color: "#000", fontWeight: "700", fontSize: 16 },
});
