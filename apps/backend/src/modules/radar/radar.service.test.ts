import { describe, expect, it } from "vitest";
import { bucketFor, buildReleaseRadar, mergeInputs } from "./radar.service";
import type { TitleSummary } from "@slate/shared";

const NOW = new Date("2026-06-15T12:00:00Z");

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86400000).toISOString();
}

function title(id: string, overrides: Partial<TitleSummary> = {}): TitleSummary {
  return {
    id,
    mediaType: "movie",
    name: `Title ${id}`,
    releaseWindow: { precision: "date_only", date: daysFromNow(3) },
    genres: [],
    ...overrides,
  };
}

describe("bucketFor", () => {
  it("buckets by how soon the release lands", () => {
    expect(bucketFor({ precision: "date_only", date: daysFromNow(0) }, NOW)).toBe("TODAY");
    expect(bucketFor({ precision: "date_only", date: daysFromNow(3) }, NOW)).toBe("THIS_WEEK");
    expect(bucketFor({ precision: "date_only", date: daysFromNow(10) }, NOW)).toBe("NEXT_WEEK");
    expect(bucketFor({ precision: "date_only", date: daysFromNow(25) }, NOW)).toBe("THIS_MONTH");
    expect(bucketFor({ precision: "date_only", date: daysFromNow(200) }, NOW)).toBe("LATER");
  });

  it("drops titles that already released", () => {
    expect(bucketFor({ precision: "date_only", date: daysFromNow(-5) }, NOW)).toBeNull();
  });

  // The countdown engine's precision rule must hold here too: a vaguely
  // dated title must never be assigned a precise bucket it can't support.
  it("never puts an imprecise date into a precise bucket", () => {
    expect(bucketFor({ precision: "quarter", label: "Q4 2026" }, NOW)).toBe("LATER");
    expect(bucketFor({ precision: "unknown" }, NOW)).toBe("LATER");
  });
});

describe("buildReleaseRadar", () => {
  it("ranks followed above watchlisted above trending within a bucket", () => {
    const radar = buildReleaseRadar(
      [
        { title: title("movie:trending"), reasons: ["TRENDING"] },
        { title: title("movie:watchlisted"), reasons: ["WATCHLISTED"] },
        { title: title("movie:followed"), reasons: ["FOLLOWED"] },
      ],
      365,
      NOW,
    );
    expect(radar.buckets.THIS_WEEK.map((e) => e.title.id)).toEqual([
      "movie:followed",
      "movie:watchlisted",
      "movie:trending",
    ]);
  });

  // The Free horizon must be honest: entries it hides are reported rather
  // than silently dropped, so the UI can say more is coming without lying.
  it("reports truncation when the plan horizon hides entries", () => {
    const inputs = [
      { title: title("movie:soon"), reasons: ["FOLLOWED" as const] },
      {
        title: title("movie:far", { releaseWindow: { precision: "date_only", date: daysFromNow(120) } }),
        reasons: ["FOLLOWED" as const],
      },
    ];

    const free = buildReleaseRadar(inputs, 14, NOW);
    expect(free.truncatedByPlan).toBe(true);
    expect(free.totalEntries).toBe(1);

    const pro = buildReleaseRadar(inputs, 365, NOW);
    expect(pro.truncatedByPlan).toBe(false);
    expect(pro.totalEntries).toBe(2);
  });

  it("covers all three categories, not just movies", () => {
    const radar = buildReleaseRadar(
      [
        { title: title("movie:1", { mediaType: "movie" }), reasons: ["FOLLOWED"] },
        { title: title("tv:1", { mediaType: "tv" }), reasons: ["FOLLOWED"] },
        { title: title("game:1", { mediaType: "game" }), reasons: ["FOLLOWED"] },
      ],
      365,
      NOW,
    );
    expect(radar.buckets.THIS_WEEK.map((e) => e.mediaType).sort()).toEqual(["game", "movie", "tv"]);
  });

  it("does not list the same title twice", () => {
    const radar = buildReleaseRadar(
      [
        { title: title("movie:dup"), reasons: ["FOLLOWED"] },
        { title: title("movie:dup"), reasons: ["WATCHLISTED"] },
      ],
      365,
      NOW,
    );
    expect(radar.totalEntries).toBe(1);
  });
});

describe("mergeInputs", () => {
  it("combines reasons for a title that is both followed and watchlisted", () => {
    const merged = mergeInputs([
      [{ title: title("movie:1"), reasons: ["FOLLOWED"] }],
      [{ title: title("movie:1"), reasons: ["WATCHLISTED"] }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reasons.sort()).toEqual(["FOLLOWED", "WATCHLISTED"]);
  });
});
