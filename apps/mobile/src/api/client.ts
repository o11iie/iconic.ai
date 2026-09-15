import type { PaywallTrigger } from "@slate/shared";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/** Local emulator loopback. Only ever used in development builds. */
const DEV_FALLBACK_API_URL = "http://10.0.2.2:4000/api";

/**
 * Resolved at build time from EXPO_PUBLIC_API_BASE_URL (set per EAS build
 * profile — see eas.json), falling back to the app config, then to the local
 * emulator in development only.
 *
 * A release build MUST point at an HTTPS origin: Android blocks cleartext
 * HTTP by default on API 28+, and shipping a plaintext API would expose
 * users' access tokens on the wire. We fail loudly at startup rather than
 * silently shipping a build that talks to a dev address or over HTTP.
 */
function resolveApiBaseUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_API_BASE_URL ?? (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined);

  if (!__DEV__) {
    if (!configured) {
      throw new Error("EXPO_PUBLIC_API_BASE_URL must be set for release builds.");
    }
    if (!configured.startsWith("https://")) {
      throw new Error("Slate release builds require an HTTPS API base URL.");
    }
    return configured;
  }

  return configured ?? DEV_FALLBACK_API_URL;
}

const API_BASE_URL = resolveApiBaseUrl();

const ACCESS_TOKEN_KEY = "slate.accessToken";
const REFRESH_TOKEN_KEY = "slate.refreshToken";

export async function getTokens() {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return { accessToken, refreshToken };
}

export async function setTokens(accessToken: string, refreshToken: string) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearTokens() {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    /** Set on PRO_REQUIRED responses so the paywall can lead with the right benefit. */
    public trigger?: PaywallTrigger,
  ) {
    super(message);
  }
}

/**
 * Thin fetch wrapper: attaches the access token, and on a single 401
 * transparently refreshes via /auth/refresh and retries once. Every AI
 * provider key, Play Billing credential, etc. stays server-side — this
 * client only ever calls Slate's own backend.
 */
async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const { accessToken } = await getTokens();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      // Only when there is a body. Fastify rejects a bodyless request that
      // declares `Content-Type: application/json` with 400 "Body cannot be
      // empty", which would break every DELETE the app makes.
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? "Request failed", res.status, body.code, body.trigger);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    await setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
