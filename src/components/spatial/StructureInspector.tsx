'use client';

import type { AnatomyStructureMetadata } from '@/anatomy/providers/anatomy-provider';
import type { Relationship } from '@/types/domain/spatial';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/states';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';

/**
 * Inspector for the currently selected structure.
 *
 * Renders only what the provider actually supplies. A model that ships geometry
 * without clinical description shows the geometry facts and says nothing more —
 * it never fills the gap with generated prose.
 */
export function StructureInspector({
  selectedId,
  metadata,
  relationships,
  onSelectRelated,
}: {
  readonly selectedId: SemanticId | null;
  readonly metadata: AnatomyStructureMetadata | null;
  readonly relationships: readonly Relationship[];
  readonly onSelectRelated: (id: SemanticId) => void;
}) {
  if (!selectedId) {
    return (
      <EmptyState
        title="Nothing selected"
        description="Click a structure in the viewport to inspect it, see its relationships, and fly the camera to it."
        className="border-0 bg-transparent p-6 text-left"
      />
    );
  }

  const label = metadata?.name ?? semanticIdToLabel(selectedId);

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-[--color-ink]">{label}</h2>
        {metadata?.latinName ? (
          <p className="mt-0.5 text-xs italic text-[--color-ink-subtle]">{metadata.latinName}</p>
        ) : null}
        <code className="mt-2 block break-all font-mono text-[11px] text-[--color-cyan]">
          {selectedId}
        </code>
      </div>

      {metadata && (metadata.system || metadata.region || metadata.laterality) ? (
        <div className="flex flex-wrap gap-1.5">
          {metadata.system ? <Badge tone="accent">{metadata.system}</Badge> : null}
          {metadata.region ? <Badge>{metadata.region}</Badge> : null}
          {metadata.laterality ? <Badge>{metadata.laterality}</Badge> : null}
        </div>
      ) : null}

      {metadata?.description ? (
        <p className="text-sm leading-relaxed text-[--color-ink-muted]">{metadata.description}</p>
      ) : null}

      {metadata && metadata.synonyms.length > 0 ? (
        <div>
          <h3 className="text-xs font-medium text-[--color-ink-subtle]">Also known as</h3>
          <p className="mt-1 text-sm text-[--color-ink-muted]">{metadata.synonyms.join(', ')}</p>
        </div>
      ) : null}

      {relationships.length > 0 ? (
        <div>
          <h3 className="text-xs font-medium text-[--color-ink-subtle]">Relationships</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {relationships.map((relationship) => (
              <li key={relationship.id}>
                <button
                  type="button"
                  onClick={() => onSelectRelated(relationship.targetId)}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-surface-raised]"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[--color-ink-faint]">
                    {relationship.kind}
                  </span>
                  <span className="text-[--color-ink-muted]">
                    {relationship.label ?? semanticIdToLabel(relationship.targetId)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {metadata && Object.keys(metadata.externalIds).length > 0 ? (
        <div>
          <h3 className="text-xs font-medium text-[--color-ink-subtle]">Cross-references</h3>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {Object.entries(metadata.externalIds).map(([vocabulary, value]) => (
              <div key={vocabulary} className="contents">
                <dt className="font-mono uppercase text-[--color-ink-faint]">{vocabulary}</dt>
                <dd className="text-[--color-ink-muted]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
