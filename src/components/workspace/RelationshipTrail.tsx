'use client';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { Relationship } from '@/types/domain/spatial';

/**
 * Relationship visualisation.
 *
 * A reusable UI pattern over the domain relationship system — it renders
 * whatever edges a provider supplies and knows nothing about any particular
 * subject. It hard-codes no anatomy: with no relationships loaded it renders
 * an honest empty line rather than an invented chain.
 *
 * Two shapes:
 *   `trail` — an ordered path, e.g. A → B → C
 *   `list`  — typed edges from one structure, grouped by relationship kind
 */

export function RelationshipTrail({
  nodes,
  onSelect,
  className,
}: {
  readonly nodes: readonly SemanticId[];
  readonly onSelect?: (id: SemanticId) => void;
  readonly className?: string;
}) {
  if (nodes.length === 0) return null;

  return (
    <ol className={cn('flex flex-wrap items-center gap-x-1 gap-y-1.5', className)}>
      {nodes.map((node, index) => (
        <li key={node} className="flex items-center gap-1">
          {index > 0 ? (
            <Icon name="chevronRight" size={13} className="text-ink-faint" />
          ) : null}
          <button
            type="button"
            onClick={() => onSelect?.(node)}
            disabled={!onSelect}
            className={cn(
              'rounded-md px-1.5 py-0.5 text-xs transition-colors',
              index === nodes.length - 1
                ? 'font-medium text-ink'
                : 'text-ink-subtle',
              onSelect && 'hover:bg-surface-raised hover:text-cyan',
            )}
          >
            {semanticIdToLabel(node)}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function RelationshipList({
  relationships,
  onSelect,
  emptyLabel = 'No relationships are defined for this structure.',
}: {
  readonly relationships: readonly Relationship[];
  readonly onSelect?: (id: SemanticId) => void;
  readonly emptyLabel?: string;
}) {
  if (relationships.length === 0) {
    return <p className="text-xs leading-relaxed text-ink-faint">{emptyLabel}</p>;
  }

  // Group by kind so "supplies" and "drains" read as distinct relationships
  // rather than one undifferentiated list.
  const grouped = new Map<string, Relationship[]>();
  for (const relationship of relationships) {
    const bucket = grouped.get(relationship.kind) ?? [];
    bucket.push(relationship);
    grouped.set(relationship.kind, bucket);
  }

  return (
    <div className="flex flex-col gap-3">
      {[...grouped.entries()].map(([kind, edges]) => (
        <div key={kind} className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            {kind.replace(/_/g, ' ')}
          </span>
          <ul className="flex flex-col">
            {edges.map((edge) => (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(edge.targetId)}
                  disabled={!onSelect}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    'text-ink-muted transition-colors',
                    onSelect && 'hover:bg-surface-raised hover:text-ink',
                  )}
                >
                  <Icon name="link" size={13} className="shrink-0 text-ink-faint" />
                  <span className="truncate">
                    {edge.label ?? semanticIdToLabel(edge.targetId)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
