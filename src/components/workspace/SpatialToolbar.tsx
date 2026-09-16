'use client';

import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import type { IconName } from '@/components/ui/Icon';
import type { InteractionMode } from '@/engine/spatial/types';

/**
 * Spatial toolbar.
 *
 * Every tool here maps to a real provider or engine operation. Tools the
 * active provider cannot perform are disabled with an explanation rather than
 * silently doing nothing — a dead control is worse than an absent one.
 *
 * Vertical on desktop (it frames the viewport without stealing width),
 * horizontal on mobile (it sits above the canvas within thumb reach).
 */

export type WorkspaceTool = 'select' | 'orbit' | 'layers' | 'isolate' | 'reset';

interface ToolDef {
  readonly id: WorkspaceTool;
  readonly icon: IconName;
  readonly label: string;
  readonly hint: string;
  /** Modes set the pointer behaviour; actions fire once. */
  readonly kind: 'mode' | 'panel' | 'action';
  readonly mode?: InteractionMode;
}

const TOOLS: readonly ToolDef[] = [
  {
    id: 'select',
    icon: 'select',
    label: 'Select',
    hint: 'Click a structure to inspect it',
    kind: 'mode',
    mode: 'inspect',
  },
  {
    id: 'orbit',
    icon: 'orbit',
    label: 'Explore',
    hint: 'Move the camera without changing selection',
    kind: 'mode',
    mode: 'orbit',
  },
  { id: 'layers', icon: 'layers', label: 'Layers', hint: 'Show and hide layers', kind: 'panel' },
  {
    id: 'isolate',
    icon: 'isolate',
    label: 'Isolate',
    hint: 'Show only the selected structure, ghosting its surroundings',
    kind: 'action',
  },
  { id: 'reset', icon: 'reset', label: 'Reset', hint: 'Frame the whole model', kind: 'action' },
];

export function SpatialToolbar({
  mode,
  onModeChange,
  onIsolate,
  onReset,
  onToggleLayers,
  layersOpen,
  canIsolate,
  hasSelection,
  disabled = false,
  className,
}: {
  readonly mode: InteractionMode;
  readonly onModeChange: (mode: InteractionMode) => void;
  readonly onIsolate: () => void;
  readonly onReset: () => void;
  readonly onToggleLayers: () => void;
  readonly layersOpen: boolean;
  readonly canIsolate: boolean;
  readonly hasSelection: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Spatial tools"
      aria-orientation="vertical"
      className={cn(
        // A surface of its own: on obsidian the rail otherwise reads as empty
        // space with floating glyphs rather than a tool column.
        'flex shrink-0 items-center gap-1 border-hairline bg-surface/40 p-1.5',
        'flex-row justify-center border-b md:w-[3.25rem] md:flex-col md:justify-start md:border-b-0 md:border-r',
        className,
      )}
    >
      {TOOLS.map((tool) => {
        const isActiveMode = tool.kind === 'mode' && tool.mode === mode;
        const isActivePanel = tool.kind === 'panel' && layersOpen;

        const toolDisabled =
          disabled ||
          (tool.id === 'isolate' && (!canIsolate || !hasSelection));

        const hint =
          tool.id === 'isolate' && !canIsolate
            ? 'This provider does not support isolation'
            : tool.id === 'isolate' && !hasSelection
              ? 'Select a structure first'
              : tool.hint;

        return (
          <Tooltip key={tool.id} content={hint} side="right">
            <IconButton
              icon={tool.icon}
              label={tool.label}
              active={isActiveMode || isActivePanel}
              disabled={toolDisabled}
              onClick={() => {
                if (tool.kind === 'mode' && tool.mode) onModeChange(tool.mode);
                if (tool.kind === 'panel') onToggleLayers();
                if (tool.id === 'isolate') onIsolate();
                if (tool.id === 'reset') onReset();
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
