'use client';

import { useState } from 'react';
import { ANATOMY_MODEL_CATALOG } from '@/anatomy/models/catalog';
import { ViewportShell } from '@/components/spatial/ViewportShell';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { capabilities } from '@/config/env';

/**
 * Anatomy explorer: model catalogue plus the spatial viewport.
 *
 * The catalogue is honest about availability. Entries whose licensed asset is
 * not yet published are shown — so the roadmap is visible — but are clearly
 * marked and selecting one produces an explicit "awaiting licensed asset"
 * state rather than fabricated geometry.
 */
export function AnatomyExplorer({ diagnostic = false }: { readonly diagnostic?: boolean }) {
  const [modelRef, setModelRef] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="catalogue-heading">
        <h2 id="catalogue-heading" className="text-xs font-medium tracking-wide text-[--color-ink-subtle]">
          Anatomy models
        </h2>

        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ANATOMY_MODEL_CATALOG.map((entry) => {
            const selected = modelRef === entry.modelRef;
            const awaitingAsset = entry.licensedAssetRequired && !capabilities.spatialAssets;

            return (
              <li key={entry.modelRef}>
                <button
                  type="button"
                  onClick={() => setModelRef(entry.modelRef)}
                  aria-pressed={selected}
                  className={cn(
                    'flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left transition-colors duration-150',
                    selected
                      ? 'border-[--color-accent]/50 bg-[--color-accent]/[0.07]'
                      : 'border-[--color-hairline] bg-[--color-surface] hover:border-[--color-hairline-strong]',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[--color-ink]">{entry.name}</span>
                    {awaitingAsset ? (
                      <Badge tone="warning">Awaiting asset</Badge>
                    ) : (
                      <Badge tone="success">Available</Badge>
                    )}
                  </span>
                  <span className="text-xs leading-relaxed text-[--color-ink-subtle]">
                    {entry.description}
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1 pt-1">
                    {entry.systems.map((system) => (
                      <Badge key={system} tone="neutral">
                        {system}
                      </Badge>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <ViewportShell modelRef={modelRef} diagnostic={diagnostic} className="min-h-[30rem]" />
    </div>
  );
}
