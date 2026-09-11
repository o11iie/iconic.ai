import type { MediaType } from "@slate/shared";
import type { MediaType as PrismaMediaType } from "@prisma/client";

export function toPrismaMediaType(mediaType: MediaType): PrismaMediaType {
  return mediaType.toUpperCase() as PrismaMediaType;
}

export function fromPrismaMediaType(mediaType: PrismaMediaType): MediaType {
  return mediaType.toLowerCase() as MediaType;
}
