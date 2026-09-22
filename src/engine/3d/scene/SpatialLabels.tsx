'use client';

import { Html } from '@react-three/drei';
import type { PositionedAnnotation, SpatialLabel } from '@/engine/spatial/annotations';

/**
 * Structure labels.
 *
 * Drawn as DOM over the canvas rather than as 3D text. Three reasons, in
 * order: a label has to stay legible at any camera distance, which billboarded
 * geometry does not; it has to be readable by a screen reader, and the canvas
 * is `aria-hidden`; and it has to be selectable text, because a learner
 * copying a structure's name into a search is a real thing people do.
 *
 * Positions come from the controller, which resolves them from each object's
 * live bounds. Nothing here knows where anything is, and no label carries a
 * hard-coded coordinate — that would be wrong the moment the asset is
 * re-exported.
 *
 * Labels that belong to a structure the learner has hidden, dissected or
 * peeled away are already absent from this list: a name floating over nothing
 * is worse than no name.
 */
export function SpatialLabels({
  labels,
  selectedId,
  onSelect,
}: {
  readonly labels: readonly PositionedAnnotation<SpatialLabel>[];
  readonly selectedId: string | null;
  readonly onSelect: (semanticId: string) => void;
}) {
  if (labels.length === 0) return null;

  return (
    <>
      {labels.map(({ annotation, position }) => {
        const isSelected = annotation.semanticId === selectedId;

        return (
          <Html
            key={annotation.id}
            position={[position[0], position[1], position[2]]}
            center
            // Depth-tested so a label behind geometry fades rather than
            // floating in front of the structure that occludes it.
            occlude={false}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'auto' }}
          >
            <button
              type="button"
              data-veo-label={annotation.semanticId}
              onClick={() => onSelect(annotation.semanticId)}
              className={[
                'veo-glass whitespace-nowrap rounded-md px-1.5 py-0.5',
                'text-[10px] font-medium leading-none tracking-tight',
                'transition-colors duration-150',
                isSelected ? 'text-accent ring-1 ring-accent/50' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {annotation.name}
            </button>
          </Html>
        );
      })}
    </>
  );
}
