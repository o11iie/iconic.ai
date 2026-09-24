import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { PlansView } from '@/components/billing/PlansView';
import { NotConfiguredState } from '@/components/ui/states';
import { capabilities } from '@/config/env';

export const metadata: Metadata = { title: 'Plans' };

/**
 * PLANS — what this account can do, and what more would cost.
 *
 * Every figure is the learner's own: their real tier, their real remaining
 * allowance, read from the server. Nothing is illustrative. This is the one
 * page somebody is about to spend money on the strength of, so an invented
 * number here would be worse than an invented number anywhere else in VEO.
 */
export default function PlansPage() {
  return (
    <AppShell
      title="Plans"
      subtitle="What your account includes today, and what each plan adds. Your allowances below are real and are enforced on every request."
    >
      {capabilities.supabase ? (
        <PlansView />
      ) : (
        <NotConfiguredState
          title="No database connected"
          description="Plans and allowances are tied to an account, which lives in Supabase. Until a project is attached there is no subscription to read and VEO will not invent one."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}
    </AppShell>
  );
}
