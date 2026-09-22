'use client';

import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import type { IconName } from '@/components/ui/Icon';
import type { InteractionMode } from '@/engine/spatial/types';
import type { SpatialCapabilities } from '@/types/domain/spatial';

/**
 * Spatial toolbar.
 *
 * Every tool maps to a real engine operation on the loaded model. What appears
 * is decided by the model's own capabilities, not by this list: a peel control
 * on a model with one layer would have nothing to peel, and a control that
 * does nothing teaches a learner to distrust the whole tool. A capability the
 * model lacks is hidden; a capability it has but that needs a selection first
 * is shown disabled, with the reason.
 *
 * Vertical on desktop (it frames the viewport without stealing width),
 * horizontal on mobile (it sits above the canvas within thumb reach).
 */

export type WorkspaceTool =
  | 'select'
  | 'orbit'
  | 'layers'
  | 'isolate'
  | 'peel'
  | 'dissect'
  | 'explode'
  | 'labels'
  | 'reset';

export interface ToolbarState {
  readonly mode: InteractionMode;
  readonly capabilities: SpatialCapabilities;
  readonly hasSelection: boolean;
  readonly layersOpen: boolean;
  readonly isolated: boolean;
  readonly exploded: boolean;
  readonly peelLevel: number;
  readonly peelSteps: number;
  readonly labelsOn: boolean;
}

interface ToolDef {
  readonly id: WorkspaceTool;
  readonly icon: IconName;
  readonly label: string;
  readonly hint: string;
  /** Modes set the pointer behaviour; panels open UI; actions fire once. */
  readonly kind: 'mode' | 'panel' | 'action';
  readonly mode?: InteractionMode;
  /** Whether the loaded model supports this tool at all. */
  readonly available: (state: ToolbarState) => boolean;
  /** Whether it can be used right now. */
  readonly enabled?: (state: ToolbarState) => boolean;
  /** Replacement hint when it cannot be used right now. */
  readonly blockedHint?: string;
  readonly active?: (state: ToolbarState) => boolean;
}

const TOOLS: readonly ToolDef[] = [
  {
    id: 'select',
    icon: 'select',
    label: 'Select',
    hint: 'Click a structure to inspect it',
    kind: 'mode',
    mode: 'inspect',
    available: () => true,
    active: (state) => state.mode === 'inspect',
  },
  {
    id: 'orbit',
    icon: 'orbit',
    label: 'Explore',
    hint: 'Move the camera without changing selection',
    kind: 'mode',
    mode: 'orbit',
    available: () => true,
    active: (state) => state.mode === 'orbit',
  },
  {
    id: 'layers',
    icon: 'layers',
    label: 'Layers',
    hint: 'Show, hide and ghost layers',
    kind: 'panel',
    available: (state) => state.capabilities.supportsLayers,
    active: (state) => state.layersOpen,
  },
  {
    id: 'isolate',
    icon: 'isolate',
    label: 'Isolate',
    hint: 'Show only the selected structure, ghosting its surroundings',
    kind: 'action',
    available: (state) => state.capabilities.supportsIsolation,
    enabled: (state) => state.hasSelection || state.isolated,
    blockedHint: 'Select a structure first',
    active: (state) => state.isolated,
  },
  {
    id: 'peel',
    icon: 'peel',
    label: 'Peel',
    hint: 'Take away the next layer to reveal what sits beneath',
    kind: 'action',
    available: (state) => state.capabilities.supportsPeeling,
    active: (state) => state.peelLevel > 0,
  },
  {
    id: 'dissect',
    icon: 'dissect',
    label: 'Dissect',
    hint: 'Remove the selected structure to see what it covers',
    kind: 'action',
    available: (state) => state.capabilities.supportsDissection,
    enabled: (state) => state.hasSelection,
    blockedHint: 'Select a structure first',
  },
  {
    id: 'explode',
    icon: 'explode',
    label: 'Explode',
    hint: 'Separate the model into its parts',
    kind: 'action',
    available: (state) => state.capabilities.supportsExplosion,
    active: (state) => state.exploded,
  },
  {
    id: 'labels',
    icon: 'note',
    label: 'Labels',
    hint: 'Name the structures on screen',
    kind: 'action',
    available: (state) => state.capabilities.supportsLabels,
    active: (state) => state.labelsOn,
  },
  {
    id: 'reset',
    icon: 'reset',
    label: 'Reset',
    hint: 'Put the model back together and reframe it',
    kind: 'action',
    available: () => true,
  },
];

export function SpatialToolbar({
  state,
  onModeChange,
  onAction,
  disabled = false,
  className,
}: {
  readonly state: ToolbarState;
  readonly onModeChange: (mode: InteractionMode) => void;
  readonly onAction: (tool: WorkspaceTool) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const tools = TOOLS.filter((tool) => tool.available(state));

  return (
    <div
      role="toolbar"
      aria-label="Spatial tools"
      aria-orientation="vertical"
      className={cn(
        // A surface of its own: on obsidian the rail otherwise reads as empty
        // space with floating glyphs rather than a tool column.
        'flex shrink-0 items-center gap-1 border-hairline bg-surface/40 p-1.5',
        'flex-row justify-center overflow-x-auto border-b md:w-[3.25rem] md:flex-col md:justify-start md:overflow-visible md:border-b-0 md:border-r',
        className,
      )}
    >
      {tools.map((tool) => {
        const usable = tool.enabled ? tool.enabled(state) : true;
        const toolDisabled = disabled || !usable;
        const hint = !usable && tool.blockedHint ? tool.blockedHint : tool.hint;

        const label =
          tool.id === 'peel' && state.peelSteps > 0
            ? `${tool.label} (${state.peelLevel}/${state.peelSteps})`
            : tool.label;

        return (
          <Tooltip key={tool.id} content={hint} side="right">
            <IconButton
              icon={tool.icon}
              label={label}
              active={tool.active?.(state) ?? false}
              disabled={toolDisabled}
              onClick={() => {
                if (tool.kind === 'mode' && tool.mode) {
                  onModeChange(tool.mode);
                  return;
                }
                onAction(tool.id);
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
