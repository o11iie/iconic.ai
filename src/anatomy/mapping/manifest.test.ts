import { describe, expect, it } from 'vitest';
import { buildMeshMapping } from './manifest';
import { parseManifest } from './validation';

const MODEL_ID = '2f1c9a3e-6b41-4c8f-9f0a-1d2e3f4a5b6c';

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    modelId: MODEL_ID,
    name: 'Heart',
    assetPath: 'heart.glb',
    rootObjectId: 'veo.anatomy.heart',
    licence: { holder: 'Example Licensor', kind: 'licensed_asset' },
    objects: [
      { semanticId: 'veo.anatomy.heart', name: 'Heart', meshes: ['Heart_Root'] },
      {
        semanticId: 'veo.anatomy.heart.left_ventricle',
        name: 'Left ventricle',
        parentId: 'veo.anatomy.heart',
        meshes: ['Heart_LV_001', 'Heart_LV_002'],
        system: 'cardiovascular',
        region: 'thorax',
      },
    ],
    ...overrides,
  };
}

describe('parseManifest', () => {
  it('accepts a well-formed manifest and applies defaults', () => {
    const result = parseManifest(validManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.domain).toBe('anatomy');
    expect(result.value.objects[0]?.kind).toBe('structure');
    expect(result.value.relationships).toEqual([]);
  });

  it('rejects an unknown format version, so old readers fail loudly', () => {
    expect(parseManifest(validManifest({ formatVersion: 2 })).ok).toBe(false);
  });

  it('rejects malformed semantic ids', () => {
    const result = parseManifest(
      validManifest({
        objects: [{ semanticId: 'Heart_LV_001', name: 'Left ventricle' }],
        rootObjectId: 'Heart_LV_001',
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a parent that is not present in the manifest', () => {
    const result = parseManifest(
      validManifest({
        objects: [
          {
            semanticId: 'veo.anatomy.heart.left_ventricle',
            name: 'Left ventricle',
            parentId: 'veo.anatomy.missing',
          },
        ],
        rootObjectId: 'veo.anatomy.heart.left_ventricle',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(' ')).toContain('veo.anatomy.missing');
  });

  it('rejects duplicate semantic ids', () => {
    const duplicate = { semanticId: 'veo.anatomy.heart', name: 'Heart' };
    const result = parseManifest(validManifest({ objects: [duplicate, duplicate] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(' ')).toContain('Duplicate');
  });

  it('rejects a rootObjectId that is not one of the objects', () => {
    const result = parseManifest(validManifest({ rootObjectId: 'veo.anatomy.absent' }));
    expect(result.ok).toBe(false);
  });

  it('rejects relationships pointing at unknown objects', () => {
    const result = parseManifest(
      validManifest({
        relationships: [
          { source: 'veo.anatomy.heart', target: 'veo.anatomy.nowhere', kind: 'supplies' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a payload that is not an object at all', () => {
    expect(parseManifest(null).ok).toBe(false);
    expect(parseManifest('heart').ok).toBe(false);
  });
});

describe('buildMeshMapping', () => {
  it('maps every vendor mesh name onto its semantic id', () => {
    const parsed = parseManifest(validManifest());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const mapping = buildMeshMapping(parsed.value);

    // One semantic structure legitimately maps from several vendor meshes.
    expect(mapping.get('Heart_LV_001')).toBe('veo.anatomy.heart.left_ventricle');
    expect(mapping.get('Heart_LV_002')).toBe('veo.anatomy.heart.left_ventricle');
    expect(mapping.get('Heart_Root')).toBe('veo.anatomy.heart');
    expect(mapping.size).toBe(3);
  });
});
