import type { FastifyInstance } from "fastify";
import { MOVIE_GENRES, TV_GENRES } from "../tmdb/tmdb.client";
import { IGDB_GENRES } from "../igdb/igdb.client";

/**
 * A deduped (by name, case-insensitive), cross-provider genre list for the
 * mobile genre picker. Personalization matches on genre NAME rather than
 * provider-specific numeric ids, since TMDB and IGDB each have their own id
 * space — this is the one list both can be compared against.
 */
function buildGenreList(): string[] {
  const names = new Set<string>();
  for (const dict of [MOVIE_GENRES, TV_GENRES, IGDB_GENRES]) {
    for (const name of Object.values(dict)) names.add(name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

const GENRE_LIST = buildGenreList();

export async function genresRoutes(app: FastifyInstance) {
  app.get("/genres", async (_req, reply) => {
    return reply.send({ genres: GENRE_LIST });
  });
}
