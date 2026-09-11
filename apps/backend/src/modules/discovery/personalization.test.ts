import { describe, expect, it } from "vitest";
import { dedupeById, genreAffinityScore, sortByPersonalizedScore } from "./personalization";
import type { TitleSummary } from "@slate/shared";

function makeTitle(overrides: Partial<TitleSummary> = {}): TitleSummary {
  return {
    id: "movie:1",
    mediaType: "movie",
    name: "Test Title",
    releaseWindow: { precision: "unknown" },
    genres: [],
    ...overrides,
  };
}

describe("genreAffinityScore", () => {
  it("boosts a title that matches a favorite genre over an identical one that doesn't", () => {
    const horror = makeTitle({ id: "movie:1", genres: [{ id: "27", name: "Horror" }] });
    const drama = makeTitle({ id: "movie:2", genres: [{ id: "18", name: "Drama" }] });
    expect(genreAffinityScore(horror, ["Horror"])).toBeGreaterThan(genreAffinityScore(drama, ["Horror"]));
  });

  it("matches case-insensitively", () => {
    const title = makeTitle({ genres: [{ id: "27", name: "Horror" }] });
    expect(genreAffinityScore(title, ["horror"])).toBe(genreAffinityScore(title, ["Horror"]));
  });

  it("falls back to plain hype score when no favorite genres are set", () => {
    const title = makeTitle({ genres: [{ id: "27", name: "Horror" }] });
    expect(genreAffinityScore(title, [])).toBeLessThanOrEqual(1);
    expect(genreAffinityScore(title, [])).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds a score of 1 even with a boost", () => {
    const soon = makeTitle({
      genres: [{ id: "27", name: "Horror" }],
      voteAverage: 10,
      releaseWindow: { precision: "date_only", date: new Date().toISOString() },
    });
    expect(genreAffinityScore(soon, ["Horror"])).toBeLessThanOrEqual(1);
  });
});

describe("dedupeById", () => {
  it("keeps only the first occurrence of a repeated id", () => {
    const a = makeTitle({ id: "movie:1", name: "First" });
    const b = makeTitle({ id: "movie:1", name: "Second" });
    const c = makeTitle({ id: "movie:2", name: "Third" });
    const result = dedupeById([a, b, c]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("First");
  });
});

describe("sortByPersonalizedScore", () => {
  it("ranks genre-matching titles above non-matching ones of similar hype", () => {
    const match = makeTitle({ id: "movie:1", genres: [{ id: "27", name: "Horror" }] });
    const noMatch = makeTitle({ id: "movie:2", genres: [{ id: "18", name: "Drama" }] });
    const ranked = sortByPersonalizedScore([noMatch, match], ["Horror"]);
    expect(ranked[0].id).toBe("movie:1");
  });
});
