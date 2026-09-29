import { NextResponse } from 'next/server';
import {
  deleteAccount,
  profileUpdateSchema,
  readProfile,
  updateProfile,
  type ProfileResult,
} from '@/account/server/account-service';
import { DELETION_STATUS } from '@/account/lifecycle';
import { correlationId, serverLog, withRequestId } from '@/observability/log';
import { rateLimit } from '@/security/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * The learner's own account.
 *
 * GET reads their profile, PATCH changes it, DELETE destroys it. All three
 * resolve identity from the Supabase session — none accepts a user id, so
 * none can be pointed at somebody else's account.
 *
 * Errors are structured and say only what a learner can act on. A Supabase or
 * Stripe message is logged, never returned: those carry table names, column
 * names, constraint names and occasionally a key prefix.
 */

type ProfileFailure = 'unauthenticated' | 'not_configured' | 'unavailable';

/*
 * 503 for `unavailable`, not 500.
 *
 * A database VEO cannot reach is a dependency being down, not a defect in
 * VEO. 500 would tell a learner their account is broken when it is fine, and
 * send an operator looking in the application instead of at the database. The
 * learning and analytics routes answer the same way for the same cause.
 */
const PROFILE_STATUS: Record<ProfileFailure, number> = {
  unauthenticated: 401,
  not_configured: 503,
  unavailable: 503,
};

const PROFILE_MESSAGES: Record<ProfileFailure, string> = {
  unauthenticated: 'Sign in to see your account.',
  not_configured: 'Accounts are not configured in this deployment.',
  unavailable: 'VEO could not reach your account just now. Nothing has been changed.',
};

function respond(result: ProfileResult): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true, profile: result.profile });

  return NextResponse.json(
    { ok: false, error: { code: result.reason, message: PROFILE_MESSAGES[result.reason] } },
    { status: PROFILE_STATUS[result.reason] },
  );
}

export async function GET(request: Request) {
  return withRequestId(correlationId(request), async () => respond(await readProfile()));
}

export async function PATCH(request: Request) {
  return withRequestId(correlationId(request), async () => {
    /*
     * Rate limited as ABUSE control, not as a product allowance. Editing a
     * profile is free and unmetered; what this stops is somebody hammering
     * the endpoint. Gate 14's quotas remain the only thing that counts what a
     * plan includes — see `src/security/rate-limit.ts`.
     */
    const limited = await rateLimit(request, 'account.update');
    if (limited) return limited;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'invalid_request', message: 'Send a JSON body.' } },
        { status: 400 },
      );
    }

    const parsed = profileUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      // The field name is useful and safe; the received value is not echoed.
      const field = parsed.error.issues[0]?.path.join('.') ?? 'body';
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'invalid_request', message: `That is not a valid ${field}.` },
        },
        { status: 400 },
      );
    }

    return respond(await updateProfile(parsed.data));
  });
}

export async function DELETE(request: Request) {
  return withRequestId(correlationId(request), async () => {
    const limited = await rateLimit(request, 'account.delete');
    if (limited) return limited;

    let confirmation = '';
    try {
      const body = (await request.json()) as { confirm?: unknown };
      confirmation = typeof body.confirm === 'string' ? body.confirm : '';
    } catch {
      // An unparseable body is simply an unconfirmed deletion. Falling through
      // rather than returning 400 keeps one answer for "you did not confirm",
      // so the endpoint cannot be probed for whether a session is valid by
      // comparing statuses.
    }

    const result = await deleteAccount(confirmation);

    if (result.ok) {
      serverLog('info', 'account.deleted_via_api', {});
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: { code: result.reason, message: result.message } },
      { status: DELETION_STATUS[result.reason] },
    );
  });
}
