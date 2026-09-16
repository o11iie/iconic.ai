'use client';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * Camera controls, rendered outside the canvas.
 *
 * The canvas is `aria-hidden` and cannot be navigated with a keyboard, so
 * every camera action a learner needs is also a real focusable button here.
 * This is the non-pointer path: reset, fit the model, fit the selection and
 * clear the selection are all reachable by tab and enter.
 *
 * Deliberately not a claim that the geometry itself is screen-reader
 * navigable — it is not. This makes the *controls* accessible, and the
 * selection state is announced separately through a live region.
 */
export function ViewportControls({
  onResetView,
  onFitModel,
  onFitSelection,
  onClearSelection,
  hasSelection,
  className,
}: {
  readonly onResetView: () => void;
  readonly onFitModel: () => void;
  readonly onFitSelection: () => void;
  readonly onClearSelection: () => void;
  readonly hasSelection: boolean;
  readonly className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Camera controls"
      aria-orientation="horizontal"
      className={cn('veo-glass flex items-center gap-1 rounded-xl p-1', className)}
    >
      <ControlButton icon="reset" label="Reset view" onClick={onResetView} />
      <ControlButton icon="explore" label="Fit model" onClick={onFitModel} />
      <ControlButton
        icon="isolate"
        label="Fit selection"
        onClick={onFitSelection}
        disabled={!hasSelection}
        disabledHint="Select a structure first"
      />
      <ControlButton
        icon="close"
        label="Clear selection"
        onClick={onClearSelection}
        disabled={!hasSelection}
        disabledHint="Nothing is selected"
      />
    </div>
  );
}

function ControlButton({
  icon,
  label,
  onClick,
  disabled = false,
  disabledHint,
}: {
  readonly icon: 'reset' | 'explore' | 'isolate' | 'close';
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly disabledHint?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? (disabledHint ?? label) : label}
      className="gap-1.5 whitespace-nowrap"
    >
      <Icon name={icon} size={14} />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden veo-sr-only">{label}</span>
    </Button>
  );
}
