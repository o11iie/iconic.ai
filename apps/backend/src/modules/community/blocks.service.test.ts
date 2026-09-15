import { describe, expect, it } from "vitest";
import { excludeBlockedAuthors } from "./blocks.service";

describe("excludeBlockedAuthors", () => {
  // The empty case matters: spreading `{ authorId: { notIn: [] } }` into a
  // Prisma where clause is a pointless filter on every anonymous read of
  // the community feed, which is the app's hottest query.
  it("adds no filter when the viewer has blocked nobody", () => {
    expect(excludeBlockedAuthors([])).toEqual({});
  });

  it("excludes every blocked author", () => {
    expect(excludeBlockedAuthors(["u1", "u2"])).toEqual({ authorId: { notIn: ["u1", "u2"] } });
  });
});
