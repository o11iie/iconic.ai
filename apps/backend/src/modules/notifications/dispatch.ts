import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../prisma";

/**
 * The single place notifications are created. Every caller goes through
 * here so preference checks can't be forgotten at an individual call site —
 * a user who muted a type must never receive it, regardless of which
 * feature triggered it.
 *
 * Returns true if a notification was actually created.
 */
export async function dispatchNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { notificationsEnabled: true, mutedNotificationTypes: true },
  });
  if (!user) return false;
  if (!user.notificationsEnabled) return false;
  if (user.mutedNotificationTypes.includes(params.type)) return false;

  await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data,
    },
  });
  return true;
}
