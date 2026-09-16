'use client';

import type { AnatomyStructureMetadata } from '@/anatomy/providers/anatomy-provider';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PanelSection } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { semanticIdAncestors, semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { Relationship, SpatialObject } from '@/types/domain/spatial';
import { RelationshipList, RelationshipTrail } from './RelationshipTrail';

/**
 * Context panel.
 *
 * Renders the selected object and the actions available on it. Deliberately
 * driven entirely by a real `SpatialObject` plus optional provider metadata:
 * every field is rendered only when the provider actually supplies it, and
 * nothing is generated to fill a gap. A model that ships geometry without
 * clinical description shows the geometry facts and says nothing more.
 */

export type ContextAction = 'explain' | 'quiz' | 'flashcard' | 'note' | 'review';

const ACTIONS: readonly { id: ContextAction; icon: IconName; label: string }[] = [
  { id: 'explain', icon: 'sparkles', label: 'AI Explain' },
  { id: 'quiz', icon: 'quiz', label: 'Quiz Me' },
  { id: 'flashcard', icon: 'flashcard', label: 'Flashcard' },
  { id: 'note', icon: 'note', label: 'Add Note' },
  { id: 'review', icon: 'clock', label: 'Review Later' },
];

export function ContextPanel({
  selectedId,
  object,
  metadata,
  relationships,
  onSelectRelated,
  onAction,
  actionsEnabled,
  className,
}: {
  readonly selectedId: SemanticId | null;
  readonly object: SpatialObject | null;
  readonly metadata: AnatomyStructureMetadata | null;
  readonly relationships: readonly Relationship[];
  readonly onSelectRelated: (id: SemanticId) => void;
  readonly onAction: (action: ContextAction) => void;
  /** False when no model is loaded, so actions have nothing to act on. */
  readonly actionsEnabled: boolean;
  readonly className?: string;
}) {
  if (!selectedId) {
    return (
      <div className={cn('flex h-full flex-col justify-center', className)}>
        <EmptyState
          title="Nothing selected"
          description="Choose a structure in the viewport to see what it is, how it connects, and to turn it into recall material."
          className="border-0 bg-transparent"
          icon={<Icon name="select" size={22} />}
        />
      </div>
    );
  }

  const label = metadata?.name ?? object?.name ?? semanticIdToLabel(selectedId);
  const ancestors = [...semanticIdAncestors(selectedId)].reverse();

  return (
    <div className={cn('flex h-full flex-col gap-5 overflow-y-auto', className)}>
      <header className="flex flex-col gap-2">
        {ancestors.length > 0 ? (
          <RelationshipTrail nodes={[...ancestors, selectedId]} onSelect={onSelectRelated} />
        ) : null}

        <h2 className="text-lg font-semibold leading-tight tracking-tight text-ink">
          {label}
        </h2>

        {metadata?.latinName ? (
          <p className="text-xs italic text-ink-subtle">{metadata.latinName}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {object?.kind ? <Badge>{object.kind}</Badge> : null}
          {metadata?.system ? <Badge tone="accent">{metadata.system}</Badge> : null}
          {metadata?.region ? <Badge>{metadata.region}</Badge> : null}
          {metadata?.laterality ? <Badge>{metadata.laterality}</Badge> : null}
        </div>

        <code className="mt-1 block break-all font-mono text-[10px] text-cyan">
          {selectedId}
        </code>
      </header>

      {/* Actions sit high: they are why a learner selected something. */}
      <PanelSection label="Study this">
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={!actionsEnabled}
              onClick={() => onAction(action.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-2',
                'text-left text-xs font-medium text-ink-muted transition-colors duration-150',
                'hover:border-hairline-strong hover:text-ink',
                'disabled:cursor-not-allowed disabled:opacity-40',
                action.id === 'explain' && 'col-span-2 text-cyan',
              )}
            >
              <Icon name={action.icon} size={15} />
              {action.label}
            </button>
          ))}
        </div>
      </PanelSection>

      {metadata?.description ? (
        <PanelSection label="Description">
          <p className="text-sm leading-relaxed text-ink-muted">{metadata.description}</p>
        </PanelSection>
      ) : null}

      {object?.description && !metadata?.description ? (
        <PanelSection label="Description">
          <p className="text-sm leading-relaxed text-ink-muted">{object.description}</p>
        </PanelSection>
      ) : null}

      {metadata && metadata.clinicalNotes.length > 0 ? (
        <PanelSection label="Notes">
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            {metadata.clinicalNotes.map((note) => (
              <li key={note} className="text-sm leading-relaxed text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <PanelSection label="Relationships">
        <RelationshipList relationships={relationships} onSelect={onSelectRelated} />
      </PanelSection>

      {metadata && metadata.synonyms.length > 0 ? (
        <PanelSection label="Also known as">
          <p className="text-sm text-ink-muted">{metadata.synonyms.join(', ')}</p>
        </PanelSection>
      ) : null}

      {metadata && Object.keys(metadata.externalIds).length > 0 ? (
        <PanelSection label="Cross-references">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {Object.entries(metadata.externalIds).map(([vocabulary, value]) => (
              <div key={vocabulary} className="contents">
                <dt className="font-mono uppercase text-ink-faint">{vocabulary}</dt>
                <dd className="text-ink-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </PanelSection>
      ) : null}
    </div>
  );
}
