import { prisma } from "../../prisma";
import { getPlan } from "../billing/plan.service";

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Daily Ask Slate allowance for this user, from the central plan config. */
export async function getDailyLimit(userId: string): Promise<number> {
  const { limits } = await getPlan(userId);
  return limits.dailyAiMessages;
}

export async function getUsedToday(userId: string): Promise<number> {
  const record = await prisma.aiUsageEvent.findUnique({ where: { userId_date: { userId, date: todayUtc() } } });
  return record?.count ?? 0;
}

export async function incrementUsage(userId: string): Promise<void> {
  const date = todayUtc();
  await prisma.aiUsageEvent.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export class AiRateLimitError extends Error {
  constructor(public limit: number) {
    super(`Daily Ask Slate limit of ${limit} reached.`);
  }
}

export async function assertWithinLimit(userId: string): Promise<{ limit: number; used: number }> {
  const [limit, used] = await Promise.all([getDailyLimit(userId), getUsedToday(userId)]);
  if (used >= limit) throw new AiRateLimitError(limit);
  return { limit, used };
}
