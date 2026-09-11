import { getEnv, isTmdbConfigured } from "../../env";
import type { Episode, Genre, MediaType, ReleaseWindow, SeasonDetail, TitleDetail, TitleSummary } from "@slate/shared";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export class TmdbNotConfiguredError extends Error {
  constructor() {
    super("TMDB_API_KEY is not configured. Set it in apps/backend/.env to enable movie/TV data.");
  }
}

export class TmdbApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

// Minimal shapes for the fields Slate actually consumes from TMDB's
// documented v3 responses (https://developer.themoviedb.org/reference).
interface TmdbGenre { id: number; name: string; }
interface TmdbListResult {
  id: number;
  title?: string; // movie
  name?: string; // tv
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string; // movie
  first_air_date?: string; // tv
  genre_ids: number[];
  vote_average: number;
}
interface TmdbListResponse { page: number; results: TmdbListResult[]; total_pages: number; }
interface TmdbVideo { id: string; key: string; name: string; site: string; type: string; official: boolean; published_at: string; }
interface TmdbCastMember { id: number; name: string; character: string; profile_path: string | null; order: number; }
interface TmdbDetail {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  tagline?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  genres: TmdbGenre[];
  vote_average: number;
  imdb_id?: string;
  number_of_episodes?: number;
  credits?: { cast: TmdbCastMember[] };
  videos?: { results: TmdbVideo[] };
  belongs_to_collection?: { id: number; name: string } | null;
  seasons?: TmdbSeasonSummary[]; // tv only
}

interface TmdbSeasonSummary {
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  overview?: string;
}

interface TmdbEpisode {
  episode_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  still_path: string | null;
  vote_average: number;
}

interface TmdbSeasonDetail {
  season_number: number;
  name: string;
  overview?: string;
  episodes: TmdbEpisode[];
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!isTmdbConfigured()) throw new TmdbNotConfiguredError();
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.searchParams.set("api_key", getEnv().TMDB_API_KEY);
  url.searchParams.set("language", "en-US");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new TmdbApiError(`TMDB request failed: ${res.status} ${res.statusText}`, res.status);
  }
  return res.json() as Promise<T>;
}

function posterUrl(path: string | null): string | undefined {
  return path ? `${TMDB_IMAGE_BASE}/w500${path}` : undefined;
}
function backdropUrl(path: string | null): string | undefined {
  return path ? `${TMDB_IMAGE_BASE}/w1280${path}` : undefined;
}

function releaseWindowFrom(dateStr: string | undefined): ReleaseWindow {
  if (!dateStr) return { precision: "unknown" };
  // TMDB only ever reports a calendar date, never a time-of-day — Slate
  // must not invent one. Exact release *times* are provider/storefront
  // specific and out of scope for TMDB-sourced titles.
  return { precision: "date_only", date: dateStr };
}

function genreMap(ids: number[], mediaType: "movie" | "tv"): Genre[] {
  const dict = mediaType === "movie" ? MOVIE_GENRES : TV_GENRES;
  return ids.map((id) => ({ id: String(id), name: dict[id] ?? "Unknown" })).filter((g) => g.name !== "Unknown");
}

// TMDB's /genre/{movie|tv}/list endpoint is stable and rarely changes;
// caching statically avoids an extra round-trip on every list request.
// Sourced from https://developer.themoviedb.org/reference/genre-movie-list
export const MOVIE_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};
export const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
  10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
  10767: "Talk", 10768: "War & Politics", 37: "Western",
};

function toSummary(item: TmdbListResult, mediaType: "movie" | "tv"): TitleSummary {
  const name = item.title ?? item.name ?? "Untitled";
  const dateStr = item.release_date ?? item.first_air_date;
  return {
    id: `${mediaType}:${item.id}`,
    mediaType,
    name,
    posterUrl: posterUrl(item.poster_path),
    backdropUrl: backdropUrl(item.backdrop_path),
    releaseWindow: releaseWindowFrom(dateStr),
    genres: genreMap(item.genre_ids, mediaType),
    voteAverage: item.vote_average,
  };
}

async function toDetail(item: TmdbDetail, mediaType: "movie" | "tv"): Promise<TitleDetail> {
  const name = item.title ?? item.name ?? "Untitled";
  const dateStr = item.release_date ?? item.first_air_date;

  return {
    id: `${mediaType}:${item.id}`,
    mediaType,
    name,
    overview: item.overview,
    tagline: item.tagline || undefined,
    posterUrl: posterUrl(item.poster_path),
    backdropUrl: backdropUrl(item.backdrop_path),
    releaseWindow: releaseWindowFrom(dateStr),
    genres: item.genres.map((g) => ({ id: String(g.id), name: g.name })),
    voteAverage: item.vote_average,
    externalIds: { tmdbId: item.id, imdbId: item.imdb_id },
    cast: (item.credits?.cast ?? [])
      .sort((a, b) => a.order - b.order)
      .slice(0, 15)
      .map((c) => ({ id: String(c.id), name: c.name, character: c.character, profileUrl: posterUrl(c.profile_path) })),
    trailers: (item.videos?.results ?? [])
      .filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"))
      .map((v) => ({ id: v.id, name: v.name, site: "YouTube" as const, key: v.key, official: v.official, publishedAt: v.published_at })),
    episodeCount: item.number_of_episodes,
    seasons: item.seasons
      // TMDB includes a "Specials" pseudo-season as season_number 0 — exclude it from the picker.
      ?.filter((s) => s.season_number > 0)
      .map((s) => ({
        seasonNumber: s.season_number,
        name: s.name,
        episodeCount: s.episode_count,
        airDate: s.air_date ?? undefined,
        posterUrl: posterUrl(s.poster_path),
        overview: s.overview || undefined,
      })),
    franchise: item.belongs_to_collection
      ? { id: String(item.belongs_to_collection.id), name: item.belongs_to_collection.name, watchOrder: [] }
      : undefined,
    attribution: {
      source: "tmdb",
      notice: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    },
  };
}

export async function trending(
  mediaType: "movie" | "tv" | "all",
  window: "day" | "week",
  page = 1,
): Promise<TitleSummary[]> {
  const data = await tmdbFetch<TmdbListResponse>(`/trending/${mediaType}/${window}`, { page: String(page) });
  return data.results.map((r) => toSummary(r, mediaType === "all" ? (r.title ? "movie" : "tv") : mediaType));
}

export async function upcomingMovies(page = 1): Promise<TitleSummary[]> {
  const data = await tmdbFetch<TmdbListResponse>("/movie/upcoming", { page: String(page) });
  return data.results.map((r) => toSummary(r, "movie"));
}

export async function onTheAirTv(page = 1): Promise<TitleSummary[]> {
  const data = await tmdbFetch<TmdbListResponse>("/tv/on_the_air", { page: String(page) });
  return data.results.map((r) => toSummary(r, "tv"));
}

export async function search(mediaType: "movie" | "tv", query: string, page = 1): Promise<TitleSummary[]> {
  const data = await tmdbFetch<TmdbListResponse>(`/search/${mediaType}`, { query, page: String(page) });
  return data.results.map((r) => toSummary(r, mediaType));
}

export async function getDetail(mediaType: "movie" | "tv", externalId: string): Promise<TitleDetail> {
  const data = await tmdbFetch<TmdbDetail>(`/${mediaType}/${externalId}`, { append_to_response: "credits,videos" });
  return toDetail(data, mediaType);
}

export function parseTitleId(titleId: string): { mediaType: MediaType; externalId: string } {
  const [prefix, externalId] = titleId.split(":");
  return { mediaType: prefix as MediaType, externalId };
}

export async function getSeasonDetail(tvId: string, seasonNumber: number): Promise<SeasonDetail> {
  const data = await tmdbFetch<TmdbSeasonDetail>(`/tv/${tvId}/season/${seasonNumber}`);
  const episodes: Episode[] = data.episodes.map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name,
    overview: e.overview,
    airDate: e.air_date ?? undefined,
    stillUrl: backdropUrl(e.still_path),
    voteAverage: e.vote_average || undefined,
  }));
  return { seasonNumber: data.season_number, name: data.name, overview: data.overview || undefined, episodes };
}
