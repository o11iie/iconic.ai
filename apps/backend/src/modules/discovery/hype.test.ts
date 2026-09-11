import { describe, expect, it } from "vitest";
import { computeHypeScore } from "./hype";
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

describe("computeHypeScore", () => {
  it("scores a title releasing this week higher than one releasing next year", () => {
    const soon = makeTitle({
      releaseWindow: { precision: "date_only", date: new Date(Date.now() + 3 * 86400000).toISOString() },
    });
    const farOut = makeTitle({
      releaseWindow: { precision: "date_only", date: new Date(Date.now() + 300 * 86400000).toISOString() },
    });
    expect(computeHypeScore(soon)).toBeGreaterThan(computeHypeScore(farOut));
  });

  it("returns a bounded score between 0 and 1", () => {
    const title = makeTitle({ voteAverage: 9.5, releaseWindow: { precision: "date_only", date: new Date().toISOString() } });
    const score = computeHypeScore(title);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
