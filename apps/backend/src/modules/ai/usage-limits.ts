import { prisma } from "../../prisma";

export const FREE_DAILY_AI_LIMIT = 5;
export const PRO_DAILY_AI_LIMIT = 100; // configurable ceiling, not truly "unlimited", to bound cost/abuse

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getDailyLimit(userId: string): Promise<number> {
  const entitlement = await prisma.entitlement.findUnique({ where: { userId } });
  const isPro = entitlement?.status === "ACTIVE" || entitlement?.status === "GRACE_PERIOD";
  return isPro ? PRO_DAILY_AI_LIMIT : FREE_DAILY_AI_LIMIT;
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
