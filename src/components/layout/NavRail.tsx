'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { APP_NAV } from '@/config/site';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useViewerStore } from '@/store/viewer-store';

/**
 * Desktop navigation rail.
 *
 * Two densities: icon-only from `md`, icon + label from `xl`, so mid-size
 * laptops keep the viewport wide. The active indicator is a shared layout
 * element, so it slides between items rather than blinking.
 *
 * Each destination is rendered exactly ONCE. An earlier version rendered two
 * copies of every link and hid one with CSS, which put every navigation
 * destination in the accessibility tree twice. The label is therefore always
 * present for assistive technology and only visually hidden below `xl`.
 */
export function NavRail() {
  const pathname = usePathname();
  const modelRef = useViewerStore((s) => s.modelRef);

  return (
    <nav
      aria-label="Primary"
      className="hidden shrink-0 flex-col gap-1 border-r border-hairline bg-obsidian px-2 py-3 md:flex xl:w-[13.5rem] xl:px-3"
    >
      {APP_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        // Carry the open model across navigation so returning to Explore
        // resumes what the learner was looking at.
        const href =
          item.preservesSpatialContext && modelRef
            ? `${item.href}?model=${encodeURIComponent(modelRef)}`
            : item.href;

        return (
          <Link
            key={item.href}
            href={href}
            aria-current={active ? 'page' : undefined}
            // Native tooltip: the only affordance needed while the rail is
            // collapsed, and it costs no extra DOM.
            title={item.label}
            className={cn(
              'group relative flex h-10 items-center gap-3 rounded-lg px-2.5 transition-colors duration-150 xl:px-3',
              active
                ? 'text-ink'
                : 'text-ink-subtle hover:bg-surface/70 hover:text-ink',
            )}
          >
            {active ? (
              <motion.span
                layoutId="nav-rail-active"
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-surface-raised"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              />
            ) : null}

            <Icon name={item.icon as IconName} size={19} className="relative z-10" />

            {/* Always in the accessibility tree; visually shown from xl up. */}
            <span className="relative z-10 text-sm font-medium sr-only xl:not-sr-only">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
