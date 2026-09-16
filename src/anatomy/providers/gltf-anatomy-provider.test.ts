import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import { GltfAnatomyProvider } from './gltf-anatomy-provider';

/**
 * These tests exercise the real provider against a stubbed network, proving
 * that the not-configured path, the manifest contract and the visual-state
 * intents all behave — without needing a licensed asset.
 */

const MODEL_ID = '2f1c9a3e-6b41-4c8f-9f0a-1d2e3f4a5b6c';
const heart = 'veo.anatomy.heart' as SemanticId;
const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
const rv = 'veo.anatomy.heart.right_ventricle' as SemanticId;

const MANIFEST = {
  formatVersion: 1,
  modelId: MODEL_ID,
  name: 'Heart',
  assetPath: 'heart.glb',
  rootObjectId: heart,
  licence: { holder: 'Example Licensor', kind: 'licensed_asset' },
  objects: [
    { semanticId: heart, name: 'Heart', meshes: ['Heart_Root'] },
    {
      semanticId: lv,
      name: 'Left ventricle',
      parentId: heart,
      meshes: ['Heart_LV_001'],
      system: 'cardiovascular',
      region: 'thorax',
      latinName: 'Ventriculus sinister',
      boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
    },
    {
      semanticId: rv,
      name: 'Right ventricle',
      parentId: heart,
      meshes: ['Heart_RV_001'],
      system: 'cardiovascular',
      region: 'thorax',
    },
  ],
  relationships: [{ source: lv, target: rv, kind: 'adjacent_to', bidirectional: true }],
};

function stubFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => payload,
    })),
  );
}

const TEST_BASE_URL = 'https://assets.example.test/models';

async function readyProvider(): Promise<GltfAnatomyProvider> {
  const provider = new GltfAnatomyProvider({ baseUrl: TEST_BASE_URL });
  await provider.initialize();
  const result = await provider.loadModel('heart');
  expect(result.ok).toBe(true);
  return provider;
}

describe('when no licensed asset source is configured', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reports not-configured rather than inventing geometry', async () => {
    // The module-level env snapshot has no asset base URL in the test
    // environment, which is exactly the unconfigured production case.
    const provider = new GltfAnatomyProvider();
    const result = await provider.initialize();

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('provider_not_configured');
    expect(provider.getStatus().ready).toBe(false);
    expect(provider.getStatus().reason).toContain('NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL');
    // Critically: no model, and no fabricated stand-in.
    expect(provider.getModel()).toBeNull();
    expect(provider.getAssetUrl()).toBeNull();
  });

  it('refuses to load a model before initialisation succeeds', async () => {
    const provider = new GltfAnatomyProvider();
    const result = await provider.loadModel('heart');
    expect(result.ok).toBe(false);
  });
});

describe('with a configured asset source', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    stubFetch(MANIFEST);
  });

  it('loads a manifest and builds the semantic graph', async () => {
    const provider = await readyProvider();

    expect(provider.getModel()?.name).toBe('Heart');
    expect(provider.getStructure(lv)?.name).toBe('Left ventricle');
    expect(provider.getStructure(heart)?.childIds).toEqual([lv, rv]);
    expect(provider.getAssetUrl()).toContain('heart.glb');
  });

  it('maps vendor mesh names onto permanent semantic ids', () => {
    // The mapping is the whole point: mesh names are vendor artefacts.
    return readyProvider().then((provider) => {
      expect(provider.getMeshMapping().get('Heart_LV_001')).toBe(lv);
      expect(provider.getStructure(lv)?.providerMeshNames).toEqual(['Heart_LV_001']);
    });
  });

  it('exposes structure metadata only where the manifest supplies it', async () => {
    const provider = await readyProvider();

    expect(provider.getStructureMetadata(lv)?.latinName).toBe('Ventriculus sinister');
    // No invented prose for a structure that declares none.
    expect(provider.getStructureMetadata(rv)?.latinName).toBeNull();
    expect(provider.getStructureMetadata('veo.anatomy.absent' as SemanticId)).toBeNull();
  });

  it('returns related structures', async () => {
    const provider = await readyProvider();
    const related = provider.getRelatedStructures(lv);
    expect(related).toHaveLength(1);
    expect(related[0]?.targetId).toBe(rv);
  });

  it('reports only the systems and regions actually present', async () => {
    const provider = await readyProvider();
    expect(provider.getAvailableSystems()).toEqual(['cardiovascular']);
    expect(provider.getAvailableRegions()).toEqual(['thorax']);
  });

  it('computes position from the bounding box', async () => {
    const provider = await readyProvider();
    expect(provider.getStructurePosition(lv)).toEqual([0, 0, 0]);
    // No bounding box declared means no position, not a guessed origin.
    expect(provider.getStructurePosition(rv)).toBeNull();
  });

  it('searches names, ids and synonyms', async () => {
    const provider = await readyProvider();
    expect(provider.search('ventricle').map((o) => o.semanticId)).toEqual([lv, rv]);
    expect(provider.search('')).toEqual([]);
  });

  it('drives selection and isolation through the snapshot', async () => {
    const provider = await readyProvider();

    provider.select(lv);
    expect(provider.getSnapshot().visual.states.get(lv)).toBe('selected');

    provider.isolate(lv);
    const isolated = provider.getSnapshot();
    expect(isolated.visual.isolatedId).toBe(lv);
    // Context is ghosted, not deleted, so orientation survives.
    expect(isolated.visual.states.get(rv)).toBe('ghosted');

    provider.restore();
    expect(provider.getSnapshot().visual.states.get(rv)).toBe('default');
  });

  it('queues camera intents with an incrementing version', async () => {
    const provider = await readyProvider();

    provider.flyTo(lv, { durationMs: 0 });
    const first = provider.getSnapshot().camera;
    expect(first?.kind).toBe('fly_to');
    expect(first?.targetId).toBe(lv);

    provider.resetCamera();
    const second = provider.getSnapshot().camera;
    expect(second?.kind).toBe('reset');
    expect(second?.version).toBeGreaterThan(first?.version ?? 0);
  });

  it('notifies subscribers on change', async () => {
    const provider = await readyProvider();
    const listener = vi.fn();
    const unsubscribe = provider.subscribe(listener);

    provider.select(lv);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    provider.select(rv);
    expect(listener).not.toHaveBeenCalled();
  });

  it('surfaces an HTTP failure as a model_unavailable error', async () => {
    stubFetch({}, false, 404);
    const provider = new GltfAnatomyProvider({ baseUrl: TEST_BASE_URL });
    await provider.initialize();

    const result = await provider.loadModel('missing');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('model_unavailable');
    expect(result.error.message).toContain('404');
  });

  it('rejects an invalid manifest instead of rendering a broken model', async () => {
    stubFetch({ formatVersion: 1, name: 'Broken' });
    const provider = new GltfAnatomyProvider({ baseUrl: TEST_BASE_URL });
    await provider.initialize();

    const result = await provider.loadModel('broken');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('model_unavailable');
  });
});
