'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

/**
 * Recall mode selection.
 *
 * Gate 2 builds the interface and the state architecture only. The scheduling
 * algorithm and question generation arrive in a later gate, so selecting a
 * mode sets state and shows the honest empty queue rather than starting a
 * session that cannot exist yet.
 *
 * `identify` is the mode only VEO can offer: the prompt is a question and the
 * answer is a structure you click in the model. It is already represented in
 * the domain types as the `identify_structure` question kind.
 */

export type RecallModeId = 'identify' | 'explain' | 'connect' | 'apply' | 'reconstruct';

const MODES: readonly {
  id: RecallModeId;
  label: string;
  icon: IconName;
  description: string;
  spatial: boolean;
}[] = [
  {
    id: 'identify',
    label: 'Identify',
    icon: 'select',
    description: 'Find and name the structure in the model.',
    spatial: true,
  },
  {
    id: 'explain',
    label: 'Explain',
    icon: 'sparkles',
    description: 'Say what it does, in your own words.',
    spatial: false,
  },
  {
    id: 'connect',
    label: 'Connect',
    icon: 'link',
    description: 'Trace how it relates to what sits around it.',
    spatial: true,
  },
  {
    id: 'apply',
    label: 'Apply',
    icon: 'quiz',
    description: 'Use it on a problem that looks like the real thing.',
    spatial: false,
  },
  {
    id: 'reconstruct',
    label: 'Reconstruct',
    icon: 'layers',
    description: 'Rebuild the structure from its parts.',
    spatial: true,
  },
];

export function RecallModes() {
  const [mode, setMode] = useState<RecallModeId>('identify');
  const active = MODES.find((item) => item.id === mode);

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Recall mode" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {MODES.map((item) => {
          const selected = item.id === mode;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(item.id)}
              className={cn(
                'flex h-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors duration-150',
                selected
                  ? 'border-accent/50 bg-accent/[0.07]'
                  : 'border-hairline bg-surface hover:border-hairline-strong',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'grid size-8 place-items-center rounded-lg',
                    selected
                      ? 'bg-accent/16 text-accent'
                      : 'bg-surface-raised text-ink-subtle',
                  )}
                >
                  <Icon name={item.icon} size={16} />
                </span>
                {item.spatial ? <Badge tone="cyan">3D</Badge> : null}
              </span>
              <span className="text-sm font-medium text-ink">{item.label}</span>
              <span className="text-xs leading-relaxed text-ink-subtle">
                {item.description}
              </span>
            </button>
          );
        })}
      </div>

      <EmptyState
        title="Nothing is due for recall yet"
        description={`Your ${active?.label.toLowerCase() ?? 'recall'} queue is built from real study history. It stays empty until you have studied something — VEO will not seed it with placeholder cards.`}
        icon={<Icon name="recall" size={22} />}
        action={
          <ButtonLink href="/explore" size="sm">
            Start exploring
          </ButtonLink>
        }
      />
    </div>
  );
}
