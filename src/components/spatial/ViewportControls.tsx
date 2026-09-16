'use client';

import { cn } from '@/lib/cn';

/**
 * Viewport controls.
 *
 * Every control here is wired to a real provider operation. Controls the
 * active provider cannot perform are disabled with an explanatory title rather
 * than silently doing nothing — a dead button is worse than an absent one.
 */

export interface ViewportControlsProps {
  readonly onReset: () => void;
  readonly onFit: () => void;
  readonly onIsolate: () => void;
  readonly onRestore: () => void;
  readonly onToggleLabels: () => void;
  readonly showLabels: boolean;
  readonly hasSelection: boolean;
  readonly isIsolated: boolean;
  readonly canIsolate: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

interface ControlDef {
  readonly id: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly pressed?: boolean;
  readonly hint: string;
}

export function ViewportControls({
  onReset,
  onFit,
  onIsolate,
  onRestore,
  onToggleLabels,
  showLabels,
  hasSelection,
  isIsolated,
  canIsolate,
  disabled = false,
  className,
}: ViewportControlsProps) {
  const controls: ControlDef[] = [
    {
      id: 'reset',
      label: 'Reset view',
      onClick: onReset,
      disabled,
      hint: 'Frame the whole model',
    },
    {
      id: 'fit',
      label: 'Fit selection',
      onClick: onFit,
      disabled: disabled || !hasSelection,
      hint: hasSelection ? 'Frame the selected structure' : 'Select a structure first',
    },
    {
      id: 'isolate',
      label: isIsolated ? 'Exit isolation' : 'Isolate',
      onClick: isIsolated ? onRestore : onIsolate,
      disabled: disabled || !canIsolate || (!hasSelection && !isIsolated),
      pressed: isIsolated,
      hint: canIsolate
        ? 'Show only the selected structure and ghost its surroundings'
        : 'This provider does not support isolation',
    },
    {
      id: 'labels',
      label: showLabels ? 'Hide labels' : 'Show labels',
      onClick: onToggleLabels,
      disabled,
      pressed: showLabels,
      hint: 'Toggle structure labels in the viewport',
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Viewport controls"
      aria-orientation="horizontal"
      className={cn('veo-glass flex items-center gap-1 rounded-xl p-1', className)}
    >
      {controls.map((control) => (
        <button
          key={control.id}
          type="button"
          onClick={control.onClick}
          disabled={control.disabled}
          title={control.hint}
          aria-pressed={control.pressed}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150',
            'disabled:cursor-not-allowed disabled:opacity-40',
            control.pressed
              ? 'bg-[--color-accent]/18 text-[--color-accent]'
              : 'text-[--color-ink-muted] hover:bg-[--color-surface-raised] hover:text-[--color-ink]',
          )}
        >
          {control.label}
        </button>
      ))}
    </div>
  );
}
