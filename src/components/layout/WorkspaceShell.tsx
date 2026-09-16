import type { ReactNode } from 'react';
import { capabilities } from '@/config/env';
import { getServerUser } from '@/lib/supabase/server';
import { NavRail } from './NavRail';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';

/**
 * Full-bleed shell for the learning workspace.
 *
 * Differs from `AppShell` in one decisive way: it does not scroll and does not
 * pad. The viewport fills every pixel the chrome does not need, because the
 * spatial model is the product, not a widget inside a page.
 */
export async function WorkspaceShell({
  children,
  context,
}: {
  readonly children: ReactNode;
  readonly context?: ReactNode;
}) {
  const user = capabilities.supabase ? await getServerUser() : null;
  const name = (user?.user_metadata?.display_name as string | undefined) ?? null;

  return (
    <div className="flex h-dvh overflow-hidden bg-obsidian">
      <a
        href="#veo-main"
        className="veo-sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to the workspace
      </a>

      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          name={name}
          email={user?.email ?? null}
          signedIn={Boolean(user)}
          context={context}
          searchPlaceholder="Search structures"
        />

        <main id="veo-main" className="flex min-h-0 flex-1 flex-col pb-[4.25rem] md:pb-0">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
