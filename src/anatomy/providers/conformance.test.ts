import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import { isObservableProvider, type ProviderSnapshot } from '@/engine/spatial/base-provider';
import { GltfAnatomyProvider } from './gltf-anatomy-provider';
import { HostedAnatomyProvider } from './hosted-anatomy-provider';
import type { AnatomyProvider } from './anatomy-provider';
import {
  CONFORMANCE_IDS,
  CONFORMANCE_MESH_NAMES,
  CONFORMANCE_NAMESPACE,
  conformanceManifest,
} from '../fixtures/conformance-manifest';
import { ANATOMY_MODEL_CATALOG } from '../models/catalog';

/**
 * Provider conformance
 * ====================
 *
 * The contract every `AnatomyProvider` implementation must satisfy, run
 * against each one in turn. A provider that passes this behaves
 * interchangeably with the others from the application's point of view, which
 * is the entire promise of the abstraction: swap the vendor, keep the product.
 *
 * Driven by a controlled fixture (see `fixtures/conformance-manifest.ts`),
 * which is test content and not a model of any body structure.
 *
 * Adding a provider means adding one entry to `PROVIDERS` below. If it cannot
 * pass this suite it is not ready to serve a learner.
 */

/**
 * Engine state for a provider that renders through VEO's scene.
 *
 * Asserting observability here is part of the contract: a provider that
 * renders into VEO's scene but cannot be subscribed to would leave the
 * viewport unable to react to anything the provider did.
 */
function snapshotOf(provider: AnatomyProvider): ProviderSnapshot {
  if (!isObservableProvider(provider)) {
    throw new Error(`${provider.id} renders into VEO's scene but is not observable.`);
  }
  return provider.getSnapshot();
}

const MODEL_REF = 'conformance';
const A1 = CONFORMANCE_IDS.structureA1 as SemanticId;
const A2 = CONFORMANCE_IDS.structureA2 as SemanticId;
const B1 = CONFORMANCE_IDS.structureB1 as SemanticId;
const GROUP_A = CONFORMANCE_IDS.groupA as SemanticId;
const ROOT = CONFORMANCE_IDS.root as SemanticId;

interface ProviderCase {
  readonly name: string;
  /** Build a provider wired to the fixture, however that provider loads. */
  readonly create: () => AnatomyProvider;
  /** Install whatever transport the provider reads from. */
  readonly installTransport: () => void;
}

const BASE = 'https://assets.test/models';
const ENDPOINT = 'https://veo.test/api/anatomy';

/** A fetch that serves the fixture, and refuses anything else. */
function fixtureFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = routes[url];

    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const PROVIDERS: readonly ProviderCase[] = [
  {
    name: 'GltfAnatomyProvider',
    create: () => new GltfAnatomyProvider({ baseUrl: BASE }),
    installTransport: () => {
      vi.stubGlobal(
        'fetch',
        fixtureFetch({ [`${BASE}/${MODEL_REF}/manifest.json`]: conformanceManifest() }),
      );
    },
  },
  {
    name: 'HostedAnatomyProvider',
    create: () => new HostedAnatomyProvider({ endpoint: ENDPOINT }),
    installTransport: () => {
      vi.stubGlobal(
        'fetch',
        fixtureFetch({
          [ENDPOINT]: { configured: true, reason: null, providerId: 'hosted', delivery: 'server_mediated' },
          [`${ENDPOINT}/${MODEL_REF}`]: {
            modelRef: MODEL_REF,
            manifest: conformanceManifest(),
            assetUrl: 'https://assets.test/signed/conformance.glb?token=redacted',
            delivery: 'server_mediated',
            expiresInSeconds: 300,
          },
        }),
      );
    },
  },
];

describe.each(PROVIDERS)('provider conformance: $name', ({ create, installTransport }) => {
  let provider: AnatomyProvider;

  beforeEach(async () => {
    installTransport();
    provider = create();
  });

  afterEach(() => {
    provider.dispose();
    vi.unstubAllGlobals();
  });

  async function loaded(): Promise<AnatomyProvider> {
    await provider.initialize();
    const result = await provider.loadModel(MODEL_REF);
    if (!result.ok) throw new Error(`fixture failed to load: ${result.error.message}`);
    return provider;
  }

  // ---- initialisation -----------------------------------------------------

  it('initialises and reports itself ready', async () => {
    const result = await provider.initialize();

    expect(result.ok).toBe(true);
    expect(provider.getStatus().ready).toBe(true);
    expect(provider.getStatus().id).toBe(provider.id);
  });

  it('refuses to load before initialisation', async () => {
    const result = await provider.loadModel(MODEL_REF);
    expect(result.ok).toBe(false);
  });

  it('reports an honest reason when it cannot serve anything', async () => {
    // No transport at all: the provider must say so rather than pretend.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const bare = create();
    const result = await bare.initialize();

    if (result.ok) {
      // A provider that initialises without a transport must still fail the
      // load, and with a reason rather than an empty model.
      const load = await bare.loadModel(MODEL_REF);
      expect(load.ok).toBe(false);
      if (!load.ok) expect(load.error.message.length).toBeGreaterThan(0);
    } else {
      expect(bare.getStatus().ready).toBe(false);
      expect(bare.getStatus().reason).toBeTruthy();
    }
    bare.dispose();
  });

  // ---- model and manifest -------------------------------------------------

  it('loads the fixture model', async () => {
    await loaded();

    const model = provider.getModel();
    expect(model?.id).toBe('00000000-0000-4000-8000-00000000c0f1');
    expect(model?.domain).toBe('anatomy');
  });

  it('exposes the validated manifest', async () => {
    await loaded();

    const manifest = provider.getManifest();
    expect(manifest?.objects).toHaveLength(7);
    expect(manifest?.licence.holder).toBe('VEO');
  });

  it('reports both versions, so a mismatch is detectable', async () => {
    await loaded();

    const version = provider.getModelVersion();
    expect(version?.modelVersion).toBe('3.4.5');
    expect(version?.manifestVersion).toBe('1.2.0');
    expect(version?.formatVersion).toBe(1);
  });

  it('refuses a manifest written for another provider', async () => {
    await provider.initialize();

    const foreign = { ...conformanceManifest(), provider: 'some-other-vendor' };
    vi.stubGlobal(
      'fetch',
      fixtureFetch({
        [`${BASE}/${MODEL_REF}/manifest.json`]: foreign,
        [ENDPOINT]: { configured: true, reason: null },
        [`${ENDPOINT}/${MODEL_REF}`]: { manifest: foreign, assetUrl: 'x' },
      }),
    );

    const result = await provider.loadModel(MODEL_REF);
    expect(result.ok).toBe(false);
  });

  it('refuses a manifest that fails validation', async () => {
    await provider.initialize();

    const broken = conformanceManifest();
    (broken.objects as { parentId: string | null }[])[3]!.parentId = 'veo.anatomy.nowhere';

    vi.stubGlobal(
      'fetch',
      fixtureFetch({
        [`${BASE}/${MODEL_REF}/manifest.json`]: broken,
        [ENDPOINT]: { configured: true, reason: null },
        [`${ENDPOINT}/${MODEL_REF}`]: { manifest: broken, assetUrl: 'x' },
      }),
    );

    const result = await provider.loadModel(MODEL_REF);
    expect(result.ok).toBe(false);
  });

  // ---- structure lookup ---------------------------------------------------

  it('resolves a structure by its VEO identity', async () => {
    await loaded();

    const structure = provider.getStructure(A1);
    expect(structure?.name).toBe('Fixture Structure A1');
    expect(structure?.system).toBe('cardiovascular');
    expect(structure?.region).toBe('thorax');
  });

  it('never uses the provider id as identity', async () => {
    await loaded();

    // The provider's own handle is carried as metadata, never as the key.
    expect(provider.getStructure('fixture-a1' as SemanticId)).toBeNull();
    expect(provider.getStructure(A1)?.metadata.providerId).toBe('fixture-a1');
  });

  it('returns descriptive metadata exactly as authored', async () => {
    await loaded();

    const metadata = provider.getStructureMetadata(A1);
    expect(metadata?.latinName).toBe('Structura fictiva prima');
    expect(metadata?.laterality).toBe('left');
    expect(metadata?.externalIds.FIXTURE).toBe('A1');

    // A structure with no description gets none invented for it.
    expect(provider.getStructureMetadata(A2)?.description).toBeNull();
  });

  it('returns null for a structure the model does not contain', async () => {
    await loaded();
    expect(provider.getStructure('veo.anatomy.absent' as SemanticId)).toBeNull();
    expect(provider.getStructureMetadata('veo.anatomy.absent' as SemanticId)).toBeNull();
  });

  // ---- hierarchy ----------------------------------------------------------

  it('exposes the declared hierarchy', async () => {
    await loaded();

    const structure = provider.getStructure(A1);
    expect(structure?.parentId).toBe(GROUP_A);
    expect(provider.getStructure(GROUP_A)?.childIds).toContain(A1);
  });

  it('normalises into Body → System → Region → Structure', async () => {
    await loaded();

    const tree = provider.getNormalizedHierarchy();
    expect(tree?.level).toBe('body');

    const systems = tree?.children ?? [];
    expect(systems.map((node) => node.level)).toEqual(['system', 'system']);
    expect(systems.map((node) => node.name).sort()).toEqual(['Cardiovascular', 'Respiratory']);

    // Grouping nodes are navigation, not content: they are marked synthetic.
    expect(systems.every((node) => node.synthetic)).toBe(true);

    const regions = systems[0]?.children ?? [];
    expect(regions[0]?.level).toBe('region');
    expect(regions[0]?.children[0]?.level).toBe('structure');
    expect(regions[0]?.children[0]?.synthetic).toBe(false);
  });

  it('reports only the systems and regions the model actually contains', async () => {
    await loaded();

    expect(provider.getAvailableSystems()).toEqual(['cardiovascular', 'respiratory']);
    expect(provider.getAvailableRegions()).toEqual(['thorax', 'abdomen']);
  });

  // ---- relationships ------------------------------------------------------

  it('resolves relationships to structures in the same model', async () => {
    await loaded();

    const related = provider.getRelatedStructures(A1);
    expect([...related.map((r) => r.targetId)].sort()).toEqual([A2, B1].sort());
    expect(related.find((r) => r.targetId === B1)?.kind).toBe('supplies');
  });

  it('filters relationships by kind', async () => {
    await loaded();
    expect(provider.getRelatedStructures(A1, ['supplies'])).toHaveLength(1);
  });

  // ---- layers and partial loading -----------------------------------------

  it('maps declared layers onto real structures', async () => {
    const result = await (await loaded()).loadLayer('outer');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.value.objectIds].sort()).toEqual([A1, B1].sort());
      expect(result.value.peelable).toBe(true);
    }
  });

  it('loads a system as a layer over real structures', async () => {
    const result = await (await loaded()).loadSystem('cardiovascular');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.objectIds).toContain(A1);
  });

  it('refuses a system the model does not contain', async () => {
    const result = await (await loaded()).loadSystem('skeletal');
    expect(result.ok).toBe(false);
  });

  it('loads a region over real structures', async () => {
    const result = await (await loaded()).loadAnatomyRegion('thorax');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.objectIds).toContain(A1);
  });

  // ---- capabilities -------------------------------------------------------

  it('derives capabilities from the loaded model', async () => {
    const capabilities = (await loaded()).getCapabilities();

    expect(capabilities.supportsSelection).toBe(true);
    expect(capabilities.supportsLayers).toBe(true);
    expect(capabilities.supportsRelationships).toBe(true);
    // Two peelable layers are declared, so peeling has somewhere to go.
    expect(capabilities.supportsPeeling).toBe(true);
    expect(capabilities.supportsExplosion).toBe(true);
  });

  it('reports nothing before a model is loaded', async () => {
    await provider.initialize();

    expect(provider.getManifest()).toBeNull();
    expect(provider.getModelVersion()).toBeNull();
    expect(provider.getNormalizedHierarchy()).toBeNull();
    expect(provider.getCapabilities().supportsLayers).toBe(false);
  });

  // ---- geometry -----------------------------------------------------------

  it('exposes declared bounds and positions', async () => {
    await loaded();

    expect(provider.getBoundingBox(A1)).toEqual({ min: [-1, -1, -1], max: [0, 1, 1] });
    expect(provider.getStructurePosition(A1)).toEqual([-0.5, 0, 0]);
  });

  it('maps every declared mesh to exactly one structure', async () => {
    await loaded();

    const mapping = (provider as unknown as { getMeshMapping(): ReadonlyMap<string, SemanticId> })
      .getMeshMapping();

    for (const mesh of CONFORMANCE_MESH_NAMES) {
      expect(mapping.get(mesh)).toBeTruthy();
    }
    expect(mapping.size).toBe(CONFORMANCE_MESH_NAMES.length);
  });

  // ---- presentation reaches the engine ------------------------------------

  it('selection reaches the spatial engine', async () => {
    await loaded();
    provider.select(A1);
    expect(snapshotOf(provider).selectedId).toBe(A1);
  });

  it('visibility reaches the spatial engine', async () => {
    await loaded();

    provider.hide([A1]);
    expect(snapshotOf(provider).visual.states.get(A1)).toBe('hidden');

    provider.show([A1]);
    expect(snapshotOf(provider).visual.states.get(A1)).toBe('default');

    provider.ghost([A1]);
    expect(snapshotOf(provider).visual.states.get(A1)).toBe('ghosted');
  });

  it('isolation reaches the spatial engine and is reversible', async () => {
    await loaded();

    provider.isolate(GROUP_A);
    expect(snapshotOf(provider).visual.states.get(A1)).toBe('isolated');
    expect(snapshotOf(provider).visual.states.get(B1)).toBe('ghosted');

    provider.restore();
    expect(snapshotOf(provider).visual.states.get(B1)).toBe('default');
  });

  it('camera targeting reaches the spatial engine', async () => {
    await loaded();
    provider.flyTo(A1, { durationMs: 0 });

    const camera = snapshotOf(provider).camera;
    expect(camera?.kind).toBe('fly_to');
    expect(camera?.targetId).toBe(A1);
  });

  it('focusing a structure selects, isolates and frames it in one step', async () => {
    await loaded();
    provider.focusStructure(A1, { durationMs: 0 });

    const snapshot = snapshotOf(provider);
    expect(snapshot?.selectedId).toBe(A1);
    expect(snapshot?.manipulation.isolatedId).toBe(A1);
    expect(snapshot?.camera?.targetId).toBe(A1);
  });

  // ---- disposal and replacement -------------------------------------------

  it('disposal leaves no model behind', async () => {
    await loaded();
    provider.dispose();

    expect(provider.getModel()).toBeNull();
    expect(provider.getStructure(A1)).toBeNull();
    expect(snapshotOf(provider).selectedId).toBeNull();
  });

  it('unloading drops the model without disposing the provider', async () => {
    await loaded();
    provider.unloadModel();

    expect(provider.getModel()).toBeNull();
    expect(provider.getStatus().ready).toBe(true);
  });

  it('replacing a model leaves no stale semantic objects', async () => {
    await loaded();
    provider.select(A1);

    const smaller = conformanceManifest();
    smaller.objects = (smaller.objects as unknown[]).slice(0, 3);
    smaller.relationships = [];
    smaller.explosion = [];
    smaller.regions = [];
    smaller.systems = [
      { id: 'cardiovascular', name: 'Fixture System One', description: null, assetPath: null },
    ];
    (smaller.objects as { layers: string[] }[]).forEach((object) => {
      object.layers = [];
    });

    vi.stubGlobal(
      'fetch',
      fixtureFetch({
        [`${BASE}/${MODEL_REF}/manifest.json`]: smaller,
        [ENDPOINT]: { configured: true, reason: null },
        [`${ENDPOINT}/${MODEL_REF}`]: { manifest: smaller, assetUrl: 'x' },
      }),
    );

    const result = await provider.loadModel(MODEL_REF);
    expect(result.ok).toBe(true);

    // The structures that are gone must be gone: still resolving them would
    // mean the learner's selection points at geometry that no longer exists.
    expect(provider.getStructure(A1)).toBeNull();
    expect(snapshotOf(provider).selectedId).toBeNull();
    expect(provider.getStructure(ROOT)).not.toBeNull();
  });
});

describe('conformance fixture safety', () => {
  it('is never reachable as a catalogue model', () => {
    // The catalogue is the allowlist the server route enforces. A fixture in
    // it would be servable to a learner as though it were anatomy.
    for (const entry of ANATOMY_MODEL_CATALOG) {
      expect(entry.modelRef).not.toBe(MODEL_REF);
      expect(entry.rootObjectId.startsWith(CONFORMANCE_NAMESPACE)).toBe(false);
    }
  });

  it('claims to be a fixture in its own name', () => {
    const manifest = conformanceManifest();
    expect(String(manifest.name)).toContain('CONFORMANCE FIXTURE');
    expect(String(manifest.description)).toContain('Not a model of any body structure');
  });

  it('names no body structure', () => {
    const manifest = conformanceManifest();
    for (const object of manifest.objects as { name: string; semanticId: string }[]) {
      expect(object.name).toMatch(/^Fixture /);
      expect(object.semanticId.startsWith(CONFORMANCE_NAMESPACE)).toBe(true);
    }
  });
});
