import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Logo';
import { LEGAL_LINKS, SITE } from '@/config/site';

/**
 * Authentication shell.
 *
 * Shares the landing page's backdrop and typography so signing in feels like
 * entering VEO rather than arriving at a detached form.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden="true" className="veo-grid-backdrop pointer-events-none absolute inset-0 h-[60vh]" />

      <header className="relative flex h-16 items-center px-5 sm:h-20 sm:px-8">
        <Link href="/" className="rounded-md" aria-label={`${SITE.name} home`}>
          <Logo />
        </Link>
      </header>

      <main id="veo-main" className="relative flex flex-1 items-start justify-center px-5 pb-16 pt-6 sm:items-center sm:pb-24 sm:pt-0">
        <div className="w-full max-w-[22rem]">{children}</div>
      </main>

      <footer className="relative flex items-center justify-center gap-4 px-5 pb-8">
        {LEGAL_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded text-xs text-ink-faint hover:text-ink-muted"
          >
            {link.label}
          </Link>
        ))}
      </footer>
    </div>
  );
}
