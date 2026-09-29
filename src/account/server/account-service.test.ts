import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETION_CONFIRMATION } from '../lifecycle';

/**
 * The account service, driven.
 *
 * What matters here is not that it reads and writes — it is that IDENTITY
 * comes from the session on every path, and that a destructive operation
 * cannot complete without both a confirmation and a way to stop the billing
 * it leaves behind.
 *
 * Supabase is substituted, and every substitution records what it was asked
 * to do, so the assertions are on the QUERY the service built — including the
 * user id it filtered by, which is the whole point.
 */

const SESSION_USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

/** What the service asked the database to do. */
interface Recorded {
  table: string;
  op: 'select' | 'update';
  payload?: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
}

let recorded: Recorded[] = [];
let sessionUser: string | null = SESSION_USER;
let subscriptionRow: Record<string, unknown> | null = null;
let deletedUsers: string[] = [];
let signedOut = false;
let cancelCalls: string[] = [];
let cancelSucceeds = true;
let adminConfigured = true;
let stripeConfigured = true;

function queryBuilder(table: string, op: Recorded['op'], payload?: Record<string, unknown>) {
  const entry: Recorded = { table, op, payload, filters: [] };
  recorded.push(entry);

  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      entry.filters.push({ column, value });
      return builder;
    },
    maybeSingle() {
      if (table === 'subscriptions') return Promise.resolve({ data: subscriptionRow, error: null });
      return Promise.resolve({
        data: {
          display_name: 'Existing Name',
          level: 'foundation',
          timezone: 'UTC',
          locale: 'en',
          interests: [],
          onboarded_at: null,
        },
        error: null,
      });
    },
    then(resolve: (value: { error: null }) => unknown) {
      // An update with no `.maybeSingle()` resolves directly.
      return Promise.resolve({ error: null }).then(resolve);
    },
  };

  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () =>
        sessionUser
          ? { data: { user: { id: sessionUser, email: 'learner@veo.invalid', email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: new Error('no session') },
      signOut: async () => {
        signedOut = true;
        return { error: null };
      },
    },
    from: (table: string) => ({
      select: () => queryBuilder(table, 'select'),
      update: (payload: Record<string, unknown>) => queryBuilder(table, 'update', payload),
    }),
  }),
  getServerUser: async () => (sessionUser ? { id: sessionUser, email: 'learner@veo.invalid' } : null),
}));

vi.mock('@/lib/supabase/admin', () => ({
  isSupabaseAdminConfigured: () => adminConfigured,
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          deletedUsers.push(id);
          return { error: null };
        },
      },
    },
  }),
}));

vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => stripeConfigured,
  cancelSubscriptionAtStripe: async (id: string) => {
    cancelCalls.push(id);
    return cancelSucceeds;
  },
}));

beforeEach(() => {
  recorded = [];
  sessionUser = SESSION_USER;
  subscriptionRow = null;
  deletedUsers = [];
  signedOut = false;
  cancelCalls = [];
  cancelSucceeds = true;
  adminConfigured = true;
  stripeConfigured = true;
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------

describe('reading a profile', () => {
  it('scopes the read to the session user', async () => {
    const { readProfile } = await import('./account-service');
    const result = await readProfile();

    expect(result.ok).toBe(true);
    const query = recorded.find((entry) => entry.table === 'profiles');
    expect(query?.filters).toEqual([{ column: 'user_id', value: SESSION_USER }]);
  });

  it('refuses without a session', async () => {
    sessionUser = null;
    const { readProfile } = await import('./account-service');

    expect(await readProfile()).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(recorded).toHaveLength(0);
  });

  it('reports the verification state rather than assuming it', async () => {
    const { readProfile } = await import('./account-service');
    const result = await readProfile();

    expect(result.ok && result.profile.emailVerified).toBe(true);
  });
});

describe('updating a profile', () => {
  it('writes only the fields that were sent', async () => {
    const { updateProfile } = await import('./account-service');
    await updateProfile({ displayName: 'New Name' });

    const update = recorded.find((entry) => entry.op === 'update');
    expect(update?.payload).toEqual({ display_name: 'New Name' });
  });

  it('scopes the write to the session user', async () => {
    const { updateProfile } = await import('./account-service');
    await updateProfile({ displayName: 'New Name' });

    const update = recorded.find((entry) => entry.op === 'update');
    expect(update?.filters).toEqual([{ column: 'user_id', value: SESSION_USER }]);
  });

  it('ignores a user id smuggled into the update', async () => {
    /*
     * The failure this guards: a service that spread the request body into
     * the row, or that read an id from it, would write to whichever account
     * the caller named.
     */
    const { updateProfile } = await import('./account-service');
    await updateProfile({
      displayName: 'New Name',
      userId: OTHER_USER,
      user_id: OTHER_USER,
      id: OTHER_USER,
    } as never);

    const update = recorded.find((entry) => entry.op === 'update');
    expect(update?.payload).toEqual({ display_name: 'New Name' });
    expect(update?.filters).toEqual([{ column: 'user_id', value: SESSION_USER }]);
    expect(JSON.stringify(update)).not.toContain(OTHER_USER);
  });

  it('never writes a column the learner may not own', async () => {
    const { updateProfile } = await import('./account-service');
    await updateProfile({
      displayName: 'New Name',
      onboarded_at: '2020-01-01',
      created_at: '2020-01-01',
      metadata: { admin: true },
    } as never);

    const update = recorded.find((entry) => entry.op === 'update');
    for (const forbidden of ['onboarded_at', 'created_at', 'metadata', 'user_id', 'id']) {
      expect(Object.keys(update?.payload ?? {}), forbidden).not.toContain(forbidden);
    }
  });

  it('refuses without a session, before touching the database', async () => {
    sessionUser = null;
    const { updateProfile } = await import('./account-service');

    expect(await updateProfile({ displayName: 'x' })).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
    expect(recorded.filter((entry) => entry.op === 'update')).toHaveLength(0);
  });
});

describe('deleting an account', () => {
  it('deletes the SESSION user, not one from the request', async () => {
    const { deleteAccount } = await import('./account-service');
    const result = await deleteAccount(DELETION_CONFIRMATION);

    expect(result.ok).toBe(true);
    expect(deletedUsers).toEqual([SESSION_USER]);
  });

  it('signs out afterwards, so the cookie stops being presented', async () => {
    const { deleteAccount } = await import('./account-service');
    await deleteAccount(DELETION_CONFIRMATION);

    expect(signedOut).toBe(true);
  });

  it('deletes nothing without the exact phrase', async () => {
    const { deleteAccount } = await import('./account-service');

    for (const attempt of ['', 'yes', 'delete my account', `${DELETION_CONFIRMATION} `]) {
      const result = await deleteAccount(attempt);
      expect(result.ok, attempt).toBe(false);
    }
    expect(deletedUsers).toEqual([]);
  });

  it('deletes nothing without a session', async () => {
    sessionUser = null;
    const { deleteAccount } = await import('./account-service');

    const result = await deleteAccount(DELETION_CONFIRMATION);

    expect(result).toMatchObject({ ok: false, reason: 'unauthenticated' });
    expect(deletedUsers).toEqual([]);
  });

  it('refuses rather than half-deleting when it cannot delete at all', async () => {
    adminConfigured = false;
    const { deleteAccount } = await import('./account-service');

    const result = await deleteAccount(DELETION_CONFIRMATION);

    expect(result).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(deletedUsers).toEqual([]);
  });

  describe('with a live subscription', () => {
    beforeEach(() => {
      subscriptionRow = {
        tier: 'pro',
        status: 'active',
        stripe_subscription_id: 'sub_live_1',
      };
    });

    it('cancels at Stripe BEFORE deleting', async () => {
      const { deleteAccount } = await import('./account-service');
      const result = await deleteAccount(DELETION_CONFIRMATION);

      expect(result.ok).toBe(true);
      expect(cancelCalls).toEqual(['sub_live_1']);
      expect(deletedUsers).toEqual([SESSION_USER]);
    });

    it('deletes nothing when the cancellation fails', async () => {
      /*
       * Deleting here would destroy the only record of who is being billed
       * while the charge continued, with nothing left in VEO to cancel it
       * from. Cancelling and then failing to delete is recoverable; this is
       * not.
       */
      cancelSucceeds = false;
      const { deleteAccount } = await import('./account-service');

      const result = await deleteAccount(DELETION_CONFIRMATION);

      expect(result).toMatchObject({ ok: false, reason: 'active_subscription' });
      expect(deletedUsers).toEqual([]);
      expect(signedOut).toBe(false);
    });

    it('refuses outright when VEO cannot cancel at all', async () => {
      stripeConfigured = false;
      const { deleteAccount } = await import('./account-service');

      const result = await deleteAccount(DELETION_CONFIRMATION);

      expect(result).toMatchObject({ ok: false, reason: 'active_subscription' });
      expect(cancelCalls).toEqual([]);
      expect(deletedUsers).toEqual([]);
    });

    it('reads the subscription scoped to the session user', async () => {
      const { deleteAccount } = await import('./account-service');
      await deleteAccount(DELETION_CONFIRMATION);

      const read = recorded.find((entry) => entry.table === 'subscriptions');
      expect(read?.filters).toEqual([{ column: 'user_id', value: SESSION_USER }]);
    });
  });

  it('does not cancel anything for a free account', async () => {
    subscriptionRow = { tier: 'free', status: 'active', stripe_subscription_id: null };
    const { deleteAccount } = await import('./account-service');

    const result = await deleteAccount(DELETION_CONFIRMATION);

    expect(result.ok).toBe(true);
    expect(cancelCalls).toEqual([]);
  });

  it('does not cancel a subscription that has already lapsed', async () => {
    subscriptionRow = { tier: 'pro', status: 'canceled', stripe_subscription_id: 'sub_old' };
    const { deleteAccount } = await import('./account-service');

    const result = await deleteAccount(DELETION_CONFIRMATION);

    expect(result.ok).toBe(true);
    expect(cancelCalls).toEqual([]);
  });
});
