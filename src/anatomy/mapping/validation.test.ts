import { describe, expect, it } from 'vitest';
import { conformanceManifest } from '../fixtures/conformance-manifest';
import { parseManifest, validateManifest } from './validation';

/**
 * Validator tests.
 *
 * Every case here is a way a hand-authored manifest goes quietly wrong. A
 * validator that only ever says "valid" is worth nothing, so each check is
 * proved by a manifest that must be refused.
 */

type Loose = Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */

function fixture(mutate: (manifest: any) => void = () => {}): Loose {
  const manifest = conformanceManifest();
  mutate(manifest);
  return manifest;
}

function codes(input: Loose): readonly string[] {
  const result = validateManifest(input);
  if ('issues' in result) return ['schema_invalid'];
  return result.errors.map((issue) => issue.code);
}

describe('manifest validation', () => {
  it('accepts the conformance fixture', () => {
    const result = validateManifest(conformanceManifest());
    expect('issues' in result).toBe(false);
    if (!('issues' in result)) expect(result.errors).toEqual([]);
  });

  it('rejects a payload that is not a manifest at all', () => {
    expect(codes({ nonsense: true })).toContain('schema_invalid');
    expect(codes(fixture((m) => delete m.formatVersion))).toContain('schema_invalid');
  });

  it('catches a duplicate semantic id', () => {
    const codeList = codes(
      fixture((m) => {
        m.objects[4].semanticId = m.objects[3].semanticId;
      }),
    );
    expect(codeList).toContain('duplicate_semantic_id');
  });

  it('catches an orphaned parent', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[3].parentId = 'veo.anatomy.nowhere.at_all';
        }),
      ),
    ).toContain('orphaned_parent');
  });

  it('catches a circular hierarchy rather than hanging on it', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[1].parentId = m.objects[3].semanticId;
        }),
      ),
    ).toContain('circular_hierarchy');
  });

  it('catches a missing root', () => {
    expect(
      codes(
        fixture((m) => {
          m.rootObjectId = 'veo.anatomy.conformance_fixture.not_here';
        }),
      ),
    ).toContain('missing_root');
  });

  it('catches an id from another domain', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[5].semanticId = 'veo.engineering.turbine.rotor';
          m.objects[5].parentId = null;
        }),
      ),
    ).toContain('foreign_namespace');
  });

  it('catches a leaf with nothing to render', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[6].meshes = [];
          m.objects[6].providerId = null;
        }),
      ),
    ).toContain('unresolvable_geometry');
  });

  it('allows a grouping node with no geometry of its own', () => {
    // Groups legitimately have neither mesh nor provider id: they are declared
    // structure, not drawn structure.
    const result = validateManifest(conformanceManifest());
    if ('issues' in result) throw new Error('fixture should be valid');
    expect(result.errors.map((i) => i.code)).not.toContain('unresolvable_geometry');
  });

  it('catches a mesh claimed by two structures', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[4].meshes = ['Fixture_A1_001'];
        }),
      ),
    ).toContain('ambiguous_mesh');
  });

  it('catches a provider id claimed by two structures', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[4].providerId = 'fixture-a1';
        }),
      ),
    ).toContain('ambiguous_provider_id');
  });

  it('catches an unresolved relationship', () => {
    expect(
      codes(
        fixture((m) => {
          m.relationships[0].target = 'veo.anatomy.missing.thing';
        }),
      ),
    ).toContain('unresolved_relationship');
  });

  it('catches a structure in an undeclared layer', () => {
    expect(
      codes(
        fixture((m) => {
          m.objects[3].layers = ['no_such_layer'];
        }),
      ),
    ).toContain('unresolved_layer');
  });

  it('catches an unresolved region member', () => {
    expect(
      codes(
        fixture((m) => {
          m.regions[0].objectIds = ['veo.anatomy.conformance_fixture.ghost'];
        }),
      ),
    ).toContain('unresolved_region_member');
  });

  it('catches an unresolved exploded group member', () => {
    expect(
      codes(
        fixture((m) => {
          m.explosion[0].objectIds = ['veo.anatomy.conformance_fixture.ghost'];
        }),
      ),
    ).toContain('unresolved_explosion_member');
  });

  it('catches a declared system no structure belongs to', () => {
    expect(
      codes(
        fixture((m) => {
          m.systems.push({ id: 'skeletal', name: 'Nothing', description: null, assetPath: null });
        }),
      ),
    ).toContain('empty_declared_system');
  });

  it('refuses a capability the data cannot support', () => {
    // Gate 7's rule, enforced where a manifest is authored: a manifest may
    // switch a capability off, never on.
    const codeList = codes(
      fixture((m) => {
        m.layers = [];
        m.objects.forEach((object: any) => {
          object.layers = [];
        });
        m.capabilities = { supportsLayers: true, supportsPeeling: true };
      }),
    );

    expect(codeList.filter((code) => code === 'unsupported_capability_claim')).toHaveLength(2);
  });

  it('accepts a capability switched off', () => {
    const result = validateManifest(
      fixture((m) => {
        m.capabilities = { supportsDissection: false };
      }),
    );
    if ('issues' in result) throw new Error('should parse');
    expect(result.errors).toEqual([]);
  });

  // ---- asset cross-check --------------------------------------------------

  it('catches geometry from a different revision', () => {
    const result = validateManifest(conformanceManifest(), { modelVersion: '9.9.9' });
    if ('issues' in result) throw new Error('should parse');

    expect(result.errors.map((i) => i.code)).toContain('version_mismatch');
  });

  it('accepts geometry from the matching revision', () => {
    const result = validateManifest(conformanceManifest(), { modelVersion: '3.4.5' });
    if ('issues' in result) throw new Error('should parse');
    expect(result.errors).toEqual([]);
  });

  it('catches a mapped mesh the asset does not contain', () => {
    const result = validateManifest(conformanceManifest(), {
      meshNames: ['Fixture_A1_001'],
    });
    if ('issues' in result) throw new Error('should parse');

    expect(result.errors.map((i) => i.code)).toContain('missing_mesh');
  });

  // ---- warnings never block -----------------------------------------------

  it('warns about an unsourced descriptive claim without refusing it', () => {
    const result = validateManifest(
      fixture((m) => {
        m.objects[4].description = 'Something asserted with no citation.';
      }),
    );
    if ('issues' in result) throw new Error('should parse');

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((i) => i.code)).toContain('unsourced_claim');
  });

  it('warns about a relationship kind outside the vocabulary', () => {
    const result = validateManifest(
      fixture((m) => {
        m.relationships[0].kind = 'wibbles_against';
      }),
    );
    if ('issues' in result) throw new Error('should parse');

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((i) => i.code)).toContain('unknown_relationship_kind');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const result = validateManifest(
      fixture((m) => {
        m.objects[3].parentId = 'veo.anatomy.nowhere';
        m.relationships[0].target = 'veo.anatomy.also_nowhere';
        m.objects[4].layers = ['no_such_layer'];
      }),
    );
    if ('issues' in result) throw new Error('should parse');

    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  // ---- the load-time entry point -----------------------------------------

  it('parseManifest refuses on errors and passes on warnings', () => {
    expect(parseManifest(conformanceManifest()).ok).toBe(true);

    expect(
      parseManifest(
        fixture((m) => {
          m.objects[4].description = 'Unsourced but harmless.';
        }),
      ).ok,
    ).toBe(true);

    expect(
      parseManifest(
        fixture((m) => {
          m.objects[3].parentId = 'veo.anatomy.nowhere';
        }),
      ).ok,
    ).toBe(false);
  });
});
