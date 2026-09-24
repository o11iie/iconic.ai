import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Entitlement } from '@/types/domain/billing';
import { resolveEntitlements } from '@/lib/stripe/entitlements';
import { consume, type ResolvedAccess } from './entitlements';

/**
 * The real `consume`, against a stubbed database.
 *
 * Deliberately NOT mocked here. The security tests beside this file mock
 * `consume` to check what the gate does with its answer; that left the
 * function's own failure handling untested, and a mutation making a broken
 * counter grant free usage went undetected. This exercises the function
 * itself.
 */

function access(overrides: Partial<ResolvedAccess> = {}): ResolvedAccess {
  return {
    userId: 'alice' as ResolvedAccess['userId'],
    tier: 'free',
    entitlements: resolveEntitlements(null) as readonly Entitlement[],
    client: {} as SupabaseClient,
    usageDate: '2026-09-24',
    timeZone: 'UTC',
    ...overrides,
  };
}

/** A client whose rpc() answers however the test says. */
function clientReturning(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('consume', () => {
  it('refuses a capability the plan does not include, without touching the database', async () => {
    const { client, rpc } = clientReturning({ data: [{ allowed: true, used: 1 }] });

    // Free tier does not hold ai.tutor.
    const decision = await consume(access({ client }), 'ai.tutor');

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('plan_required');
    // No allowance was spent on something they could never use.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('spends through the database function, never in the application', async () => {
    // Read-then-write in JavaScript cannot enforce a limit: two requests that
    // both read used=9 against a limit of 10 both proceed.
    const { client, rpc } = clientReturning({ data: [{ allowed: true, used: 4 }] });

    const decision = await consume(access({ client }), 'ai.generate_flashcards');

    expect(decision.allowed).toBe(true);
    expect(rpc).toHaveBeenCalledWith('consume_entitlement', {
      p_entitlement_key: 'ai.generate_flashcards',
      p_usage_date: '2026-09-24',
      p_limit: 10,
    });
  });

  it('passes no user id, because the function derives it from auth.uid()', async () => {
    const { client, rpc } = clientReturning({ data: [{ allowed: true, used: 1 }] });
    await consume(access({ client }), 'ai.generate_flashcards');

    const [, args] = rpc.mock.calls[0]!;
    expect(JSON.stringify(args)).not.toMatch(/user|alice/i);
  });

  it('sends a null limit for a paid tier, so it is recorded but never refused', async () => {
    const { client, rpc } = clientReturning({ data: [{ allowed: true, used: 900 }] });

    const paid = access({
      client,
      tier: 'pro',
      entitlements: resolveEntitlements({
        id: 's', userId: 'alice', tier: 'pro', status: 'active',
        stripeCustomerId: null, stripeSubscriptionId: null, stripePriceId: null,
        currentPeriodEnd: null, cancelAtPeriodEnd: false, metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });

    const decision = await consume(paid, 'ai.generate_flashcards');

    expect(decision.allowed).toBe(true);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_limit: null });
    // No quota is reported, because there is none to report.
    expect(decision.quota).toBeNull();
  });

  it('reports exhaustion with the real used count, so the UI can explain it', async () => {
    const { client } = clientReturning({ data: [{ allowed: false, used: 10 }] });

    const decision = await consume(access({ client }), 'ai.generate_flashcards');

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('quota_exhausted');
      expect(decision.quota).toMatchObject({ limit: 10, used: 10, remaining: 0 });
    }
  });

  it('REFUSES when usage cannot be recorded, rather than granting free usage', async () => {
    // The safe direction, and the one a mutation proved was untested. If the
    // counter is unhealthy the allowance must not quietly become unlimited —
    // that is how a database blip turns into an uncapped provider bill.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientReturning({ error: { message: 'relation does not exist' } });

    const decision = await consume(access({ client }), 'ai.generate_flashcards');

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('not_configured');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuses a malformed answer rather than reading it as permission', async () => {
    // A row that is missing, null, or shaped unexpectedly is not a yes.
    for (const data of [null, [], [{}], [{ allowed: null }], 'nonsense']) {
      const { client } = clientReturning({ data });
      const decision = await consume(access({ client }), 'ai.generate_flashcards');
      expect(decision.allowed, JSON.stringify(data)).toBe(false);
    }
  });
});
