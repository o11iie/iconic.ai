import type { TitleSummary } from "@slate/shared";
import { computeHypeScore } from "./hype";

/**
 * Personalization boost from a user's favorite genres, layered on top of
 * Hype Score rather than replacing it — a title the user has no genre
 * affinity for can still surface if it's overwhelmingly popular/imminent,
 * it just won't be boosted above equally-hyped titles that DO match.
 * Matching is case-insensitive by genre NAME (see genres.routes.ts) since
 * TMDB and IGDB each use their own numeric genre ids.
 */
const GENRE_MATCH_BOOST = 0.25;

export function genreAffinityScore(title: TitleSummary, favoriteGenres: string[]): number {
  if (favoriteGenres.length === 0) return computeHypeScore(title);
  const favoriteSet = new Set(favoriteGenres.map((g) => g.toLowerCase()));
  const matches = title.genres.some((g) => favoriteSet.has(g.name.toLowerCase()));
  const base = computeHypeScore(title);
  return matches ? Math.min(1, base + GENRE_MATCH_BOOST) : base;
}

/** Dedupes by id (a title can appear in both trending and upcoming) keeping the first occurrence. */
export function dedupeById(titles: TitleSummary[]): TitleSummary[] {
  const seen = new Set<string>();
  const result: TitleSummary[] = [];
  for (const t of titles) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    result.push(t);
  }
  return result;
}

export function sortByPersonalizedScore(titles: TitleSummary[], favoriteGenres: string[]): TitleSummary[] {
  return [...titles]
    .map((t) => ({ ...t, hypeScore: genreAffinityScore(t, favoriteGenres) }))
    .sort((a, b) => (b.hypeScore ?? 0) - (a.hypeScore ?? 0));
}
