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
import { HostedAnatomyProvider } from './hosted-anatomy-provider';

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
      'Renders licensed anatomy assets through VEO’s own engine, using a semantic mapping manifest to translate vendor mesh names into permanent VEO identities. For assets served from a host the browser may read directly.',
    create: () => new GltfAnatomyProvider(),
  },
  {
    id: 'hosted',
    label: 'Hosted anatomy provider',
    description:
      'For licensed anatomy that authenticates. The browser asks VEO’s own server, which holds the credential and returns a validated manifest with a time-limited asset URL. No provider secret reaches the client.',
    create: () => new HostedAnatomyProvider(),
  },
];

/** Provider ids this build knows how to construct. */
export const ANATOMY_PROVIDER_IDS = ANATOMY_PROVIDER_FACTORIES.map((factory) => factory.id);

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

  /*
   * A provider id nothing implements is a deployment mistake, and the message
   * has to name the valid options: the alternative is an operator staring at
   * "not configured" with no idea what to type.
   */
  if (!hasSpatialProvider(id)) {
    throw new VeoError(
      `No anatomy provider is registered under "${id}". Set NEXT_PUBLIC_ANATOMY_PROVIDER to one of: ${ANATOMY_PROVIDER_IDS.join(', ')}.`,
      { code: 'provider_not_configured', context: { providerId: id } },
    );
  }

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
