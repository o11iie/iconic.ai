export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

// Matches the backend's Prisma SpoilerSensitivity enum values exactly — see
// apps/backend/prisma/schema.prisma. Kept in sync manually since Prisma's
// generated client type isn't importable from the mobile app.
export type SpoilerSensitivity = "HIDE_ALL" | "HIDE_RECENT" | "SHOW_ALL";

export type NotificationType =
  | "RELEASE_REMINDER"
  | "FOLLOWED_TITLE_UPDATE"
  | "COMMUNITY_REPLY"
  | "COMMUNITY_MENTION"
  | "SUBSCRIPTION_STATUS";

export interface SlateNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface UserPreferences {
  spoilerSensitivity: SpoilerSensitivity;
  notificationsEnabled: boolean;
  favoriteGenres: string[];
  /** Per-type opt-outs. Empty means all types are on (subject to notificationsEnabled). */
  mutedNotificationTypes: NotificationType[];
}

export interface AuthenticatedUser extends PublicUser {
  email: string;
  preferences: UserPreferences;
}
