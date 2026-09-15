import type { MediaType, TitleSummary } from "./title";

/**
 * A Watch Journey (film/TV) or Play Journey (games) — an ordered path
 * through a franchise leading to a target title.
 *
 * Ordering and membership always come from real provider data (a TMDB
 * collection, an IGDB collection) sorted by actual release date. Slate does
 * not invent franchise membership or a "recommended order" it can't source.
 */
export type JourneyKind = "WATCH" | "PLAY";

export type JourneyStepState = "COMPLETED" | "NEXT" | "UPCOMING" | "TARGET";

export interface JourneyStep {
  position: number;
  title: TitleSummary;
  state: JourneyStepState;
  /**
   * Why this entry is in the path. Derived from verifiable facts (franchise
   * membership, release order, whether it's the target) — never a
   * fabricated plot-level claim about what it "sets up".
   */
  reason: string;
  /** True when the user has marked it completed on their watchlist. */
  completed: boolean;
}

export interface Journey {
  id: string;
  kind: JourneyKind;
  name: string;
  mediaType: MediaType;
  /** The title the journey builds toward, when it was created from one. */
  target?: TitleSummary;
  steps: JourneyStep[];
  completedCount: number;
  totalCount: number;
  /** The next thing to watch/play, or null when the journey is finished. */
  nextStep: JourneyStep | null;
  /** Provider attribution for the franchise data this was built from. */
  source: "tmdb" | "igdb";
}

export interface JourneySummary {
  id: string;
  kind: JourneyKind;
  name: string;
  mediaType: MediaType;
  completedCount: number;
  totalCount: number;
  nextStepName: string | null;
}
