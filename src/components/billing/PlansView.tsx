'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { PLAN_TIERS, type EntitlementKey, type PlanTier } from '@/types/domain/billing';
import type { CapabilityView } from '@/billing/access';
import {
  CAPABILITY_LABELS,
  TIER_LABELS,
  TIER_SUMMARIES,
  allowanceLabel,
  remedyFor,
  type BillingStatus,
} from './plan-data';

/**
 * Plans.
 *
 * Shows the learner's REAL tier and their REAL remaining allowance, both read
 * from the server. Nothing here is illustrative: a pricing page that shows a
 * number the account does not have is the same lie as a dashboard that shows
 * invented progress, and it is the one place a learner is about to spend money
 * on the strength of what they read.
 *
 * What each tier includes is derived by running Gate 1's own
 * `resolveEntitlements` over a synthetic subscription per tier — so the table
 * cannot drift from what the server will actually grant. A hand-written
 * feature matrix is a second source of truth about the thing that decides
 * access, and it will be wrong within a release.
 */

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly status: BillingStatus };

export function PlansView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let current = true;

    void (async () => {
      try {
        const response = await fetch('/api/billing/status', { cache: 'no-store' });
        const body = await response.json();
        if (!current) return;

        if (response.status === 401) {
          setPhase({ kind: 'signed_out' });
          return;
        }
        if (!response.ok || !body.ok) {
          setPhase({ kind: 'unavailable' });
          return;
        }

        setPhase({ kind: 'ready', status: body as BillingStatus });
      } catch {
        if (current) setPhase({ kind: 'unavailable' });
      }
    })();

    return () => {
      current = false;
    };
  }, []);

  if (phase.kind === 'loading') return <LoadingState label="Loading your plan" />;

  if (phase.kind === 'signed_out') {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-4 p-10 text-center">
          <Icon name="lock" size={22} className="text-ink-faint" />
          <p className="max-w-prose text-sm text-ink-muted">
            Sign in to see your plan and what it includes.
          </p>
          <Link
            href="/login?next=/plans"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Sign in
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (phase.kind === 'unavailable') {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 p-10 text-center">
          <Icon name="alert" size={22} className="text-warning" />
          <p className="max-w-prose text-sm text-ink-muted">
            VEO could not read your plan just now. Your access is unchanged — this page
            only reports it.
          </p>
        </CardBody>
      </Card>
    );
  }

  const { status } = phase;

  return (
    <div className="flex flex-col gap-5" data-veo-plans>
      <CurrentPlan status={status} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_TIERS.map((tier) => (
          <TierCard
            key={tier}
            tier={tier}
            included={status.tiers[tier] ?? []}
            current={status.tier === tier}
            checkoutAvailable={status.checkoutAvailable}
          />
        ))}
      </div>

      {!status.checkoutAvailable ? (
        <p className="text-xs leading-relaxed text-ink-faint" role="status">
          Payments are not set up in this deployment, so VEO cannot start a checkout. Your
          current plan and allowances above are real and are enforced — only the upgrade
          step is unavailable.
        </p>
      ) : null}
    </div>
  );
}

/** The learner's own plan and what is left of today's allowances. */
function CurrentPlan({ status }: { readonly status: BillingStatus }) {
  const metered = status.capabilities.filter(
    (capability) => capability.granted && capability.limit !== null,
  );

  return (
    <Card>
      <CardHeader
        title={`You are on ${TIER_LABELS[status.tier]}`}
        description={TIER_SUMMARIES[status.tier]}
      />
      <CardBody className="flex flex-col gap-4">
        {metered.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2" data-veo-allowances>
            {metered.map((capability) => (
              <li
                key={capability.key}
                className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface-raised p-3"
                data-veo-allowance={capability.key}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink">
                    {CAPABILITY_LABELS[capability.key].title}
                  </span>
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      capability.exhausted ? 'text-warning' : 'text-ink-muted',
                    )}
                  >
                    {capability.remaining} of {capability.limit}
                  </span>
                </div>

                <div
                  className="h-1.5 overflow-hidden rounded-full bg-hairline"
                  role="img"
                  aria-label={`${CAPABILITY_LABELS[capability.key].title}: ${capability.remaining} of ${capability.limit} left today`}
                >
                  <div
                    className={cn('h-full rounded-full', capability.exhausted ? 'bg-warning' : 'bg-cyan')}
                    style={{
                      width: `${capability.limit ? ((capability.remaining ?? 0) / capability.limit) * 100 : 0}%`,
                    }}
                  />
                </div>

                <p className="text-[11px] text-ink-faint">
                  {capability.exhausted
                    ? 'Spent for today. Resets tomorrow in your timezone.'
                    : 'Resets daily.'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            Nothing on your plan is capped daily.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function TierCard({
  tier,
  included,
  current,
  checkoutAvailable,
}: {
  readonly tier: PlanTier;
  readonly included: readonly EntitlementKey[];
  readonly current: boolean;
  readonly checkoutAvailable: boolean;
}) {
  return (
    <Card className={cn(current ? 'border-cyan' : '')}>
      <CardBody className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">{TIER_LABELS[tier]}</h3>
          {current ? (
            <span className="rounded-full border border-cyan px-2 py-0.5 text-[11px] text-cyan">
              Current
            </span>
          ) : null}
        </div>

        <p className="text-xs leading-relaxed text-ink-muted">{TIER_SUMMARIES[tier]}</p>

        <ul className="flex flex-1 flex-col gap-1.5">
          {included.map((key) => (
            <li key={key} className="flex items-start gap-1.5 text-xs text-ink-muted">
              <Icon name="check" size={13} className="mt-0.5 shrink-0 text-cyan" />
              <span>{CAPABILITY_LABELS[key].title}</span>
            </li>
          ))}
        </ul>

        {/*
          No price is shown. VEO has never taken a payment, so any figure here
          would be invented — and a number on a pricing page is a commitment,
          not a placeholder.
        */}
        {current ? (
          <Button variant="secondary" size="sm" disabled>
            Your plan
          </Button>
        ) : tier === 'free' ? null : (
          <Button
            variant={checkoutAvailable ? 'primary' : 'secondary'}
            size="sm"
            disabled={!checkoutAvailable}
            data-veo-upgrade={tier}
            title={checkoutAvailable ? undefined : 'Payments are not set up in this deployment'}
          >
            {checkoutAvailable ? `Upgrade to ${TIER_LABELS[tier]}` : 'Not available yet'}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * One capability's state, for the settings page.
 *
 * Separate from the tier cards because settings answers "what do I have?"
 * rather than "what could I buy?".
 */
export function CapabilityRow({ capability }: { readonly capability: CapabilityView }) {
  const label = CAPABILITY_LABELS[capability.key];
  const allowance = allowanceLabel(capability);
  const remedy = remedyFor(capability);

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon
        name={capability.granted ? 'check' : 'lock'}
        size={15}
        className={cn('mt-0.5 shrink-0', capability.granted ? 'text-cyan' : 'text-ink-faint')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{label.title}</p>
        <p className="text-xs leading-relaxed text-ink-faint">{label.detail}</p>
      </div>
      <span className="shrink-0 text-right text-[11px] text-ink-muted">
        {allowance ?? remedy ?? 'Included'}
      </span>
    </li>
  );
}
