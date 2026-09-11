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

export interface UserPreferences {
  spoilerSensitivity: SpoilerSensitivity;
  notificationsEnabled: boolean;
  favoriteGenres: string[];
}

export interface AuthenticatedUser extends PublicUser {
  email: string;
  preferences: UserPreferences;
}
