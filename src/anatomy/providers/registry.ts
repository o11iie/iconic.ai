import { env } from '@/config/env';
import {
  getSpatialProvider,
  hasSpatialProvider,
  listSpatialProviders,
  registerSpatialProvider,
} from '@/engine/spatial/registry';
import type { SpatialProviderFactory } from '@/engine/spatial/provider';
import { VeoError } from '@/lib/errors';
import { isAnatomyProvider, type AnatomyProvider } from './anatomy-provider';
import { GltfAnatomyProvider } from './gltf-anatomy-provider';

/**
 * Anatomy provider wiring.
 *
 * Adding a licensed anatomy SDK later means implementing `AnatomyProvider`
 * and pushing one factory into `ANATOMY_PROVIDER_FACTORIES`. No viewport,
 * store or route changes are required — which is the entire point of the
 * provider abstraction.
 */
export const ANATOMY_PROVIDER_FACTORIES: readonly SpatialProviderFactory[] = [
  {
    id: 'gltf-asset',
    label: 'Licensed GLB/GLTF assets',
    description:
      'Renders licensed anatomy assets through VEO’s own engine, using a semantic mapping manifest to translate vendor mesh names into permanent VEO identities.',
    create: () => new GltfAnatomyProvider(),
  },
];

let registered = false;

/** Idempotent registration. Safe to call from any entry point. */
export function registerAnatomyProviders(): void {
  if (registered) return;
  for (const factory of ANATOMY_PROVIDER_FACTORIES) {
    if (!hasSpatialProvider(factory.id)) registerSpatialProvider(factory);
  }
  registered = true;
}

/** Test helper: allow re-registration after `resetSpatialProviders()`. */
export function markAnatomyProvidersUnregistered(): void {
  registered = false;
}

/**
 * Resolve the anatomy provider selected by configuration.
 * Throws only on misconfiguration (an unknown provider id), which is a
 * deployment bug that must be visible rather than silently degraded.
 */
export function getAnatomyProvider(providerId?: string): AnatomyProvider {
  registerAnatomyProviders();

  const id = providerId ?? env.NEXT_PUBLIC_ANATOMY_PROVIDER;
  const provider = getSpatialProvider(id);

  if (!isAnatomyProvider(provider)) {
    throw new VeoError(
      `Spatial provider "${id}" is registered but does not implement AnatomyProvider.`,
      { code: 'provider_not_configured', context: { providerId: id } },
    );
  }

  return provider;
}

export function listAnatomyProviders(): readonly SpatialProviderFactory[] {
  registerAnatomyProviders();
  return listSpatialProviders();
}
