import { describe, expect, it } from "vitest";
import { canModerate } from "./authorization";

describe("canModerate", () => {
  it("lets an author delete their own content", () => {
    expect(canModerate("user-1", "USER", "user-1")).toBe(true);
  });

  it("refuses a regular user deleting someone else's content", () => {
    expect(canModerate("user-1", "USER", "user-2")).toBe(false);
  });

  it("lets moderators and admins delete anyone's content", () => {
    expect(canModerate("mod-1", "MODERATOR", "user-2")).toBe(true);
    expect(canModerate("admin-1", "ADMIN", "user-2")).toBe(true);
  });

  // The reason this is an allowlist rather than `role !== "USER"`: a missing
  // or unexpected role must fail closed, not grant moderator powers.
  it("fails closed on a missing or unrecognized role", () => {
    expect(canModerate("user-1", undefined, "user-2")).toBe(false);
    expect(canModerate("user-1", "SUPERUSER", "user-2")).toBe(false);
    expect(canModerate("user-1", "", "user-2")).toBe(false);
  });

  it("does not treat an empty requesting user id as matching an empty author id", () => {
    expect(canModerate("", "USER", "")).toBe(false);
  });
});
