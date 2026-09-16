import { describe, expect, it } from 'vitest';
import {
  buildSemanticId,
  isDescendantOf,
  isSemanticId,
  parseSemanticId,
  semanticIdAncestors,
  semanticIdDepth,
  semanticIdDomain,
  semanticIdParent,
  semanticIdToLabel,
  toSemanticSegment,
  type SemanticId,
} from './semantic-id';

describe('parseSemanticId', () => {
  it('parses a well-formed id into its parts', () => {
    const result = parseSemanticId('veo.anatomy.heart.left_ventricle');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.domain).toBe('anatomy');
    expect(result.value.path).toEqual(['heart', 'left_ventricle']);
    expect(result.value.leaf).toBe('left_ventricle');
  });

  it('accepts ids from any knowledge domain, not just anatomy', () => {
    expect(parseSemanticId('veo.chemistry.benzene.carbon_1').ok).toBe(true);
    expect(parseSemanticId('veo.astrophysics.sun.radiative_zone').ok).toBe(true);
    expect(parseSemanticId('veo.engineering.turbofan.fan_blade').ok).toBe(true);
  });

  it('rejects a foreign namespace', () => {
    const result = parseSemanticId('other.anatomy.heart');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('bad_namespace');
  });

  it('rejects uppercase, so identity never depends on casing', () => {
    const result = parseSemanticId('veo.anatomy.Heart');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('uppercase');
  });

  it('requires at least one path segment below the domain', () => {
    const result = parseSemanticId('veo.anatomy');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('too_few_segments');
  });

  it('rejects segments with illegal characters', () => {
    for (const bad of ['veo.anatomy.left-ventricle', 'veo.anatomy.left ventricle', 'veo.anatomy.']) {
      expect(parseSemanticId(bad).ok).toBe(false);
    }
  });

  it('rejects non-strings without throwing', () => {
    expect(parseSemanticId(null).ok).toBe(false);
    expect(parseSemanticId(42).ok).toBe(false);
    expect(parseSemanticId(undefined).ok).toBe(false);
  });
});

describe('buildSemanticId', () => {
  it('assembles a valid id', () => {
    expect(buildSemanticId('anatomy', 'heart', 'left_ventricle')).toBe(
      'veo.anatomy.heart.left_ventricle',
    );
  });

  it('throws on invalid input, because callers are source code', () => {
    expect(() => buildSemanticId('anatomy', 'Left Ventricle')).toThrow();
  });
});

describe('hierarchy', () => {
  const ventricle = 'veo.anatomy.heart.left_ventricle' as SemanticId;
  const heart = 'veo.anatomy.heart' as SemanticId;

  it('finds the parent, and stops at the domain root', () => {
    expect(semanticIdParent(ventricle)).toBe(heart);
    expect(semanticIdParent(heart)).toBeNull();
  });

  it('lists ancestors nearest first', () => {
    const deep = 'veo.anatomy.heart.valve.mitral' as SemanticId;
    expect(semanticIdAncestors(deep)).toEqual(['veo.anatomy.heart.valve', 'veo.anatomy.heart']);
  });

  it('computes depth below the domain', () => {
    expect(semanticIdDepth(heart)).toBe(1);
    expect(semanticIdDepth(ventricle)).toBe(2);
  });

  it('detects descendants without matching prefixes by accident', () => {
    expect(isDescendantOf(ventricle, heart)).toBe(true);
    expect(isDescendantOf(heart, heart)).toBe(false);
    // "heart_valve" must not count as a descendant of "heart".
    expect(isDescendantOf('veo.anatomy.heart_valve' as SemanticId, heart)).toBe(false);
  });

  it('extracts the domain', () => {
    expect(semanticIdDomain(ventricle)).toBe('anatomy');
  });
});

describe('helpers', () => {
  it('normalises vendor mesh names into legal segments', () => {
    expect(toSemanticSegment('Heart_LV 001')).toBe('heart_lv_001');
    expect(toSemanticSegment('mesh-0442')).toBe('mesh_0442');
    expect(toSemanticSegment('  Left  Ventricle  ')).toBe('left_ventricle');
    expect(toSemanticSegment('!!!')).toBeNull();
  });

  it('derives a readable label from the leaf', () => {
    expect(semanticIdToLabel('veo.anatomy.heart.left_ventricle' as SemanticId)).toBe(
      'Left Ventricle',
    );
  });

  it('acts as a type guard', () => {
    expect(isSemanticId('veo.anatomy.heart')).toBe(true);
    expect(isSemanticId('nope')).toBe(false);
  });
});
