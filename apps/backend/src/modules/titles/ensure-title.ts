import { prisma } from "../../prisma";
import { toPrismaMediaType } from "../../lib/media-type";
import * as tmdb from "../tmdb/tmdb.client";
import * as igdb from "../igdb/igdb.client";
import type { MediaType } from "@slate/shared";

/**
 * Watchlist/Follow rows need a local `Title` row to hang a foreign key off.
 * This upserts a minimal cached pointer (id, name, releaseDate) the first
 * time a user interacts with a title Slate hasn't seen yet — never a full
 * metadata copy, since TMDB/IGDB remain the source of truth for content.
 */
export async function ensureTitleExists(titleId: string): Promise<void> {
  const existing = await prisma.title.findUnique({ where: { id: titleId } });
  if (existing) return;

  const [prefix, externalId] = titleId.split(":");
  const mediaType = prefix as MediaType;

  const detail =
    mediaType === "game" ? await igdb.getGameDetail(externalId) : await tmdb.getDetail(mediaType, externalId);

  await prisma.title.upsert({
    where: { id: titleId },
    create: {
      id: titleId,
      mediaType: toPrismaMediaType(mediaType),
      externalId,
      name: detail.name,
      releaseDate: detail.releaseWindow.date ? new Date(detail.releaseWindow.date) : null,
      releaseDatePrecision: detail.releaseWindow.precision,
    },
    update: {},
  });
}
