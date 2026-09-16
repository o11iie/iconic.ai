'use client';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type { SpatialLayer } from '@/types/domain/spatial';

/**
 * Layer visibility.
 *
 * Driven entirely by the layers the loaded model declares in its manifest.
 * With no model loaded it says so rather than listing invented systems.
 */
export function LayersPanel({
  layers,
  hiddenLayerIds,
  onToggle,
  className,
}: {
  readonly layers: readonly SpatialLayer[];
  readonly hiddenLayerIds: ReadonlySet<string>;
  readonly onToggle: (layerId: string) => void;
  readonly className?: string;
}) {
  if (layers.length === 0) {
    return (
      <p className={cn('text-xs leading-relaxed text-ink-faint', className)}>
        The loaded model declares no separate layers. Layers appear here when a model defines them
        in its manifest.
      </p>
    );
  }

  return (
    <ul className={cn('flex flex-col gap-0.5', className)}>
      {layers.map((layer) => {
        const visible = !hiddenLayerIds.has(layer.id);
        return (
          <li key={layer.id}>
            <button
              type="button"
              role="switch"
              aria-checked={visible}
              onClick={() => onToggle(layer.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-raised"
            >
              <span
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded border transition-colors',
                  visible
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-hairline-strong text-transparent',
                )}
              >
                <Icon name="check" size={11} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm',
                    visible ? 'text-ink' : 'text-ink-faint',
                  )}
                >
                  {layer.name}
                </span>
                {layer.description ? (
                  <span className="block truncate text-xs text-ink-faint">
                    {layer.description}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] tabular-nums text-ink-faint">
                {layer.objectIds.length}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
