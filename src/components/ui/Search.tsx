'use client';

import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

export interface SearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Accessible name. Visually hidden by default — the icon carries the affordance. */
  readonly label?: string;
  readonly onClear?: () => void;
  /** Keyboard hint rendered on the right, e.g. "/" or "⌘K". */
  readonly shortcut?: string;
}

/**
 * Search field.
 *
 * `type="search"` so browsers and assistive tech treat it as one, with a real
 * label kept for screen readers even though it is visually hidden.
 */
export const Search = forwardRef<HTMLInputElement, SearchProps>(function Search(
  { className, label = 'Search', onClear, shortcut, value, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <div className={cn('relative flex items-center', className)}>
      <label htmlFor={inputId} className="veo-sr-only">
        {label}
      </label>

      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute left-3 text-ink-faint"
      />

      <input
        ref={ref}
        id={inputId}
        type="search"
        value={value}
        className={cn(
          'h-9 w-full rounded-lg border border-hairline bg-surface',
          'pl-9 pr-9 text-sm text-ink placeholder:text-ink-faint',
          'transition-colors duration-150 hover:border-hairline-strong',
          // Hide the browser's own clear affordance; we render our own.
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
        {...props}
      />

      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-2 grid size-6 place-items-center rounded-md text-ink-faint hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      ) : shortcut ? (
        <kbd
          aria-hidden="true"
          className="absolute right-2.5 rounded border border-hairline-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-faint"
        >
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
});
