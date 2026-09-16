'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAV } from '@/config/site';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useViewerStore } from '@/store/viewer-store';

/**
 * Mobile bottom navigation.
 *
 * A real mobile pattern rather than a shrunken sidebar: thumb-reachable,
 * fixed, and padded for the home indicator via `env(safe-area-inset-bottom)`.
 */
export function BottomNav() {
  const pathname = usePathname();
  const modelRef = useViewerStore((s) => s.modelRef);

  return (
    <nav
      aria-label="Primary"
      className="veo-glass fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-x-0 border-b-0 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {APP_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const href =
          item.preservesSpatialContext && modelRef
            ? `${item.href}?model=${encodeURIComponent(modelRef)}`
            : item.href;

        return (
          <Link
            key={item.href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 px-1 pb-2 pt-2.5 transition-colors duration-150',
              active ? 'text-accent' : 'text-ink-subtle',
            )}
          >
            <Icon name={item.icon as IconName} size={20} />
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
            <span
              aria-hidden="true"
              className={cn(
                'h-0.5 w-6 rounded-full transition-colors',
                active ? 'bg-accent' : 'bg-transparent',
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
