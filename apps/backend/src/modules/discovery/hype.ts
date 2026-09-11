import type { TitleSummary } from "@slate/shared";
import { daysUntil } from "./countdown";

// Heuristic normalization ceiling for IGDB's real "hypes" count, so a small
// indie game's real anticipation count doesn't read as 0 and a huge AAA
// title's doesn't blow past 1. This caps how anticipationCount CONTRIBUTES
// to the score — it never changes the real count shown to the user.
const ANTICIPATION_NORMALIZATION_CEILING = 5000;

/**
 * Hype Score is an explicit, documented heuristic — NOT a fabricated fact
 * about the title. It blends provider popularity (vote average, where
 * present — or IGDB's real anticipation count for pre-release games, which
 * usually have no rating yet) with release proximity, so upcoming titles
 * trend up as they approach release. This must always be presented in the
 * UI as "Slate's Hype Score" (an opinionated ranking), never as a claim of
 * real-world buzz data Slate does not actually have (e.g. social volume).
 */
export function computeHypeScore(title: TitleSummary): number {
  const days = daysUntil(title.releaseWindow);

  let proximityBoost = 0;
  if (days !== null) {
    if (days < 0) proximityBoost = 0.1; // already released, minor residual interest
    else if (days <= 7) proximityBoost = 1;
    else if (days <= 30) proximityBoost = 0.8;
    else if (days <= 90) proximityBoost = 0.5;
    else proximityBoost = 0.2;
  }

  let popularity: number;
  if (title.anticipationCount !== undefined) {
    const normalizedAnticipation = Math.min(
      1,
      Math.log10(title.anticipationCount + 1) / Math.log10(ANTICIPATION_NORMALIZATION_CEILING + 1),
    );
    const ratingComponent = title.voteAverage ? title.voteAverage / 10 : normalizedAnticipation;
    popularity = normalizedAnticipation * 0.7 + ratingComponent * 0.3;
  } else {
    popularity = title.voteAverage ? title.voteAverage / 10 : 0.3; // neutral default when unrated (upcoming titles)
  }

  const score = popularity * 0.5 + proximityBoost * 0.5;
  return Math.round(score * 100) / 100;
}

export function sortByHype(titles: TitleSummary[]): TitleSummary[] {
  return [...titles]
    .map((t) => ({ ...t, hypeScore: computeHypeScore(t) }))
    .sort((a, b) => (b.hypeScore ?? 0) - (a.hypeScore ?? 0));
}
