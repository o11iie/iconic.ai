'use client';

import { useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

/**
 * Tabs, implementing the WAI-ARIA tabs pattern.
 *
 * Roving tabindex plus arrow-key navigation: only the active tab is in the tab
 * order, and arrows move between tabs. Without this a keyboard user has to tab
 * through every tab to reach the panel.
 */

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  label,
  className,
}: {
  readonly items: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
  readonly className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const index = items.findIndex((item) => item.id === value);
    let next = index;

    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;

    const target = items[next];
    if (!target) return;
    onChange(target.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${target.id}"]`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center gap-1 overflow-x-auto border-b border-hairline',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab-id={item.id}
            id={`tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium',
              'transition-colors duration-150',
              selected
                ? 'text-ink'
                : 'text-ink-subtle hover:text-ink-muted',
            )}
          >
            {item.icon ? <Icon name={item.icon} size={16} /> : null}
            {item.label}
            {typeof item.count === 'number' ? (
              <span className="rounded-full bg-surface-raised px-1.5 py-0.5 text-[10px] text-ink-subtle">
                {item.count}
              </span>
            ) : null}
            {selected ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
  className,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className={cn('outline-none', className)}
    >
      {children}
    </div>
  );
}

/**
 * Segmented control — a compact single-choice picker.
 *
 * Uses radiogroup semantics rather than tabs, because it selects a value
 * rather than revealing a panel.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
}) {
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        // `flex-wrap` and `max-w-full`: a four-option control must wrap on a
        // narrow screen instead of pushing its container past the viewport.
        'inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-hairline bg-surface p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150',
              selected
                ? 'bg-surface-overlay text-ink'
                : 'text-ink-subtle hover:text-ink-muted',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
