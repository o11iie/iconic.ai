import type { SemanticId } from '@/lib/semantic-id';
import type { LayerPeelMode, SpatialLayer } from '@/types/domain/spatial';

/**
 * Layer helpers.
 *
 * A layer is a meaningful grouping of spatial objects — a system, a shell, a
 * subassembly, a stratum. Nothing here knows which; the loaded model's
 * manifest decides what layers exist and what they are called.
 */

/** Defaults for a layer a model declares without manipulation metadata. */
export const LAYER_DEFAULTS = {
  opacity: 0.15,
  peelable: true,
  peelMode: 'ghost' as LayerPeelMode,
} as const;

export type LayerInput = Omit<SpatialLayer, 'opacity' | 'peelable' | 'peelMode'> &
  Partial<Pick<SpatialLayer, 'opacity' | 'peelable' | 'peelMode'>>;

/**
 * Complete a layer declaration.
 *
 * Manifests written before manipulation existed omit these fields, and a
 * layer missing them should behave sensibly rather than disable peeling for
 * the whole model.
 */
export function completeLayer(layer: LayerInput): SpatialLayer {
  return {
    ...layer,
    opacity: layer.opacity ?? LAYER_DEFAULTS.opacity,
    peelable: layer.peelable ?? LAYER_DEFAULTS.peelable,
    peelMode: layer.peelMode ?? LAYER_DEFAULTS.peelMode,
  };
}

/**
 * The order a peel works through, outermost first.
 *
 * Only peelable layers take part, and the sequence is the layers' own
 * priority. Ties break on id so the result never depends on array order.
 */
export function peelSequence(layers: readonly SpatialLayer[]): readonly SpatialLayer[] {
  return layers
    .filter((layer) => layer.peelable)
    .slice()
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order));
}

/**
 * Object to layers, indexed.
 *
 * Built once per model so a layer operation is a set lookup rather than a walk
 * over every object — the difference that matters on a model with tens of
 * thousands of parts.
 */
export function layerMembershipIndex(
  layers: readonly SpatialLayer[],
): ReadonlyMap<SemanticId, readonly string[]> {
  const index = new Map<SemanticId, string[]>();

  for (const layer of layers) {
    for (const objectId of layer.objectIds) {
      const existing = index.get(objectId);
      if (existing) {
        existing.push(layer.id);
      } else {
        index.set(objectId, [layer.id]);
      }
    }
  }

  return index;
}
