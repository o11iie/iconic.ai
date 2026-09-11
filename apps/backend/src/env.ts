import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  TMDB_API_KEY: z.string().optional().default(""),
  TWITCH_CLIENT_ID: z.string().optional().default(""),
  TWITCH_CLIENT_SECRET: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-4o-mini"),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional().default("ai.iconic.slate"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional().default(""),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lazily validated so unit tests can set process.env before first access. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isTmdbConfigured(): boolean {
  return getEnv().TMDB_API_KEY.length > 0;
}

export function isIgdbConfigured(): boolean {
  return getEnv().TWITCH_CLIENT_ID.length > 0 && getEnv().TWITCH_CLIENT_SECRET.length > 0;
}

export function isAiConfigured(): boolean {
  return getEnv().OPENAI_API_KEY.length > 0;
}

export function isPlayBillingConfigured(): boolean {
  return getEnv().GOOGLE_SERVICE_ACCOUNT_JSON.length > 0;
}
