'use client';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';

/**
 * Hierarchy breadcrumb.
 *
 * A generic renderer over whatever ancestry the registry reports. It holds no
 * subject vocabulary: given a chain it draws the chain, whether that chain
 * reads "Test Scene → System A → Object 1" or "Human Body → Skeletal System →
 * Pelvis → Hip → Acetabulum".
 *
 * Labels come from the model's own descriptors; the semantic id is only a
 * fallback for a structure the model named nothing.
 */

export interface BreadcrumbNode {
  readonly semanticId: SemanticId;
  readonly name: string | null;
}

export function ObjectBreadcrumb({
  trail,
  onSelect,
  className,
}: {
  /** Root first, current structure last. */
  readonly trail: readonly BreadcrumbNode[];
  readonly onSelect?: (semanticId: SemanticId) => void;
  readonly className?: string;
}) {
  if (trail.length === 0) return null;

  return (
    <nav aria-label="Structure hierarchy" className={className}>
      <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {trail.map((node, index) => {
          const isCurrent = index === trail.length - 1;
          const label = node.name ?? semanticIdToLabel(node.semanticId);

          return (
            <li key={node.semanticId} className="flex items-center gap-0.5">
              {index > 0 ? (
                <Icon name="chevronRight" size={12} className="text-ink-faint" aria-hidden="true" />
              ) : null}

              {isCurrent ? (
                <span aria-current="true" className="px-1 text-xs font-medium text-ink">
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect?.(node.semanticId)}
                  disabled={!onSelect}
                  className={cn(
                    'rounded px-1 py-0.5 text-xs text-ink-subtle transition-colors',
                    onSelect && 'hover:bg-surface-raised hover:text-cyan',
                  )}
                >
                  {label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Child navigation, rendered beneath the current structure. */
export function ObjectChildren({
  items,
  onSelect,
  emptyLabel = 'This structure has no sub-structures.',
}: {
  /** Named `items` rather than `children`: this is data, not nested JSX. */
  readonly items: readonly BreadcrumbNode[];
  readonly onSelect?: (semanticId: SemanticId) => void;
  readonly emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs leading-relaxed text-ink-faint">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col">
      {items.map((child) => (
        <li key={child.semanticId}>
          <button
            type="button"
            onClick={() => onSelect?.(child.semanticId)}
            disabled={!onSelect}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
              'text-ink-muted transition-colors',
              onSelect && 'hover:bg-surface-raised hover:text-ink',
            )}
          >
            <Icon name="chevronRight" size={12} className="shrink-0 text-ink-faint" />
            <span className="truncate">
              {child.name ?? semanticIdToLabel(child.semanticId)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
