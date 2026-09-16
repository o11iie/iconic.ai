import type { Metadata } from 'next';
import Link from 'next/link';
import { OnboardingFlow } from '@/components/layout/OnboardingFlow';
import { Logo } from '@/components/layout/Logo';
import { capabilities } from '@/config/env';
import { getServerUser } from '@/lib/supabase/server';
import { SITE } from '@/config/site';

export const metadata: Metadata = { title: 'Set up VEO' };

export default async function OnboardingPage() {
  const user = capabilities.supabase ? await getServerUser() : null;
  const defaultName =
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    '';

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden="true" className="veo-grid-backdrop pointer-events-none absolute inset-0 h-[50vh]" />

      <div className="relative mx-auto flex w-full max-w-lg flex-col px-5 sm:px-6">
        <header className="flex h-16 items-center sm:h-20">
          <Link href="/" className="rounded-md" aria-label={`${SITE.name} home`}>
            <Logo />
          </Link>
        </header>

        <main id="veo-main" className="py-4 pb-20">
          <p className="mb-8 text-xs uppercase tracking-[0.1em] text-ink-faint">
            Setting up
          </p>
          <OnboardingFlow defaultName={defaultName} canPersist={capabilities.supabase} />
        </main>
      </div>
    </div>
  );
}
