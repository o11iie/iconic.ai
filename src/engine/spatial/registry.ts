import { VeoError } from '@/lib/errors';
import type { SpatialProvider, SpatialProviderFactory } from './provider';

/**
 * Provider registry.
 *
 * Providers register themselves by id; configuration selects one by name. This
 * is what keeps VEO from being wired to a single commercial vendor: adding a
 * new anatomy SDK means adding a factory here, not editing the viewport.
 */
const factories = new Map<string, SpatialProviderFactory>();
const instances = new Map<string, SpatialProvider>();

export function registerSpatialProvider(factory: SpatialProviderFactory): void {
  if (factories.has(factory.id)) {
    throw new VeoError(`Spatial provider "${factory.id}" is already registered.`, {
      code: 'validation_failed',
      context: { providerId: factory.id },
    });
  }
  factories.set(factory.id, factory);
}

export function listSpatialProviders(): readonly SpatialProviderFactory[] {
  return [...factories.values()];
}

export function hasSpatialProvider(id: string): boolean {
  return factories.has(id);
}

/** Get (and memoise) a provider instance by id. */
export function getSpatialProvider(id: string): SpatialProvider {
  const existing = instances.get(id);
  if (existing) return existing;

  const factory = factories.get(id);
  if (!factory) {
    const known = [...factories.keys()].join(', ') || '(none registered)';
    throw new VeoError(
      `Unknown spatial provider "${id}". Registered providers: ${known}.`,
      { code: 'provider_not_configured', context: { providerId: id } },
    );
  }

  const instance = factory.create();
  instances.set(id, instance);
  return instance;
}

/** Test/teardown helper. Disposes instances and clears registration. */
export function resetSpatialProviders(): void {
  for (const instance of instances.values()) instance.dispose();
  instances.clear();
  factories.clear();
}
