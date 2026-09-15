import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "../theme";

/**
 * Empty and error states share this shape so every screen fails and empties
 * the same way. Copy should be specific — "No upcoming releases match these
 * filters" beats "Something went wrong".
 */
export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.action} onPress={onAction} accessibilityRole="button">
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Slate couldn't load this"
      message={message}
      actionLabel={onRetry ? "Try again" : undefined}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  title: { ...type.h3, color: colors.text, textAlign: "center" },
  message: { ...type.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm },
  action: {
    marginTop: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
  },
  actionText: { color: "#000", fontWeight: "700" },
});
