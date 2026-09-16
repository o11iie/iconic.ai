import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Logo';
import { SITE } from '@/config/site';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden="true" className="veo-grid-backdrop pointer-events-none absolute inset-0" />

      <header className="relative flex h-16 items-center px-6 lg:px-8">
        <Link href="/" className="rounded-md">
          <Logo />
        </Link>
      </header>

      <main id="veo-main" className="relative flex flex-1 items-center justify-center px-6 pb-20">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="relative px-6 pb-8 text-center lg:px-8">
        <p className="text-xs text-[--color-ink-faint]">{SITE.tagline}</p>
      </footer>
    </div>
  );
}
