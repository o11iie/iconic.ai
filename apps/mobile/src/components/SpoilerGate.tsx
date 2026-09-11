import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../theme";

/**
 * Any content the author flagged as containing spoilers is hidden behind a
 * tap-to-reveal warning. This is a binary gate for V1 — it does not yet
 * differentiate by how recently the title released (the full spirit of a
 * user's "hide_recent" vs "hide_all" preference), since that requires
 * correlating post age against episode air dates. Documented as a real
 * scope limitation, not a silent omission — see SLATE_RISKS.md.
 */
export function SpoilerGate({ containsSpoilers, children }: { containsSpoilers: boolean; children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(!containsSpoilers);

  if (revealed) return <>{children}</>;

  return (
    <TouchableOpacity style={styles.gate} onPress={() => setRevealed(true)}>
      <Text style={styles.gateText}>⚠️ Contains spoilers — tap to reveal</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gate: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  gateText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
});
