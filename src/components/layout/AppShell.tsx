import type { ReactNode } from 'react';
import { APP_NAV, SECONDARY_NAV } from '@/config/site';
import { Logo } from './Logo';
import { NavLink } from './NavLink';

/**
 * Application shell: persistent navigation plus a content region.
 *
 * Uses real landmarks (<header>, <nav>, <main>) and a skip link, so keyboard
 * and screen-reader users can reach content without traversing navigation on
 * every route change.
 */
export function AppShell({
  children,
  title,
  subtitle,
  actions,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[--color-obsidian]">
      <a
        href="#veo-main"
        className="veo-sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[--color-surface-raised] focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to main content
      </a>

      <div className="flex flex-1 flex-col lg:flex-row">
        <header className="shrink-0 border-b border-[--color-hairline] lg:w-64 lg:border-b-0 lg:border-r">
          <div className="flex h-14 items-center px-5 lg:h-16">
            <Logo />
          </div>

          <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
            {APP_NAV.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
            <div className="hidden lg:mt-4 lg:block lg:border-t lg:border-[--color-hairline] lg:pt-4">
              {SECONDARY_NAV.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
              ))}
            </div>
            <div className="lg:hidden">
              {SECONDARY_NAV.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
              ))}
            </div>
          </nav>
        </header>

        <main id="veo-main" className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 border-b border-[--color-hairline] px-6 py-5 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-[--color-ink]">{title}</h1>
              {actions}
            </div>
            {subtitle ? (
              <p className="max-w-2xl text-sm leading-relaxed text-[--color-ink-muted]">{subtitle}</p>
            ) : null}
          </div>

          <div className="px-6 py-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
