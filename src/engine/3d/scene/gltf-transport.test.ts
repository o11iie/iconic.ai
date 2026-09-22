import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SemanticId } from '@/lib/semantic-id';
import { buildRegistryFromMapping } from '@/engine/spatial/object-registry';
import { boundsOf, boundsOfAll } from '../bounds';
import { countResources, disposeObject3D } from '../disposal';
import { MaterialStateManager } from '../materials/material-state';

/**
 * GLB transport rehearsal
 * =======================
 *
 * The one link in the chain nothing had ever exercised.
 *
 * Gates 5–7 proved the renderer, the semantic layer and manipulation, all
 * against a scene built in memory. Gate 8 proved the manifest contract against
 * a stubbed network. What neither touched is the step between them: a real
 * binary glTF arriving over the wire, parsing into a three.js scene, and that
 * scene's meshes binding to the identities a manifest declared for them.
 *
 * If that step is broken, it is broken on the day a licence arrives — the
 * worst possible day to find out. So this exports a real GLB, parses it with
 * the real loader, and puts the result through the real registry, bounds,
 * material and disposal code.
 *
 * ## This is not anatomy
 *
 * The geometry here is abstract and exists to carry mesh names through a file
 * format. It is never mounted in a viewport, never given an anatomy semantic
 * id, and never reachable by a learner — both anatomy providers refuse a
 * manifest whose domain is not `anatomy`, which a test below asserts.
 */

const NAMESPACE = 'veo.diagnostic.transport_rehearsal';
const PART_A = `${NAMESPACE}.part_a` as SemanticId;
const PART_B = `${NAMESPACE}.part_b` as SemanticId;

/** Mesh names a vendor might export. The point is that they survive the file. */
const MESH_NAMES = {
  partA: 'Rehearsal_PartA_001',
  partB: 'Rehearsal_PartB_001',
  helper: 'Rehearsal_Armature',
} as const;

/**
 * Build a scene, write it to a real .glb, and read it back.
 *
 * Deliberately a round trip rather than a fixture file: a checked-in binary
 * would be a snapshot of one exporter version, and the thing worth testing is
 * that the format itself carries what VEO depends on.
 */
async function roundTrip(): Promise<{ scene: THREE.Object3D; buffer: ArrayBuffer }> {
  const source = new THREE.Group();
  source.name = 'RehearsalRoot';

  const partA = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.6 }),
  );
  partA.name = MESH_NAMES.partA;
  partA.position.set(-1.5, 0, 0);

  const partB = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.4 }),
  );
  partB.name = MESH_NAMES.partB;
  partB.position.set(1.5, 0, 0);

  // Geometry a manifest does not name, as every real asset carries.
  const helper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial());
  helper.name = MESH_NAMES.helper;

  source.add(partA, partB, helper);

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      source,
      (result) => resolve(result as ArrayBuffer),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true },
    );
  });

  // The source is disposed: nothing below may be reading it by reference.
  disposeObject3D(source);

  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });

  return { scene: gltf.scene, buffer };
}

describe('GLB transport', () => {
  it('produces a spec-conformant binary glTF container', async () => {
    const { scene, buffer } = await roundTrip();
    const header = new DataView(buffer);

    // Asserting the container itself, not just that something came back: a
    // round trip that quietly produced JSON, or nothing, would otherwise pass
    // every test below it.
    expect(header.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(header.getUint32(4, true)).toBe(2); // glTF 2.0
    expect(header.getUint32(8, true)).toBe(buffer.byteLength); // declared length
    expect(header.getUint32(16, true)).toBe(0x4e4f534a); // first chunk is JSON

    // A binary chunk must follow, or the geometry is not in the file.
    const jsonLength = header.getUint32(12, true);
    expect(header.getUint32(20 + jsonLength + 4, true)).toBe(0x004e4942); // "BIN"

    expect(buffer.byteLength).toBeGreaterThan(500);
    expect(scene).toBeInstanceOf(THREE.Object3D);
  });

  it('carries mesh names through the file, which is what identity depends on', async () => {
    const { scene } = await roundTrip();

    const names = new Set<string>();
    scene.traverse((node) => {
      if (node.name) names.add(node.name);
    });

    // If a format or exporter dropped these, every manifest mapping would miss
    // and the model would load with nothing selectable.
    expect(names.has(MESH_NAMES.partA)).toBe(true);
    expect(names.has(MESH_NAMES.partB)).toBe(true);
    expect(names.has(MESH_NAMES.helper)).toBe(true);
  });

  it('binds loaded meshes to the identities a manifest declares', async () => {
    const { scene } = await roundTrip();

    const mapping = new Map<string, SemanticId>([
      [MESH_NAMES.partA, PART_A],
      [MESH_NAMES.partB, PART_B],
    ]);

    const registry = buildRegistryFromMapping(scene as never, mapping as never);

    expect(registry.size).toBe(2);
    expect(registry.has(PART_A)).toBe(true);
    expect(registry.has(PART_B)).toBe(true);

    // Unnamed-by-the-manifest geometry is reported, not silently swallowed.
    expect(registry.unmappedNames()).toContain(MESH_NAMES.helper);
  });

  it('resolves a raycast hit on loaded geometry to its semantic identity', async () => {
    const { scene } = await roundTrip();
    const mapping = new Map<string, SemanticId>([[MESH_NAMES.partA, PART_A]]);
    const registry = buildRegistryFromMapping(scene as never, mapping as never);

    let hit: THREE.Object3D | null = null;
    scene.traverse((node) => {
      if (node.name === MESH_NAMES.partA) hit = node;
    });

    expect(hit).not.toBeNull();
    expect(registry.resolve(hit as unknown as never)).toBe(PART_A);
  });

  it('computes real bounds from loaded geometry, so the camera can frame it', async () => {
    const { scene } = await roundTrip();

    const box = boundsOf(scene);
    expect(box).not.toBeNull();

    // The two parts sit at x = ±1.5 with their own extents, so the model is
    // wider than it is tall. A loader that lost transforms would not show it.
    const width = box!.max[0] - box!.min[0];
    const height = box!.max[1] - box!.min[1];
    expect(width).toBeGreaterThan(height);

    const mapping = new Map<string, SemanticId>([[MESH_NAMES.partA, PART_A]]);
    const registry = buildRegistryFromMapping(scene as never, mapping as never);
    const partBox = boundsOfAll(
      registry.all().map((entry) => entry.node as unknown as THREE.Object3D),
    );

    expect(partBox).not.toBeNull();
    // Part A is the 1×2×1 box at x = -1.5.
    expect(partBox!.max[0]).toBeLessThan(0);
    expect(partBox!.max[1] - partBox!.min[1]).toBeCloseTo(2, 4);
  });

  it('applies visual state to loaded materials without corrupting them', async () => {
    const { scene } = await roundTrip();
    const materials = new MaterialStateManager();

    let mesh: THREE.Mesh | null = null;
    scene.traverse((node) => {
      if (node.name === MESH_NAMES.partA) mesh = node as THREE.Mesh;
    });

    const authored = (mesh as unknown as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const authoredColor = authored.color.getHex();

    materials.apply(mesh as unknown as THREE.Mesh, 'selected');
    materials.apply(mesh as unknown as THREE.Mesh, 'ghosted');
    materials.apply(mesh as unknown as THREE.Mesh, 'default');

    expect(materials.overrideCount).toBe(1);
    expect((mesh as unknown as THREE.Mesh).material).toBe(authored);
    expect(authored.color.getHex()).toBe(authoredColor);
  });

  it('disposes everything the loader allocated', async () => {
    const { scene } = await roundTrip();

    const before = countResources(scene);
    expect(before.geometries).toBe(3);
    expect(before.materials).toBeGreaterThanOrEqual(1);

    const report = disposeObject3D(scene);

    expect(report.geometries).toBe(3);
    expect(countResources(scene).geometries).toBe(0);
  });

  it('leaves nothing behind across repeated load and dispose', async () => {
    // Model replacement is where leaks actually happen, and a GLB carries
    // buffers a hand-built scene does not.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const { scene } = await roundTrip();
      expect(countResources(scene).geometries).toBe(3);

      disposeObject3D(scene);
      expect(countResources(scene).geometries).toBe(0);
    }
  });
});

describe('transport rehearsal containment', () => {
  it('is refused by the anatomy provider, because it is not anatomy', async () => {
    const { GltfAnatomyProvider } = await import('@/anatomy/providers/gltf-anatomy-provider');
    const { vi } = await import('vitest');

    const rehearsalManifest = {
      formatVersion: 1,
      modelId: '00000000-0000-4000-8000-00000000d0d0',
      domain: 'diagnostic',
      provider: 'gltf-asset',
      name: 'VEO GLB TRANSPORT REHEARSAL',
      assetPath: 'rehearsal.glb',
      rootObjectId: NAMESPACE,
      licence: { holder: 'VEO', kind: 'veo_owned' },
      objects: [
        { semanticId: NAMESPACE, name: 'Rehearsal Root', kind: 'group' },
        { semanticId: PART_A, name: 'Rehearsal Part A', parentId: NAMESPACE, meshes: [MESH_NAMES.partA] },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => rehearsalManifest })),
    );

    const provider = new GltfAnatomyProvider({ baseUrl: 'https://assets.test/models' });
    await provider.initialize();
    const result = await provider.loadModel('rehearsal');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('domain');

    provider.dispose();
    vi.unstubAllGlobals();
  });
});
