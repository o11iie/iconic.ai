import React, { useEffect, useRef } from "react";
import { Animated, View, StyleSheet, type ViewStyle } from "react-native";
import { colors, radii, spacing } from "../theme";

/**
 * Pulsing placeholder block. Used instead of a bare spinner on content-heavy
 * screens so the layout doesn't jump once data lands.
 */
export function Skeleton({ width, height, style }: { width?: number | string; height: number; style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[styles.block, { width: (width as number) ?? "100%", height, opacity }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** A row of poster-shaped skeletons matching the Home carousel layout. */
export function PosterRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.posterItem}>
          <Skeleton width={130} height={190} />
          <Skeleton width={110} height={12} style={{ marginTop: spacing.sm }} />
          <Skeleton width={70} height={10} style={{ marginTop: spacing.xs }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.skeleton, borderRadius: radii.md },
  row: { flexDirection: "row" },
  posterItem: { marginRight: spacing.md },
});
