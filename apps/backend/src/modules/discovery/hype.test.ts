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

  it("scores an unrated but highly-anticipated game above an unrated, un-anticipated one", () => {
    const releaseWindow = { precision: "date_only" as const, date: new Date(Date.now() + 10 * 86400000).toISOString() };
    const hyped = makeTitle({ mediaType: "game", releaseWindow, anticipationCount: 4000 });
    const quiet = makeTitle({ mediaType: "game", releaseWindow, anticipationCount: 2 });
    expect(computeHypeScore(hyped)).toBeGreaterThan(computeHypeScore(quiet));
  });

  it("keeps the anticipation-derived score bounded between 0 and 1 even for huge counts", () => {
    const title = makeTitle({
      mediaType: "game",
      anticipationCount: 500_000,
      releaseWindow: { precision: "date_only", date: new Date().toISOString() },
    });
    const score = computeHypeScore(title);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
