import { getEnv, isIgdbConfigured } from "../../env";
import type { ReleaseWindow, TitleDetail, TitleSummary } from "@slate/shared";

const IGDB_BASE_URL = "https://api.igdb.com/v4";
const TWITCH_OAUTH_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";

export class IgdbNotConfiguredError extends Error {
  constructor() {
    super("TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET are not configured. Set them in apps/backend/.env to enable game data.");
  }
}

export class IgdbApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

// IGDB auth is Twitch's app-access-token client-credentials flow. Tokens are
// long-lived (~60 days) so we cache in-process and refresh lazily on 401.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!isIgdbConfigured()) throw new IgdbNotConfiguredError();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const env = getEnv();
  const url = new URL(TWITCH_OAUTH_URL);
  url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  url.searchParams.set("client_secret", env.TWITCH_CLIENT_SECRET);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new IgdbApiError(`Twitch OAuth failed: ${res.status}`, res.status);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

// IGDB uses a query language ("Apicalypse"), not query-string params.
// https://api-docs.igdb.com/#apicalypse-1
async function igdbQuery<T>(endpoint: string, body: string): Promise<T> {
  const env = getEnv();
  const token = await getAccessToken();
  const res = await fetch(`${IGDB_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) throw new IgdbApiError(`IGDB request failed: ${res.status} ${res.statusText}`, res.status);
  return res.json() as Promise<T>;
}

interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  cover?: { image_id: string };
  screenshots?: { image_id: string }[];
  first_release_date?: number; // unix seconds, UTC
  genres?: { id: number; name: string }[];
  platforms?: { name: string }[];
  rating?: number;
  involved_companies?: { company: { name: string }; developer: boolean }[];
  videos?: { video_id: string; name: string }[];
  release_dates?: { date: number; human: string; region: number }[];
}

function coverUrl(imageId: string | undefined, size: "cover_big" | "screenshot_big" = "cover_big"): string | undefined {
  return imageId ? `${IGDB_IMAGE_BASE}/t_${size}/${imageId}.jpg` : undefined;
}

function releaseWindowFrom(unixSeconds: number | undefined): ReleaseWindow {
  if (!unixSeconds) return { precision: "unknown" };
  // IGDB's first_release_date is a date (UTC midnight), not a real
  // storefront release time — never present it as an exact countdown time.
  return { precision: "date_only", date: new Date(unixSeconds * 1000).toISOString() };
}

function toSummary(game: IgdbGame): TitleSummary {
  return {
    id: `game:${game.id}`,
    mediaType: "game",
    name: game.name,
    posterUrl: coverUrl(game.cover?.image_id),
    backdropUrl: coverUrl(game.screenshots?.[0]?.image_id, "screenshot_big"),
    releaseWindow: releaseWindowFrom(game.first_release_date),
    genres: (game.genres ?? []).map((g) => ({ id: String(g.id), name: g.name })),
    voteAverage: game.rating ? game.rating / 10 : undefined,
  };
}

function toDetail(game: IgdbGame): TitleDetail {
  return {
    ...toSummary(game),
    overview: game.summary ?? "",
    externalIds: { igdbId: game.id },
    cast: [],
    trailers: (game.videos ?? []).map((v) => ({
      id: v.video_id,
      name: v.name,
      site: "YouTube" as const,
      key: v.video_id,
      official: true,
    })),
    platforms: (game.platforms ?? []).map((p) => p.name),
    attribution: {
      source: "igdb",
      notice: "Game data provided by IGDB.",
    },
  };
}

const GAME_FIELDS =
  "id,name,summary,cover.image_id,screenshots.image_id,first_release_date,genres.id,genres.name,platforms.name,rating,videos.video_id,videos.name";

export async function upcomingGames(limit = 20): Promise<TitleSummary[]> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const body = `fields ${GAME_FIELDS}; where first_release_date > ${nowUnix} & hypes > 0; sort hypes desc; limit ${limit};`;
  const games = await igdbQuery<IgdbGame[]>("games", body);
  return games.map(toSummary);
}

export async function anticipatedGames(limit = 20): Promise<TitleSummary[]> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const body = `fields ${GAME_FIELDS}; where first_release_date > ${nowUnix}; sort hypes desc; limit ${limit};`;
  const games = await igdbQuery<IgdbGame[]>("games", body);
  return games.map(toSummary);
}

export async function searchGames(query: string, limit = 20): Promise<TitleSummary[]> {
  const sanitized = query.replace(/"/g, "");
  const body = `search "${sanitized}"; fields ${GAME_FIELDS}; limit ${limit};`;
  const games = await igdbQuery<IgdbGame[]>("games", body);
  return games.map(toSummary);
}

export async function getGameDetail(id: string): Promise<TitleDetail> {
  const body = `fields ${GAME_FIELDS}; where id = ${Number(id)};`;
  const games = await igdbQuery<IgdbGame[]>("games", body);
  if (games.length === 0) throw new IgdbApiError("Game not found", 404);
  return toDetail(games[0]);
}
