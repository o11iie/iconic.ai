import { describe, expect, it } from 'vitest';
import { manifestSchema } from './manifest';
import { conformanceManifest } from '../fixtures/conformance-manifest';
import { describeReconciliation, reconcile } from './reconciliation';

/**
 * Reconciliation tests.
 *
 * The failure this prevents is the quiet one: a structure that keeps its name,
 * its parent and its context panel while having no geometry at all. Nothing
 * throws, nothing looks broken, and a learner reads a label off the wrong
 * structure.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
function manifest(mutate: (m: any) => void = () => {}) {
  const raw = conformanceManifest();
  mutate(raw);
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('fixture should parse');
  return parsed.data;
}

const ALL_MESHES = [
  'Fixture_A1_001',
  'Fixture_A2_001',
  'Fixture_A2_002',
  'Fixture_B1_001',
  'Fixture_B2_001',
];

function inventory(names: readonly string[], modelVersion: string | null = '3.4.5') {
  return { names: new Set(names), modelVersion };
}

describe('asset reconciliation', () => {
  it('passes when the asset carries every mapped mesh', () => {
    const result = reconcile(manifest(), inventory(ALL_MESHES));

    expect(result.ok).toBe(true);
    expect(result.missingMeshes).toEqual([]);
    expect(result.unrenderableStructures).toEqual([]);
    expect(describeReconciliation(result)).toBeNull();
  });

  it('catches a mesh the manifest promised and the asset lacks', () => {
    const result = reconcile(
      manifest(),
      inventory(ALL_MESHES.filter((name) => name !== 'Fixture_B1_001')),
    );

    expect(result.ok).toBe(false);
    expect(result.missingMeshes).toEqual(['Fixture_B1_001']);
    expect(result.unrenderableStructures).toEqual([
      'veo.anatomy.conformance_fixture.group_b.structure_b1',
    ]);
  });

  it('reports a partially-rendered structure without calling it unrenderable', () => {
    // Structure A2 maps two meshes. One missing leaves it visible but wrong,
    // which is a different fact from a structure with nothing at all.
    const result = reconcile(
      manifest(),
      inventory(ALL_MESHES.filter((name) => name !== 'Fixture_A2_002')),
    );

    expect(result.missingMeshes).toEqual(['Fixture_A2_002']);
    expect(result.unrenderableStructures).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('reports geometry the manifest never named, without refusing the model', () => {
    // An asset legitimately carries scenery, helpers and armature nodes.
    const result = reconcile(manifest(), inventory([...ALL_MESHES, 'Armature', 'Camera']));

    expect([...result.unmappedMeshes].sort()).toEqual(['Armature', 'Camera']);
    expect(result.ok).toBe(true);
  });

  it('catches geometry from a different revision', () => {
    const result = reconcile(manifest(), inventory(ALL_MESHES, '9.9.9'));

    expect(result.ok).toBe(false);
    expect(result.versionMismatch).toEqual({ asset: '9.9.9', manifest: '3.4.5' });
    expect(describeReconciliation(result)).toContain('9.9.9');
  });

  it('accepts an asset that stamps no version at all', () => {
    // Most vendors do not stamp one. Absence is not disagreement.
    const result = reconcile(manifest(), inventory(ALL_MESHES, null));

    expect(result.versionMismatch).toBeNull();
    expect(result.ok).toBe(true);
  });

  it('does not fault a structure addressed only by provider id', () => {
    // A hosted provider resolves those itself; this function sees meshes.
    const result = reconcile(
      manifest((m) => {
        m.objects[6].meshes = [];
      }),
      inventory(ALL_MESHES.filter((name) => name !== 'Fixture_B2_001')),
    );

    expect(result.ok).toBe(true);
    expect(result.unrenderableStructures).toEqual([]);
  });

  it('does not fault a grouping node that maps no mesh', () => {
    const result = reconcile(manifest(), inventory(ALL_MESHES));
    expect(result.unrenderableStructures).toEqual([]);
  });

  it('explains the refusal in words a reader can act on', () => {
    const missing = describeReconciliation(
      reconcile(manifest(), inventory(['Fixture_A1_001'])),
    );
    expect(missing).toContain('missing');
    expect(missing).toContain('incomplete model as complete');

    const version = describeReconciliation(reconcile(manifest(), inventory(ALL_MESHES, '2.0.0')));
    expect(version).toContain('2.0.0');
    expect(version).toContain('3.4.5');
  });

  it('reports the version disagreement ahead of missing meshes', () => {
    // When revisions disagree, every mapping is suspect — the mesh list is a
    // symptom, and naming it first would send an author chasing the wrong bug.
    const result = reconcile(manifest(), inventory(['Fixture_A1_001'], '9.9.9'));
    expect(describeReconciliation(result)).toContain('version');
  });
});
