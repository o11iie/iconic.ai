'use client';

import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PanelSection } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { Relationship, SpatialObject } from '@/types/domain/spatial';
import { ObjectBreadcrumb, ObjectChildren, type BreadcrumbNode } from './ObjectBreadcrumb';
import { RelationshipList } from './RelationshipTrail';

/**
 * Context panel.
 *
 * Driven entirely by a real `SpatialObject` resolved through the registry —
 * never by a mesh name, and never by reading three.js userData. Every field is
 * rendered only when the model actually supplies it, so a model that ships
 * geometry without descriptive content shows the structural facts and says
 * nothing more.
 *
 * The study actions are not yet implemented, but they already receive the full
 * semantic context, so wiring them later is a change of handler rather than a
 * change of architecture.
 */

export type ContextAction = 'explain' | 'quiz' | 'flashcard' | 'note' | 'review';

/** What an action handler receives. Complete semantic context, no mesh data. */
export interface ContextActionPayload {
  readonly action: ContextAction;
  readonly semanticId: SemanticId;
  readonly object: SpatialObject | null;
  readonly ancestors: readonly SemanticId[];
  readonly relationships: readonly Relationship[];
}

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
  trail,
  childObjects,
  relationships,
  onSelectObject,
  onAction,
  actionsEnabled,
  className,
}: {
  readonly selectedId: SemanticId | null;
  readonly object: SpatialObject | null;
  /** Ancestry, root first, current structure last. */
  readonly trail: readonly BreadcrumbNode[];
  /** Named `childObjects`: this is data, not nested JSX. */
  readonly childObjects: readonly BreadcrumbNode[];
  readonly relationships: readonly Relationship[];
  readonly onSelectObject: (semanticId: SemanticId) => void;
  readonly onAction: (payload: ContextActionPayload) => void;
  readonly actionsEnabled: boolean;
  readonly className?: string;
}) {
  if (!selectedId) {
    return (
      <div className={cn('flex h-full flex-col justify-center', className)}>
        <EmptyState
          title="Select a structure to explore"
          description="Choose a structure in the viewport to see what it is, how it connects, and to turn it into recall material."
          className="border-0 bg-transparent"
          icon={<Icon name="select" size={22} />}
        />
      </div>
    );
  }

  const label = object?.name ?? semanticIdToLabel(selectedId);
  const latinName = typeof object?.metadata.latinName === 'string' ? object.metadata.latinName : null;
  const clinicalNotes = Array.isArray(object?.metadata.clinicalNotes)
    ? (object.metadata.clinicalNotes as unknown[]).filter(
        (note): note is string => typeof note === 'string',
      )
    : [];
  const externalIds =
    object?.metadata.externalIds && typeof object.metadata.externalIds === 'object'
      ? (object.metadata.externalIds as Record<string, string>)
      : {};

  function emit(action: ContextAction) {
    if (!selectedId) return;
    onAction({
      action,
      semanticId: selectedId,
      object,
      ancestors: trail.slice(0, -1).map((node) => node.semanticId),
      relationships,
    });
  }

  return (
    <div className={cn('flex h-full flex-col gap-5 overflow-y-auto', className)}>
      <header className="flex flex-col gap-2">
        {trail.length > 1 ? <ObjectBreadcrumb trail={trail} onSelect={onSelectObject} /> : null}

        <h2 className="text-lg font-semibold leading-tight tracking-tight text-ink">{label}</h2>

        {latinName ? <p className="text-xs italic text-ink-subtle">{latinName}</p> : null}

        <div className="flex flex-wrap gap-1.5">
          {object?.kind ? <Badge>{object.kind}</Badge> : null}
          {object?.system ? <Badge tone="accent">{object.system}</Badge> : null}
          {object?.region ? <Badge>{object.region}</Badge> : null}
        </div>

        <code className="mt-1 block break-all font-mono text-[10px] text-cyan">{selectedId}</code>
      </header>

      {/* Actions sit high: they are why a learner selected something. */}
      <PanelSection label="Study this">
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={!actionsEnabled}
              onClick={() => emit(action.id)}
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

      {object?.description ? (
        <PanelSection label="Description">
          <p className="text-sm leading-relaxed text-ink-muted">{object.description}</p>
        </PanelSection>
      ) : null}

      {clinicalNotes.length > 0 ? (
        <PanelSection label="Notes">
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            {clinicalNotes.map((note) => (
              <li key={note} className="text-sm leading-relaxed text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <PanelSection label="Contains">
        <ObjectChildren items={childObjects} onSelect={onSelectObject} />
      </PanelSection>

      <PanelSection label="Related structures">
        <RelationshipList relationships={relationships} onSelect={onSelectObject} />
      </PanelSection>

      {object && object.synonyms.length > 0 ? (
        <PanelSection label="Also known as">
          <p className="text-sm text-ink-muted">{object.synonyms.join(', ')}</p>
        </PanelSection>
      ) : null}

      {Object.keys(externalIds).length > 0 ? (
        <PanelSection label="Cross-references">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {Object.entries(externalIds).map(([vocabulary, value]) => (
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
