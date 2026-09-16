import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Logo';
import { SITE } from '@/config/site';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center px-5 sm:px-6">
        <Link href="/" className="rounded-md" aria-label={`${SITE.name} home`}>
          <Logo />
        </Link>
      </header>
      <main id="veo-main" className="mx-auto w-full max-w-3xl px-5 pb-24 sm:px-6">
        {children}
      </main>
    </div>
  );
}
