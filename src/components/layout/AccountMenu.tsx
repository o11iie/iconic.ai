'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { signOutAction } from '@/app/(auth)/actions';
import { Avatar } from '@/components/ui/Avatar';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * Account menu.
 *
 * Holds Settings so it stays out of the primary navigation, which is reserved
 * for learning surfaces. Signing out goes through the server action so the
 * session cookie is cleared server-side.
 */
export function AccountMenu({
  name,
  email,
  signedIn,
}: {
  readonly name: string | null;
  readonly email: string | null;
  readonly signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const items: MenuItem[] = signedIn
    ? [
        { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
        { id: 'library', label: 'Your library', icon: 'library', href: '/library' },
        {
          id: 'signout',
          label: pending ? 'Signing out…' : 'Sign out',
          icon: 'logout',
          tone: 'danger',
          separatorBefore: true,
          onSelect: () => startTransition(() => void signOutAction()),
        },
      ]
    : [
        { id: 'signin', label: 'Sign in', icon: 'user', onSelect: () => router.push('/login') },
        { id: 'signup', label: 'Create account', icon: 'plus', onSelect: () => router.push('/signup') },
        { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings', separatorBefore: true },
      ];

  return (
    <Menu
      label={signedIn ? 'Account menu' : 'Sign in menu'}
      items={items}
      trigger={({ open }) => (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full transition-colors',
            signedIn ? 'p-0.5' : 'px-3 py-1.5',
            open ? 'bg-surface-raised' : 'hover:bg-surface-raised',
          )}
        >
          {/* A "?" avatar for a signed-out visitor reads as a broken image.
              Offer the action instead. */}
          {signedIn ? (
            <Avatar name={name} email={email} size={28} />
          ) : (
            <span className="whitespace-nowrap text-sm font-medium text-ink-muted">Sign in</span>
          )}
          <Icon
            name="chevronDown"
            size={14}
            className={cn('text-ink-faint', signedIn && 'mr-1')}
          />
        </span>
      )}
    />
  );
}
