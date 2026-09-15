import type { UserRole } from "@prisma/client";

/**
 * Who may delete a piece of community content: its author, or a moderator.
 *
 * Written as an explicit allowlist rather than "deny if role === USER".
 * The negative form silently grants access if `role` is ever undefined or
 * an unrecognized value — an allowlist fails closed instead.
 */
const MODERATOR_ROLES: ReadonlySet<string> = new Set<UserRole>(["MODERATOR", "ADMIN"]);

export function canModerate(
  requestingUserId: string,
  requestingUserRole: string | undefined,
  contentAuthorId: string,
): boolean {
  if (requestingUserId && requestingUserId === contentAuthorId) return true;
  return requestingUserRole !== undefined && MODERATOR_ROLES.has(requestingUserRole);
}
