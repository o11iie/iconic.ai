'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/store/ui-store';
import { Icon, type IconName } from './Icon';
import { motionSafe, riseIn } from './motion';

/**
 * Dropdown menu.
 *
 * Implements the menu-button pattern: `aria-haspopup`, `aria-expanded`,
 * `role="menu"` / `role="menuitem"`, Escape to close, arrow-key roving focus,
 * and dismissal on outside click. Focus returns to the trigger on close.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly onSelect?: () => void;
  readonly href?: string;
  readonly tone?: 'default' | 'danger';
  readonly separatorBefore?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  readonly trigger: (props: { open: boolean }) => ReactNode;
  readonly items: readonly MenuItem[];
  readonly align?: 'start' | 'end';
  readonly label: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const options = listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!options || options.length === 0) return;

      event.preventDefault();
      const current = Array.from(options).indexOf(document.activeElement as HTMLElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (current + delta + options.length) % options.length;
      options[next]?.focus();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Move focus into the menu when it opens, so keyboard users land inside it.
  useEffect(() => {
    if (!open) return;
    const first = listRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full outline-none"
      >
        {trigger({ open })}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={listRef}
            role="menu"
            aria-label={label}
            variants={motionSafe(riseIn, reducedMotion)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'veo-glass absolute top-full z-50 mt-2 min-w-[13rem] rounded-xl p-1.5',
              align === 'end' ? 'right-0' : 'left-0',
            )}
          >
            {items.map((item) => {
              const content = (
                <>
                  {item.icon ? <Icon name={item.icon} size={16} /> : null}
                  <span className="truncate">{item.label}</span>
                </>
              );

              const itemClass = cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
                'outline-none transition-colors duration-100',
                item.tone === 'danger'
                  ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                  : 'text-ink-muted hover:bg-surface-raised hover:text-ink focus:bg-surface-raised focus:text-ink',
              );

              return (
                <div key={item.id}>
                  {item.separatorBefore ? (
                    <div aria-hidden="true" className="my-1.5 h-px bg-hairline" />
                  ) : null}

                  {item.href ? (
                    <a role="menuitem" href={item.href} className={itemClass} onClick={() => setOpen(false)}>
                      {content}
                    </a>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className={itemClass}
                      onClick={() => {
                        setOpen(false);
                        item.onSelect?.();
                      }}
                    >
                      {content}
                    </button>
                  )}
                </div>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
