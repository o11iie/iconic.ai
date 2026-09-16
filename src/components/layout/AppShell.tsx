import type { ReactNode } from 'react';
import { capabilities } from '@/config/env';
import { getServerUser } from '@/lib/supabase/server';
import { cn } from '@/lib/cn';
import { NavRail } from './NavRail';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { PageTransition } from './PageTransition';

/**
 * Standard page shell: navigation rail (desktop) or bottom nav (mobile),
 * a top bar, a page header, and an optional contextual right panel.
 *
 * A Server Component so the session is resolved once per request rather than
 * fetched again on the client.
 */
export async function AppShell({
  children,
  title,
  subtitle,
  actions,
  aside,
  /** Let the page own its own scroll container (used by list-heavy routes). */
  bleed = false,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly aside?: ReactNode;
  readonly bleed?: boolean;
}) {
  const user = capabilities.supabase ? await getServerUser() : null;
  const name = (user?.user_metadata?.display_name as string | undefined) ?? null;

  return (
    <div className="flex min-h-dvh bg-obsidian">
      <a
        href="#veo-main"
        className="veo-sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to main content
      </a>

      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar name={name} email={user?.email ?? null} signedIn={Boolean(user)} />

        <div className="flex min-h-0 flex-1">
          <main id="veo-main" className="min-w-0 flex-1 pb-20 md:pb-0">
            <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-2xl">
                    {title}
                  </h1>
                  {subtitle ? (
                    <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
                {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
              </div>
            </div>

            <PageTransition>
              <div
                className={cn(
                  'mx-auto w-full max-w-6xl',
                  bleed ? 'pt-6' : 'px-4 py-6 sm:px-6 lg:px-8',
                )}
              >
                {children}
              </div>
            </PageTransition>
          </main>

          {aside ? (
            <aside className="hidden w-80 shrink-0 border-l border-hairline xl:block">
              <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto p-4">
                {aside}
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
