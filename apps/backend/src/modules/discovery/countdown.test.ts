import { describe, expect, it } from "vitest";
import { computeCountdown, daysUntil } from "./countdown";

describe("computeCountdown", () => {
  it("never fabricates a numeric countdown for date-only precision", () => {
    const result = computeCountdown({ precision: "date_only", date: "2026-12-25" });
    expect(result.msRemaining).toBeNull();
    expect(result.hasReleased).toBe(false);
    expect(result.displayLabel).toContain("2026");
  });

  it("reports hasReleased for a past date-only release", () => {
    const result = computeCountdown({ precision: "date_only", date: "2020-01-01" });
    expect(result.hasReleased).toBe(true);
  });

  it("computes an exact ms countdown only when precision is exact_datetime", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = computeCountdown({ precision: "exact_datetime", date: future });
    expect(result.msRemaining).not.toBeNull();
    expect(result.msRemaining).toBeGreaterThan(0);
    expect(result.hasReleased).toBe(false);
  });

  it("falls back to a label for quarter/year precision without inventing a date", () => {
    expect(computeCountdown({ precision: "quarter", label: "Q4 2026" }).displayLabel).toBe("Q4 2026");
    expect(computeCountdown({ precision: "unknown" }).displayLabel).toBe("Release date TBA");
  });
});

describe("daysUntil", () => {
  it("returns null when precision doesn't support a day count", () => {
    expect(daysUntil({ precision: "year", label: "2027" })).toBeNull();
    expect(daysUntil({ precision: "unknown" })).toBeNull();
  });

  it("returns a positive integer for a future date-only release", () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const days = daysUntil({ precision: "date_only", date: future });
    expect(days).not.toBeNull();
    expect(days as number).toBeGreaterThanOrEqual(9);
    expect(days as number).toBeLessThanOrEqual(10);
  });
});
