/**
 * Unified domain model for the three content types Slate covers.
 * `MediaType` distinguishes the underlying source (TMDB movie/tv, IGDB game)
 * while `Title` is the normalized shape every client (mobile, backend
 * consumers) works with, regardless of source.
 */
export type MediaType = "movie" | "tv" | "game";

export interface ExternalIds {
  tmdbId?: number;
  igdbId?: number;
  imdbId?: string;
}

/**
 * A release date is only ever as precise as the upstream provider reports.
 * `precision` must be honored by every countdown/UI surface — Slate must
 * never invent a time-of-day that TMDB/IGDB did not supply.
 */
export type ReleaseDatePrecision = "exact_datetime" | "date_only" | "quarter" | "year" | "unknown";

export interface ReleaseWindow {
  precision: ReleaseDatePrecision;
  /** ISO-8601. Present when precision is "exact_datetime" or "date_only". */
  date?: string;
  /** IANA timezone the date/time was reported in, when known (e.g. store release times). */
  timezone?: string;
  /** e.g. "Q4 2026" when precision is "quarter" */
  label?: string;
}

export interface Genre {
  id: string;
  name: string;
}

export interface TitleSummary {
  id: string; // Slate internal id: `${mediaType}:${externalId}`
  mediaType: MediaType;
  name: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseWindow: ReleaseWindow;
  genres: Genre[];
  hypeScore?: number;
  voteAverage?: number;
}

export interface CastMember {
  id: string;
  name: string;
  character?: string;
  profileUrl?: string;
}

export interface Trailer {
  id: string;
  name: string;
  site: "YouTube" | "Other";
  key: string;
  official: boolean;
  publishedAt?: string;
}

export interface TitleDetail extends TitleSummary {
  overview: string;
  tagline?: string;
  externalIds: ExternalIds;
  cast: CastMember[];
  trailers: Trailer[];
  franchise?: {
    id: string;
    name: string;
    /** Ordered list of titles Slate recommends watching/playing before this one. */
    watchOrder: TitleSummary[];
  };
  /** TV/game-specific: season/episode or DLC context, when applicable. */
  seasonNumber?: number;
  episodeCount?: number;
  platforms?: string[]; // games only
  attribution: DataAttribution;
}

export interface DataAttribution {
  source: "tmdb" | "igdb";
  /** Provider attribution string required by ToS, rendered in the UI. */
  notice: string;
}
