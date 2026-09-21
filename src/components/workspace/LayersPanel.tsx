'use client';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type { SpatialLayer } from '@/types/domain/spatial';

/**
 * Layer control.
 *
 * Driven entirely by the layers the loaded model declares. With no model
 * loaded it says so rather than listing invented systems, and every count
 * shown is the number of objects the layer actually holds.
 *
 * A layer has three states, not two. Hiding removes it; ghosting keeps it
 * faintly present so the learner can still see where what they are studying
 * sits. Those are different questions, and a checkbox can only answer one.
 */

export type LayerState = 'visible' | 'hidden' | 'ghosted';

export function LayersPanel({
  layers,
  stateOf,
  peeledLayerIds,
  onShow,
  onHide,
  onGhost,
  className,
}: {
  readonly layers: readonly SpatialLayer[];
  readonly stateOf: (layerId: string) => LayerState;
  /** Layers the current peel level has taken away. Reported, not editable. */
  readonly peeledLayerIds: readonly string[];
  readonly onShow: (layerId: string) => void;
  readonly onHide: (layerId: string) => void;
  readonly onGhost: (layerId: string) => void;
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

  const peeled = new Set(peeledLayerIds);

  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {layers.map((layer) => {
        const state = stateOf(layer.id);
        const isPeeled = peeled.has(layer.id);

        return (
          <li
            key={layer.id}
            className="rounded-lg border border-hairline/70 px-2 py-1.5"
            data-layer={layer.id}
            data-state={isPeeled ? 'peeled' : state}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm',
                    state === 'visible' && !isPeeled ? 'text-ink' : 'text-ink-faint',
                  )}
                >
                  {layer.name}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {isPeeled
                    ? 'Peeled away'
                    : (layer.description ?? `${layer.objectIds.length} structures`)}
                </span>
              </span>

              <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                {layer.objectIds.length}
              </span>
            </div>

            <div className="mt-1.5 flex gap-1">
              <LayerAction
                label={`Show ${layer.name}`}
                text="Show"
                icon="check"
                active={state === 'visible'}
                onClick={() => onShow(layer.id)}
              />
              <LayerAction
                label={`Ghost ${layer.name}`}
                text="Ghost"
                icon="ghost"
                active={state === 'ghosted'}
                onClick={() => onGhost(layer.id)}
              />
              <LayerAction
                label={`Hide ${layer.name}`}
                text="Hide"
                icon="eyeOff"
                active={state === 'hidden'}
                onClick={() => onHide(layer.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function LayerAction({
  label,
  text,
  icon,
  active,
  onClick,
}: {
  readonly label: string;
  readonly text: string;
  readonly icon: 'check' | 'ghost' | 'eyeOff';
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1',
        'text-[11px] font-medium transition-colors duration-150',
        active
          ? 'border-accent/60 bg-accent/15 text-accent'
          : 'border-hairline text-ink-faint hover:border-hairline-strong hover:text-ink',
      )}
    >
      <Icon name={icon} size={12} />
      {text}
    </button>
  );
}
