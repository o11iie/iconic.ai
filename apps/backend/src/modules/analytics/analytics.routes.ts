import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma";
import { ANALYTICS_RATE_LIMIT } from "../../plugins/rate-limits";

/**
 * First-party analytics ingest. Events are attributed to a user when the
 * request carries a valid access token and stay anonymous otherwise, so
 * pre-signup funnel events (app_open, paywall_view) are still measurable.
 *
 * Properties are stored as JSON rather than columns so adding an event
 * doesn't need a migration. Never put PII or secrets in `properties` —
 * this table is read by admin tooling.
 */
const eventSchema = z.object({
  name: z.string().min(1).max(64),
  properties: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  /** Client-side timestamp, ISO-8601. Ignored for storage ordering but kept for offline-queued events. */
  occurredAt: z.string().datetime().optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

export async function analyticsRoutes(app: FastifyInstance) {
  app.post("/analytics/events", { config: { rateLimit: ANALYTICS_RATE_LIMIT } }, async (req, reply) => {
    const body = batchSchema.parse(req.body);

    // Attribution is best-effort: a missing/expired token means an
    // anonymous event, not a rejected request.
    let userId: string | null = null;
    try {
      const payload = await req.jwtVerify<{ sub: string }>();
      userId = payload.sub;
    } catch {
      userId = null;
    }

    await prisma.analyticsEvent.createMany({
      data: body.events.map((e) => ({
        userId,
        name: e.name,
        properties: {
          ...(e.properties ?? {}),
          ...(e.occurredAt ? { clientOccurredAt: e.occurredAt } : {}),
        },
      })),
    });

    return reply.code(202).send({ accepted: body.events.length });
  });
}
