'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export function NavLink({
  href,
  label,
  description,
}: {
  readonly href: string;
  readonly label: string;
  readonly description?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      // aria-current is what actually communicates "you are here" to assistive
      // technology; colour alone does not.
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex flex-col gap-0.5 rounded-lg px-3 py-2 transition-colors duration-150',
        active
          ? 'bg-surface-raised text-ink'
          : 'text-ink-muted hover:bg-surface/60 hover:text-ink',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span
          aria-hidden="true"
          className={cn(
            'size-1 rounded-full transition-colors',
            active ? 'bg-cyan' : 'bg-transparent group-hover:bg-ink-faint',
          )}
        />
        {label}
      </span>
      {description ? (
        <span className="pl-3 text-[11px] leading-snug text-ink-faint">{description}</span>
      ) : null}
    </Link>
  );
}
