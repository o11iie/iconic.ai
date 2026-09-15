import { prisma } from "../../prisma";
import { daysUntil } from "../discovery/countdown";
import { dispatchNotification } from "./dispatch";

/**
 * Generates release-reminder notifications for titles users follow.
 *
 * Idempotency matters more than cleverness here: this sweep is expected to
 * run repeatedly (a cron/scheduler hitting the admin sweep endpoint), and a
 * user must never get "releases tomorrow" twice. Before inserting, we check
 * for an existing RELEASE_REMINDER for the same user+title+milestone, using
 * the milestone recorded in `data`.
 */

/** Days-before-release at which a reminder fires. Pro users additionally get the 30-day heads-up. */
const FREE_MILESTONES = [0, 1, 7];
const PRO_MILESTONES = [0, 1, 7, 30];

function milestoneCopy(titleName: string, days: number): { title: string; body: string } {
  if (days === 0) return { title: `${titleName} is out today`, body: "It's release day. Go enjoy it." };
  if (days === 1) return { title: `${titleName} releases tomorrow`, body: "One more sleep." };
  return { title: `${days} days until ${titleName}`, body: "Your countdown is getting close." };
}

export interface SweepResult {
  followsScanned: number;
  notificationsCreated: number;
}

export async function runReleaseAlertSweep(now: Date = new Date()): Promise<SweepResult> {
  const follows = await prisma.follow.findMany({
    where: {
      title: { releaseDate: { not: null, gte: startOfDay(now) } },
      user: { notificationsEnabled: true },
    },
    include: { title: true, user: { include: { entitlement: true } } },
  });

  let notificationsCreated = 0;

  for (const follow of follows) {
    const { title, user } = follow;
    if (!title.releaseDate) continue;

    // Honor the same precision rule the countdown engine uses — a title
    // whose release date Slate only knows vaguely must not produce a
    // confident "releases tomorrow" alert.
    if (title.releaseDatePrecision !== "date_only" && title.releaseDatePrecision !== "exact_datetime") continue;

    const days = daysUntil(
      { precision: title.releaseDatePrecision as "date_only" | "exact_datetime", date: title.releaseDate.toISOString() },
      now,
    );
    if (days === null) continue;

    const isPro = user.entitlement?.status === "ACTIVE" || user.entitlement?.status === "GRACE_PERIOD";
    const milestones = isPro ? PRO_MILESTONES : FREE_MILESTONES;
    if (!milestones.includes(days)) continue;

    const alreadySent = await prisma.notification.findFirst({
      where: {
        userId: user.id,
        type: "RELEASE_REMINDER",
        data: { path: ["titleId"], equals: title.id },
        AND: [{ data: { path: ["milestoneDays"], equals: days } }],
      },
    });
    if (alreadySent) continue;

    const copy = milestoneCopy(title.name, days);
    const created = await dispatchNotification({
      userId: user.id,
      type: "RELEASE_REMINDER",
      title: copy.title,
      body: copy.body,
      data: { titleId: title.id, milestoneDays: days },
    });
    if (created) notificationsCreated += 1;
  }

  return { followsScanned: follows.length, notificationsCreated };
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
