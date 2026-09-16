'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tooltip.
 *
 * Shows on hover AND focus — a hover-only tooltip is invisible to keyboard
 * users. Linked with `aria-describedby` so it is announced rather than merely
 * drawn, and never used to carry the only copy of essential information.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const position = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side];

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'veo-glass pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1',
            'text-[11px] font-medium text-ink',
            position,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
