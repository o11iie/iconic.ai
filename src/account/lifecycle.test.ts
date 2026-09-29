import { describe, expect, it } from 'vitest';
import type { PlanTier, SubscriptionStatus } from '@/types/domain/billing';
import {
  DELETION_CONFIRMATION,
  DELETION_MESSAGES,
  DELETION_REFUSALS,
  DELETION_STATUS,
  decideDeletion,
  isBillable,
  PROTECTED_PROFILE_FIELDS,
  type DeletionInput,
} from './lifecycle';

function input(overrides: Partial<DeletionInput> = {}): DeletionInput {
  return {
    userId: 'user-1',
    confirmation: DELETION_CONFIRMATION,
    adminConfigured: true,
    stripeConfigured: true,
    tier: 'free',
    status: null,
    ...overrides,
  };
}

describe('deciding whether an account may be deleted', () => {
  it('permits a confirmed deletion for a free account', () => {
    const decision = decideDeletion(input());
    expect(decision).toEqual({
      allowed: true,
      userId: 'user-1',
      cancelSubscriptionFirst: false,
    });
  });

  it('refuses without a session, whatever the body says', () => {
    const decision = decideDeletion(input({ userId: null }));
    expect(decision).toEqual({ allowed: false, reason: 'unauthenticated' });
  });

  it('refuses unless the exact phrase was typed', () => {
    for (const attempt of [
      '',
      'delete my account',
      'DELETE MY ACCOUNT ',
      ' DELETE MY ACCOUNT',
      'yes',
      'DELETE MY ACCOUNTS',
    ]) {
      const decision = decideDeletion(input({ confirmation: attempt }));
      expect(decision, attempt).toEqual({ allowed: false, reason: 'not_confirmed' });
    }
  });

  it('checks confirmation before anything with a side effect', () => {
    /*
     * An unconfirmed request against a deployment that also could not delete
     * must report the confirmation, not the configuration: otherwise the
     * status code tells an attacker which deployments are deletable before
     * they have typed anything.
     */
    const decision = decideDeletion(
      input({ confirmation: 'no', adminConfigured: false }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'not_confirmed' });
  });

  it('refuses when the deployment cannot actually delete', () => {
    const decision = decideDeletion(input({ adminConfigured: false }));
    expect(decision).toEqual({ allowed: false, reason: 'not_configured' });
  });

  describe('a live subscription', () => {
    const billable: [PlanTier, SubscriptionStatus][] = [
      ['plus', 'active'],
      ['pro', 'active'],
      ['pro', 'trialing'],
      ['institution', 'past_due'],
    ];

    it.each(billable)('cancels %s/%s before deleting', (tier, status) => {
      const decision = decideDeletion(input({ tier, status }));
      expect(decision).toEqual({
        allowed: true,
        userId: 'user-1',
        cancelSubscriptionFirst: true,
      });
    });

    it.each(billable)(
      'refuses %s/%s outright when VEO cannot cancel it',
      (tier, status) => {
        // Deleting here would destroy the only record of who is being billed
        // while the charge continued.
        const decision = decideDeletion(
          input({ tier, status, stripeConfigured: false }),
        );
        expect(decision).toEqual({ allowed: false, reason: 'active_subscription' });
      },
    );

    it('does not treat a lapsed subscription as billable', () => {
      for (const status of ['canceled', 'incomplete', 'paused'] as const) {
        expect(isBillable('pro', status), status).toBe(false);

        const decision = decideDeletion(input({ tier: 'pro', status }));
        expect(decision, status).toMatchObject({
          allowed: true,
          cancelSubscriptionFirst: false,
        });
      }
    });

    it('does not treat free as billable at any status', () => {
      for (const status of ['active', 'trialing', 'past_due'] as const) {
        expect(isBillable('free', status), status).toBe(false);
      }
      expect(isBillable(null, 'active')).toBe(false);
    });
  });
});

describe('the refusal contract', () => {
  it('gives every refusal a status and a message', () => {
    for (const reason of DELETION_REFUSALS) {
      expect(DELETION_STATUS[reason], reason).toBeGreaterThanOrEqual(400);
      expect(DELETION_MESSAGES[reason]?.length, reason).toBeGreaterThan(0);
    }
  });

  it('uses 409 for a live subscription, not 400', () => {
    // The request was well formed and the learner is who they say they are.
    // It conflicts with the account's state, which is what 409 means and what
    // tells a client this is fixable by cancelling rather than by retrying.
    expect(DELETION_STATUS.active_subscription).toBe(409);
  });

  it('never names a variable, a table or a provider in a message', () => {
    for (const message of Object.values(DELETION_MESSAGES)) {
      expect(message).not.toMatch(/SUPABASE|STRIPE|sk_|whsec_|postgres|auth\.users/i);
    }
  });

  it('keeps the confirmation phrase in the message a learner is shown', () => {
    expect(DELETION_MESSAGES.not_confirmed).toContain(DELETION_CONFIRMATION);
  });
});

describe('what a learner may never write about themselves', () => {
  it('lists the fields the service must refuse', () => {
    // Asserted as a list so that adding a column to `profiles` and forgetting
    // to consider it is a visible omission rather than a silent one.
    expect(PROTECTED_PROFILE_FIELDS).toContain('user_id');
    expect(PROTECTED_PROFILE_FIELDS).toContain('onboarded_at');
  });
});
