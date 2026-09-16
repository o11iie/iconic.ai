'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Logo } from './Logo';
import { AccountMenu } from './AccountMenu';
import { Search } from '@/components/ui/Search';
import { cn } from '@/lib/cn';

/**
 * Application top bar.
 *
 * Carries identity, search, an optional context slot (the model currently open
 * in the workspace) and the account menu. The logo is shown on mobile, where
 * the rail that would otherwise carry it is replaced by the bottom nav.
 */
export function TopBar({
  name,
  email,
  signedIn,
  context,
  searchPlaceholder = 'Search subjects, models, notes',
  onSearch,
  className,
}: {
  readonly name: string | null;
  readonly email: string | null;
  readonly signedIn: boolean;
  readonly context?: ReactNode;
  readonly searchPlaceholder?: string;
  readonly onSearch?: (query: string) => void;
  readonly className?: string;
}) {
  const [query, setQuery] = useState('');

  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-3 lg:px-4',
        className,
      )}
    >
      <Link href="/dashboard" className="rounded-md md:hidden" aria-label="VEO home">
        <Logo showWordmark={false} />
      </Link>

      <div className="hidden min-w-0 items-center gap-3 md:flex">{context}</div>

      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
        <Search
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onSearch?.(event.target.value);
          }}
          onClear={() => {
            setQuery('');
            onSearch?.('');
          }}
          placeholder={searchPlaceholder}
          className="min-w-0 max-w-xs flex-1"
        />
        <AccountMenu name={name} email={email} signedIn={signedIn} />
      </div>
    </header>
  );
}
