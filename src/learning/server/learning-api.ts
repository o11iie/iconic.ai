import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REVIEW_RATINGS } from '../scheduler';
import { GOAL_BOUNDS } from '../streaks';
import { StoreError, type StoreErrorCode } from '../store';
import { resolveLearning, type ResolvedLearning } from './resolve-store';

/**
 * The shared body of every learning route.
 *
 * ## The boundary
 *
 * Each handler receives an ALREADY-RESOLVED learner. There is no code path in
 * which a route reads an id from a body and passes it to the store, because
 * routes never see an id they could pass. Identity is resolved once, here,
 * from a JWT validated against Supabase Auth.
 *
 * ## Time
 *
 * `now` is minted here, on the server, and handed to the store. No route
 * accepts a timestamp from a request. A client that could set the review
 * instant could set an interval to anything it liked by claiming the review
 * happened a year ago, and nothing downstream would be able to tell.
 */

const ERROR_STATUS: Record<StoreErrorCode, number> = {
  not_configured: 503,
  unknown_item: 404,
  unknown_session: 404,
  conflict: 409,
  unavailable: 503,
};

const MESSAGES = {
  unauthenticated: 'Sign in to review.',
  not_configured: 'Learning memory is not configured in this deployment.',
  invalid_request: 'That request was not something VEO could act on.',
  unexpected: 'VEO could not complete that just now.',
} as const;

export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/**
 * Run a handler with a resolved learner, or refuse.
 *
 * Every failure mode returns a code the UI can branch on and a message safe to
 * show. A raw store or database error is never forwarded: it can name tables,
 * columns and constraint names, which is free reconnaissance.
 */
export async function withLearner<T>(
  handler: (resolved: Extract<ResolvedLearning, { ok: true }>, now: Date) => Promise<T>,
): Promise<NextResponse> {
  const resolved = await resolveLearning();

  if (!resolved.ok) {
    return resolved.reason === 'unauthenticated'
      ? fail(401, 'unauthenticated', MESSAGES.unauthenticated)
      : fail(503, 'not_configured', MESSAGES.not_configured);
  }

  try {
    // SERVER time. The single source of "when", for every route.
    const payload = await handler(resolved, new Date());
    return NextResponse.json({
      ok: true,
      ...(resolved.ephemeral ? { ephemeral: true } : {}),
      ...(payload as object),
    });
  } catch (error) {
    if (error instanceof StoreError) {
      return fail(ERROR_STATUS[error.code], error.code, error.message);
    }

    // Logged for operators, never returned.
    console.error('[learning] unexpected failure', error);
    return fail(500, 'unexpected', MESSAGES.unexpected);
  }
}

/** Parse a JSON body against a schema, or return a 400. */
export async function readBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail(400, 'invalid_request', MESSAGES.invalid_request) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: fail(400, 'invalid_request', MESSAGES.invalid_request) };
  }

  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// Schemas
//
// Note what is ABSENT from every one of these: userId, and any timestamp.
// Those are not optional fields the server overrides — they are fields a
// client cannot express, so there is nothing to forget to ignore.
// ---------------------------------------------------------------------------

const uuidish = z.string().trim().min(1).max(64);

export const submitReviewSchema = z
  .object({
    itemId: uuidish,
    rating: z.enum(REVIEW_RATINGS),
    correct: z.boolean().nullable().default(null),
    /** Measured by the client for reporting only; never used to schedule. */
    responseMs: z.number().int().min(0).max(3_600_000).catch(0),
    sessionId: uuidish.nullable().default(null),
    /** One per answer, minted by the client. Retries reuse it. */
    idempotencyKey: z.string().trim().min(8).max(128),
    /** IANA zone, for the local activity date only. */
    timeZone: z.string().trim().max(64).default('UTC'),
  })
  .strict();

export const startSessionSchema = z
  .object({
    itemIds: z.array(uuidish).max(200).default([]),
  })
  .strict();

export const endSessionSchema = z
  .object({
    sessionId: uuidish,
    status: z.enum(['completed', 'abandoned']),
  })
  .strict();

export const enrolSchema = z
  .object({
    contentRef: z.string().trim().min(1).max(200),
    contentType: z.enum(['question', 'flashcard']),
    semanticId: z.string().trim().max(200).nullable().default(null),
    modelRef: z.string().trim().max(200).nullable().default(null),
    payload: z.record(z.string(), z.unknown()).default({}),
    objective: z.string().trim().max(40).nullable().default(null),
    difficulty: z.enum(['easy', 'medium', 'hard']).nullable().default(null),
  })
  .strict();

export const goalSchema = z
  .object({
    target: z.number().int().min(GOAL_BOUNDS.min).max(GOAL_BOUNDS.max),
    timeZone: z.string().trim().max(64).default('UTC'),
  })
  .strict();
