import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { api, ApiError } from "../../api/client";
import { colors } from "../../theme";
import { useAuth } from "../../state/AuthContext";

/** Ask Slate's request contract uses its own lowercase enum, independent of the stored SpoilerSensitivity enum. */
function toAskSlateSpoilerSensitivity(pref: string): "hide_all" | "hide_recent" | "show_all" {
  switch (pref) {
    case "HIDE_ALL":
      return "hide_all";
    case "SHOW_ALL":
      return "show_all";
    default:
      return "hide_recent";
  }
}

type RouteParams = Record<string, object | undefined> & {
  AskSlate: { titleId?: string } | undefined;
};

interface Props {
  route: RouteProp<RouteParams, "AskSlate">;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function AskSlateScreen({ route }: Props) {
  const titleId = route.params?.titleId;
  const { user } = useAuth();
  const spoilerSensitivity = toAskSlateSpoilerSensitivity(user?.preferences.spoilerSensitivity ?? "HIDE_RECENT");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setNotice(null);
    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: "user", content: text }]);
    setIsSending(true);
    try {
      const res = await api.post<{ conversationId: string; message: string; usage: { requestsRemainingToday: number | "unlimited" } }>(
        "/ai/ask",
        { message: text, titleId, conversationId, spoilerSensitivity },
      );
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "assistant", content: res.message }]);
      if (res.usage.requestsRemainingToday !== "unlimited" && res.usage.requestsRemainingToday <= 1) {
        setNotice(`${res.usage.requestsRemainingToday} Ask Slate question(s) left today. Upgrade to Pro for more.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "AI_LIMIT_REACHED") {
        setNotice(err.message);
      } else if (err instanceof ApiError && err.code === "AI_NOT_CONFIGURED") {
        setNotice("Ask Slate isn't configured yet — the backend needs an OpenAI API key.");
      } else {
        setNotice("Ask Slate couldn't respond. Please try again.");
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Ask Slate</Text>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Ask about release dates, what to watch before this, or catch up without spoilers.
          </Text>
        }
      />
      {notice && <Text style={styles.notice}>{notice}</Text>}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask Slate anything…"
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.sendButton} onPress={send} disabled={isSending}>
          {isSending ? <ActivityIndicator color="#000" /> : <Text style={styles.sendButtonText}>Send</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  header: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 12 },
  bubble: { padding: 12, borderRadius: 12, marginBottom: 8, maxWidth: "85%" },
  bubbleUser: { backgroundColor: colors.accent, alignSelf: "flex-end" },
  bubbleAssistant: { backgroundColor: colors.surface, alignSelf: "flex-start" },
  bubbleText: { color: colors.text },
  empty: { color: colors.textMuted, marginTop: 40, textAlign: "center", lineHeight: 20 },
  notice: { color: colors.pro, fontSize: 12, marginBottom: 8 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, color: colors.text },
  sendButton: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sendButtonText: { color: "#000", fontWeight: "700" },
});
