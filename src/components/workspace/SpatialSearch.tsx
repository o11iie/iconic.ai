'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Search } from '@/components/ui/Search';
import { cn } from '@/lib/cn';
import type { SearchResult } from '@/engine/spatial/search';
import type { SemanticId } from '@/lib/semantic-id';

/**
 * Structure search.
 *
 * Queries the controller's index, so every result is a real semantic object in
 * the current model. Selecting one drives the same `focusObject` path a click
 * does — there is no separate "search selection" branch that could diverge.
 *
 * Keyboard: arrows move, Enter selects, Escape closes. A search field that
 * only works with a mouse is half a feature.
 */
export function SpatialSearch({
  onSearch,
  onSelect,
  disabled = false,
  className,
}: {
  readonly onSearch: (query: string) => readonly SearchResult[];
  readonly onSelect: (semanticId: SemanticId) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => (query.trim().length > 0 ? onSearch(query) : []),
    [query, onSearch],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(result: SearchResult) {
    onSelect(result.semanticId);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search
        value={query}
        disabled={disabled}
        label="Search structures"
        placeholder={disabled ? 'Load a model to search' : 'Search structures'}
        onChange={(event) => {
          setQuery(event.target.value);
          // Reset the highlighted result here, in the event that changed the
          // query, rather than in an effect reacting to it afterwards.
          setActive(0);
          setOpen(true);
        }}
        onClear={() => {
          setQuery('');
          setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (results.length === 0) return;

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((value) => (value + 1) % results.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((value) => (value - 1 + results.length) % results.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const result = results[active];
            if (result) choose(result);
          }
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="veo-search-results"
        aria-autocomplete="list"
      />

      {open && query.trim().length > 0 ? (
        <div
          id="veo-search-results"
          role="listbox"
          aria-label="Search results"
          className="veo-glass absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl p-1"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-ink-faint">
              No structure in this model matches “{query}”.
            </p>
          ) : (
            results.map((result, index) => (
              <button
                key={result.semanticId}
                type="button"
                role="option"
                aria-selected={index === active}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(result)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  index === active ? 'bg-surface-raised' : 'hover:bg-surface-raised/60',
                )}
              >
                <Icon name="explore" size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{result.name}</span>
                  <span className="block truncate font-mono text-[10px] text-cyan">
                    {result.semanticId}
                  </span>
                </span>
                {result.system ? (
                  <span className="shrink-0 text-[10px] text-ink-faint">{result.system}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
