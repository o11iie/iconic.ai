export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export type SpoilerSensitivity = "hide_all" | "hide_recent" | "show_all";

export interface UserPreferences {
  spoilerSensitivity: SpoilerSensitivity;
  notificationsEnabled: boolean;
  favoriteGenres: string[];
}

export interface AuthenticatedUser extends PublicUser {
  email: string;
  preferences: UserPreferences;
}
