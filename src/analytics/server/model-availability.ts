import 'server-only';

import { resolveModelGraph } from '@/ai/context/model-resolver';

/**
 * Which models can actually be opened in the 3D workspace right now.
 *
 * ## Why this is resolved rather than assumed
 *
 * Analytics knows which model each learning item names. It does NOT know
 * whether that model can be loaded — that depends on the anatomy provider,
 * the catalogue and the licence, none of which are analytics' business.
 *
 * So availability is resolved here, server-side, through the same resolver the
 * tutor and the content generator use. With Gate 9 RED no licensed anatomy
 * source is configured and the honest answer for every anatomy model is "no".
 * That is not a degraded mode: a "View in 3D" button that fails when tapped is
 * worse than no button, and a dashboard that implied the model was there would
 * be making a claim about the deployment that is false.
 *
 * ## Why it is a set, resolved in one pass
 *
 * A learner's items may name a handful of models. Resolving each one per
 * recommendation, per knowledge-map node, would be dozens of identical
 * lookups per request.
 */

/** Never resolve more than this many distinct models for one request. */
const MAX_MODELS = 20;

export async function resolveAvailableModels(
  modelRefs: readonly (string | null)[],
): Promise<Set<string>> {
  const distinct = [...new Set(modelRefs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0))].slice(
    0,
    MAX_MODELS,
  );

  const available = new Set<string>();

  const results = await Promise.all(
    distinct.map(async (modelRef) => {
      try {
        const resolved = await resolveModelGraph(modelRef);
        return resolved.ok ? modelRef : null;
      } catch {
        // A provider that errors is a provider that cannot serve the model.
        // Treating a failure as availability would offer an action that
        // cannot be performed.
        return null;
      }
    }),
  );

  for (const modelRef of results) {
    if (modelRef !== null) available.add(modelRef);
  }

  return available;
}
