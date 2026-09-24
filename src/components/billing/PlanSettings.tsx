'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import { ENTITLEMENT_KEYS } from '@/types/domain/billing';
import { CapabilityRow } from './PlansView';
import { TIER_LABELS, TIER_SUMMARIES, type BillingStatus } from './plan-data';

/**
 * The plan section on Settings.
 *
 * Answers "what do I have?" where the plans page answers "what could I buy?".
 * Same server response, so the two cannot disagree about the same account.
 */
export function PlanSettings({ signedIn }: { readonly signedIn: boolean }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let current = true;

    void (async () => {
      try {
        const response = await fetch('/api/billing/status', { cache: 'no-store' });
        const body = await response.json();
        if (!current) return;

        if (!response.ok || !body.ok) {
          setFailed(true);
          return;
        }
        setStatus(body as BillingStatus);
      } catch {
        if (current) setFailed(true);
      }
    })();

    return () => {
      current = false;
    };
  }, [signedIn]);

  return (
    <Panel
      title="Your plan"
      description="What this account can do today."
      action={
        <Link
          href="/plans"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-cyan hover:bg-surface-raised"
        >
          Compare plans
          <Icon name="arrowRight" size={13} />
        </Link>
      }
    >
      {!signedIn ? (
        <p className="text-sm text-ink-muted">Sign in to see your plan.</p>
      ) : failed ? (
        <p className="text-sm text-ink-muted">
          VEO could not read your plan just now. Your access is unchanged — this panel only
          reports it.
        </p>
      ) : status === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3" data-veo-plan-settings>
          <div>
            <p className="text-sm font-medium text-ink">{TIER_LABELS[status.tier]}</p>
            <p className="text-xs leading-relaxed text-ink-faint">
              {TIER_SUMMARIES[status.tier]}
            </p>
          </div>

          <ul className="flex flex-col divide-y divide-hairline">
            {ENTITLEMENT_KEYS.map((key) => {
              const capability = status.capabilities.find((entry) => entry.key === key);
              if (!capability) return null;
              return <CapabilityRow key={key} capability={capability} />;
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
