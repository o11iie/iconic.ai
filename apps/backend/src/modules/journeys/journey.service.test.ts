import { describe, expect, it } from "vitest";
import { buildJourney } from "./journey.service";
import type { TitleSummary } from "@slate/shared";

function part(id: string, year: number, mediaType: TitleSummary["mediaType"] = "movie"): TitleSummary {
  return {
    id,
    mediaType,
    name: `Part ${id}`,
    releaseWindow: { precision: "date_only", date: `${year}-01-01T00:00:00.000Z` },
    genres: [],
  };
}

describe("buildJourney", () => {
  it("marks the first unwatched entry as NEXT and earlier ones COMPLETED", () => {
    const journey = buildJourney({
      id: "j1",
      name: "Test Collection",
      kind: "WATCH",
      source: "tmdb",
      parts: [part("movie:1", 2008), part("movie:2", 2010), part("movie:3", 2012)],
      completedTitleIds: new Set(["movie:1"]),
    });

    expect(journey.steps.map((s) => s.state)).toEqual(["COMPLETED", "NEXT", "UPCOMING"]);
    expect(journey.nextStep?.title.id).toBe("movie:2");
    expect(journey.completedCount).toBe(1);
    expect(journey.totalCount).toBe(3);
  });

  it("marks the target title distinctly from the ordered path", () => {
    const journey = buildJourney({
      id: "j2",
      name: "Test Collection",
      kind: "WATCH",
      source: "tmdb",
      parts: [part("movie:1", 2008), part("movie:2", 2010)],
      completedTitleIds: new Set(),
      targetTitleId: "movie:2",
    });

    expect(journey.steps[1].state).toBe("TARGET");
    expect(journey.target?.id).toBe("movie:2");
  });

  it("reports no next step once everything is completed", () => {
    const journey = buildJourney({
      id: "j3",
      name: "Done",
      kind: "WATCH",
      source: "tmdb",
      parts: [part("movie:1", 2008)],
      completedTitleIds: new Set(["movie:1"]),
    });
    expect(journey.nextStep).toBeNull();
    expect(journey.completedCount).toBe(journey.totalCount);
  });

  // Games are a first-class journey type, not an afterthought.
  it("builds play journeys for games with game-appropriate wording", () => {
    const journey = buildJourney({
      id: "j4",
      name: "Essential Zelda",
      kind: "PLAY",
      source: "igdb",
      parts: [part("game:1", 1998, "game"), part("game:2", 2017, "game")],
      completedTitleIds: new Set(),
    });

    expect(journey.kind).toBe("PLAY");
    expect(journey.mediaType).toBe("game");
    expect(journey.source).toBe("igdb");
    expect(journey.steps[0].reason).toContain("Play #1");
  });

  // Step rationale must stay factual — position, franchise, year — never a
  // plot claim Slate cannot source from provider data.
  it("keeps step reasons factual rather than speculative", () => {
    const journey = buildJourney({
      id: "j5",
      name: "Test Collection",
      kind: "WATCH",
      source: "tmdb",
      parts: [part("movie:1", 2008)],
      completedTitleIds: new Set(),
    });
    expect(journey.steps[0].reason).toBe("Watch #1 in Test Collection · released 2008.");
  });
});
