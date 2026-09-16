'use client';

import { ANATOMY_MODEL_CATALOG } from '@/anatomy/models/catalog';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { capabilities } from '@/config/env';
import { cn } from '@/lib/cn';

/**
 * Model switcher for the workspace top bar.
 *
 * The catalogue is honest about availability: entries whose licensed asset has
 * not been published are listed so the roadmap is visible, but are marked, and
 * selecting one produces an explicit "awaiting licensed asset" state rather
 * than fabricated geometry.
 */
export function ModelSwitcher({
  modelRef,
  onSelect,
}: {
  readonly modelRef: string | null;
  readonly onSelect: (modelRef: string) => void;
}) {
  const current = ANATOMY_MODEL_CATALOG.find((entry) => entry.modelRef === modelRef);

  const items: MenuItem[] = ANATOMY_MODEL_CATALOG.map((entry) => ({
    id: entry.modelRef,
    label: capabilities.spatialAssets ? entry.name : `${entry.name} — awaiting asset`,
    icon: 'explore',
    onSelect: () => onSelect(entry.modelRef),
  }));

  return (
    <Menu
      label="Switch model"
      align="start"
      items={items}
      trigger={({ open }) => (
        <span
          className={cn(
            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
            open ? 'bg-surface-raised' : 'hover:bg-surface-raised',
          )}
        >
          <Icon name="explore" size={16} className="text-ink-faint" />
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">
              {current?.name ?? 'Choose a model'}
            </span>
            <Badge tone="neutral">Anatomy</Badge>
          </span>
          <Icon name="chevronDown" size={14} className="text-ink-faint" />
        </span>
      )}
    />
  );
}
