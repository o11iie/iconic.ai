import type { ReleaseWindow } from "@slate/shared";

export interface Countdown {
  /** Milliseconds until release, or null when precision doesn't support a countdown (e.g. "year" only). */
  msRemaining: number | null;
  hasReleased: boolean;
  /** Human label to show instead of/alongside a numeric countdown, e.g. "Q4 2026" or "Release date TBA". */
  displayLabel: string;
}

/**
 * Computes a countdown from a ReleaseWindow WITHOUT ever fabricating
 * precision the source data doesn't have. TMDB/IGDB only report calendar
 * dates (no time-of-day), so any "exact_datetime" countdown must come from
 * a source that actually reports one (e.g. a storefront release time) —
 * this function will not invent a midnight/local-time guess and call it exact.
 */
export function computeCountdown(window: ReleaseWindow, now: Date = new Date()): Countdown {
  switch (window.precision) {
    case "exact_datetime": {
      if (!window.date) return { msRemaining: null, hasReleased: false, displayLabel: "Release date TBA" };
      const releaseMs = new Date(window.date).getTime();
      const msRemaining = releaseMs - now.getTime();
      return {
        msRemaining: msRemaining > 0 ? msRemaining : 0,
        hasReleased: msRemaining <= 0,
        displayLabel: new Date(window.date).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: window.timezone ?? "UTC",
        }),
      };
    }
    case "date_only": {
      if (!window.date) return { msRemaining: null, hasReleased: false, displayLabel: "Release date TBA" };
      // Compare against the *start of day* in the release's own timezone
      // when known, else UTC — never claim second-level precision we don't have.
      const releaseDate = new Date(window.date);
      const msRemaining = releaseDate.getTime() - now.getTime();
      return {
        msRemaining: null, // intentionally no HH:MM:SS countdown for date-only precision
        hasReleased: msRemaining <= 0,
        displayLabel: releaseDate.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }),
      };
    }
    case "quarter":
      return { msRemaining: null, hasReleased: false, displayLabel: window.label ?? "Coming soon" };
    case "year":
      return { msRemaining: null, hasReleased: false, displayLabel: window.label ?? "Release year TBA" };
    case "unknown":
    default:
      return { msRemaining: null, hasReleased: false, displayLabel: "Release date TBA" };
  }
}

/** Days-only view for list/grid UI, derived from the same non-fabricated data. */
export function daysUntil(window: ReleaseWindow, now: Date = new Date()): number | null {
  if (window.precision !== "date_only" && window.precision !== "exact_datetime") return null;
  if (!window.date) return null;
  const diffMs = new Date(window.date).setUTCHours(0, 0, 0, 0) - new Date(now).setUTCHours(0, 0, 0, 0);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}
