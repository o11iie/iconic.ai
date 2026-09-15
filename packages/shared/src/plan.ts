/**
 * Slate's plan model: what Free gets, what Pro adds, and why a paywall
 * appeared. Shared so backend gates and mobile copy can never drift apart —
 * if the server enforces 10 follows, the UI must not promise 15.
 */

export type PlanTier = "FREE" | "PRO";

/**
 * Why a paywall was shown. Every gate returns one of these so the Pro screen
 * can lead with the benefit the user was actually reaching for, instead of a
 * generic pitch, and so conversion can be measured per trigger.
 */
export type PaywallTrigger =
  | "FOLLOW_LIMIT"
  | "WATCHLIST_LIMIT"
  | "AI_LIMIT"
  | "ADVANCED_RELEASE_RADAR"
  | "ADVANCED_JOURNEY"
  | "PERSONALIZATION"
  | "SPOILER_CONTROLS"
  | "DIRECT"; // user opened Pro deliberately, not from a gate

export interface PlanLimits {
  /** Titles a user may follow. `null` = unlimited. */
  maxFollows: number | null;
  /** Watchlist entries. `null` = unlimited. */
  maxWatchlistItems: number | null;
  /** Ask Slate messages per day. Pro is a high configurable ceiling, not literally unlimited — cost and abuse still need a bound. */
  dailyAiMessages: number;
  /**
   * How far ahead Release Radar looks. Free sees what's imminent (genuinely
   * useful); Pro sees the full planning horizon across all three categories.
   */
  releaseRadarHorizonDays: number;
  /** Saved Watch/Play Journeys. `null` = unlimited. */
  maxSavedJourneys: number | null;
  /** Personalized recommendations and the full My Slate command center. */
  personalizedRecommendations: boolean;
  /** Per-title spoiler overrides rather than one global setting. */
  advancedSpoilerControls: boolean;
  adFree: boolean;
}

/**
 * Free is deliberately a genuinely useful product, not a crippled demo:
 * full discovery, search, details, countdowns, community, a real watchlist,
 * and a two-week Release Radar. Pro earns its price through scale,
 * intelligence and personalization — not by breaking the basics.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  FREE: {
    maxFollows: 10,
    maxWatchlistItems: 25,
    dailyAiMessages: 5,
    releaseRadarHorizonDays: 14,
    maxSavedJourneys: 1,
    personalizedRecommendations: false,
    advancedSpoilerControls: false,
    adFree: false,
  },
  PRO: {
    maxFollows: null,
    maxWatchlistItems: null,
    dailyAiMessages: 100,
    releaseRadarHorizonDays: 365,
    maxSavedJourneys: null,
    personalizedRecommendations: true,
    advancedSpoilerControls: true,
    adFree: true,
  },
};

export function limitsFor(tier: PlanTier): PlanLimits {
  return PLAN_LIMITS[tier];
}

/** Shape returned whenever a gate blocks an action, so the client can open the right paywall. */
export interface PaywallResponse {
  error: string;
  code: "PRO_REQUIRED";
  trigger: PaywallTrigger;
}
