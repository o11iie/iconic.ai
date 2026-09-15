import { TextStyle } from "react-native";

/**
 * Slate's design tokens. Screens must compose from these rather than
 * hardcoding hex values or magic numbers, so the cinematic look stays
 * consistent and a future rebrand is a change here, not a sweep of every
 * StyleSheet.
 */
export const colors = {
  background: "#0B0B0F",
  surface: "#17171F",
  surfaceRaised: "#1F1F2A",
  border: "#2A2A35",
  text: "#F5F5F7",
  textMuted: "#9A9AA5",
  accent: "#FF4D4D", // hype red
  pro: "#F5C542",
  success: "#3DDC84",
  /** Base for skeleton shimmer blocks. */
  skeleton: "#222230",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  xxl: 40,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

/**
 * Named `type` rather than `typography` so call sites read
 * `type.h1`; import it aliased when that shadows something local.
 */
export const type = {
  display: { fontSize: 32, fontWeight: "800", letterSpacing: -0.5 } as TextStyle,
  h1: { fontSize: 26, fontWeight: "800" } as TextStyle,
  h2: { fontSize: 22, fontWeight: "800" } as TextStyle,
  h3: { fontSize: 18, fontWeight: "700" } as TextStyle,
  body: { fontSize: 14, lineHeight: 20 } as TextStyle,
  bodyLarge: { fontSize: 16, lineHeight: 23 } as TextStyle,
  caption: { fontSize: 12 } as TextStyle,
  micro: { fontSize: 11 } as TextStyle,
};

/** Minimum Android touch target, per accessibility guidance. */
export const MIN_TOUCH_TARGET = 44;
