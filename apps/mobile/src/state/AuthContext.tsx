import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthenticatedUser, UserPreferences } from "@slate/shared";
import { api, clearTokens, getTokens, setTokens } from "../api/client";
import { track } from "../analytics/analytics";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, handle: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthResponse {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { accessToken } = await getTokens();
      if (accessToken) {
        try {
          const res = await api.get<{ user: AuthenticatedUser }>("/auth/me");
          setUser(res.user);
        } catch {
          await clearTokens();
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<AuthResponse>("/auth/login", { email, password });
    await setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    track("login");
  }, []);

  const signup = useCallback(async (email: string, password: string, handle: string, displayName: string) => {
    const res = await api.post<AuthResponse>("/auth/signup", { email, password, handle, displayName });
    await setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    track("signup");
  }, []);

  const logout = useCallback(async () => {
    const { refreshToken } = await getTokens();
    if (refreshToken) await api.post("/auth/logout", { refreshToken }).catch(() => undefined);
    await clearTokens();
    setUser(null);
  }, []);

  const updatePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    const res = await api.patch<{ preferences: UserPreferences }>("/users/me/preferences", patch);
    setUser((prev) => (prev ? { ...prev, preferences: res.preferences } : prev));
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout, updatePreferences }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
