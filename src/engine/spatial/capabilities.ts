import type { SpatialCapabilities, SpatialModelGraph } from '@/types/domain/spatial';
import { peelSequence } from './layers';

/**
 * Capability discovery.
 *
 * What the interface may offer is decided by what the loaded model can
 * actually support, not by which buttons exist. A peel control on a model with
 * one layer has nothing to peel; an explode control on a model with no declared
 * offsets would move nothing. Both are the kind of dead control that teaches a
 * learner to distrust the whole tool.
 *
 * Capability is DERIVED from the graph. A model may then switch something off
 * — a licence that forbids dissection, an asset whose geometry does not come
 * apart cleanly — but it can never switch something on. A manifest cannot
 * assert its way into a feature it has no data for.
 */

export const NO_CAPABILITIES: SpatialCapabilities = {
  supportsLayers: false,
  supportsIsolation: false,
  supportsGhosting: false,
  supportsPeeling: false,
  supportsDissection: false,
  supportsExplosion: false,
  supportsReconstruction: false,
};

/** What the graph's own structure makes possible. */
export function deriveCapabilities(graph: SpatialModelGraph | null): SpatialCapabilities {
  if (!graph || graph.objects.size === 0) return NO_CAPABILITIES;

  const hasLayers = graph.layers.length > 0;

  // Peeling one layer is just hiding it. A peel needs somewhere to go.
  const canPeel = peelSequence(graph.layers).length >= 2;

  // Isolation and dissection are only meaningful with something to set apart
  // from, or something left behind once a structure is removed.
  const hasSeveralObjects = graph.objects.size > 1;

  const canExplode =
    (graph.explosion?.some((group) => group.objectIds.length > 0) ?? false) ||
    [...graph.objects.values()].some((object) => hasOffset(object.explodedOffset));

  const capabilities: SpatialCapabilities = {
    supportsLayers: hasLayers,
    supportsIsolation: hasSeveralObjects,
    // Anything that renders can be de-emphasised; ghosting needs no model data.
    supportsGhosting: true,
    supportsPeeling: canPeel,
    supportsDissection: hasSeveralObjects,
    supportsExplosion: canExplode,
    supportsReconstruction: false,
  };

  return {
    ...capabilities,
    // Reconstruction is the reverse of manipulation, so it is available
    // exactly when there is something a learner could have taken apart.
    supportsReconstruction:
      capabilities.supportsIsolation ||
      capabilities.supportsDissection ||
      capabilities.supportsLayers ||
      capabilities.supportsPeeling,
  };
}

/**
 * Derived capability, narrowed by whatever the model declares.
 *
 * Only `false` in the declaration has any effect.
 */
export function resolveCapabilities(graph: SpatialModelGraph | null): SpatialCapabilities {
  const derived = deriveCapabilities(graph);
  const declared = graph?.model.capabilities;
  if (!declared) return derived;

  const narrowed: Record<string, boolean> = { ...derived };
  for (const [key, value] of Object.entries(declared)) {
    if (value === false) narrowed[key] = false;
  }
  return narrowed as unknown as SpatialCapabilities;
}

function hasOffset(offset: readonly number[] | null | undefined): boolean {
  return Boolean(offset && offset.some((component) => component !== 0));
}
