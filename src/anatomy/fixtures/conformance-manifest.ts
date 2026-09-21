/**
 * ============================================================================
 * VEO PROVIDER CONFORMANCE FIXTURE — TEST CONTENT, NOT ANATOMY
 * ============================================================================
 *
 * A manifest that exercises every field of the contract so a provider
 * implementation can be proved against it. It is not a model of anything.
 *
 * Its structures are named "Fixture Root", "Fixture Structure A" and so on,
 * under the reserved `veo.anatomy.conformance_fixture` path. Nothing here is a
 * body part, and nothing here states an anatomical fact: the descriptions
 * describe what the fixture is FOR, and the system and region tags are
 * vocabulary values chosen to exercise grouping, not claims about where
 * anything sits in a body.
 *
 * It is deliberately absent from `ANATOMY_MODEL_CATALOG`, which is the
 * allowlist the server route enforces, so it can never be served to a learner.
 * A test asserts that.
 *
 * VEO does not ship stand-in anatomy. When no licensed asset is configured the
 * product says so; it does not quietly render a fixture and hope nobody looks
 * closely.
 * ============================================================================
 */

export const CONFORMANCE_FIXTURE_LABEL = 'VEO PROVIDER CONFORMANCE FIXTURE';

/** The reserved path. Nothing under it may reach the catalogue. */
export const CONFORMANCE_NAMESPACE = 'veo.anatomy.conformance_fixture';

const MODEL_ID = '00000000-0000-4000-8000-00000000c0f1';

const id = (...path: string[]): string =>
  [CONFORMANCE_NAMESPACE, ...path].filter(Boolean).join('.');

export const CONFORMANCE_IDS = {
  root: id(),
  groupA: id('group_a'),
  groupB: id('group_b'),
  structureA1: id('group_a', 'structure_a1'),
  structureA2: id('group_a', 'structure_a2'),
  structureB1: id('group_b', 'structure_b1'),
  structureB2: id('group_b', 'structure_b2'),
} as const;

/**
 * The fixture manifest, as raw JSON-shaped data.
 *
 * Untyped on purpose: the conformance suite feeds it through the real
 * validator, so a change to the schema that this fixture violates is caught
 * as a failing test rather than hidden by a type assertion.
 */
export function conformanceManifest(): Record<string, unknown> {
  return {
    formatVersion: 1,
    manifestVersion: '1.2.0',
    modelVersion: '3.4.5',
    modelId: MODEL_ID,
    provider: 'gltf-asset',
    domain: 'anatomy',
    name: CONFORMANCE_FIXTURE_LABEL,
    description:
      'Contract fixture used to verify provider implementations. Not a model of any body structure.',
    body: { sex: 'unspecified', ageGroup: 'unspecified', description: null },
    assetPath: 'conformance.glb',
    thumbnailPath: null,
    rootObjectId: CONFORMANCE_IDS.root,
    licence: {
      holder: 'VEO',
      kind: 'veo_owned',
      expiresAt: null,
      attributionRequired: false,
      licensedApplication: 'VEO',
      allowedPlatforms: ['web'],
    },
    assetProfile: {
      approximateBytes: 1024,
      triangleCount: 128,
      hasDracoCompression: false,
      hasKtx2Textures: false,
    },
    capabilities: {},
    systems: [
      { id: 'cardiovascular', name: 'Fixture System One', description: null, assetPath: null },
      { id: 'respiratory', name: 'Fixture System Two', description: null, assetPath: null },
    ],
    regions: [
      {
        id: 'thorax',
        semanticId: CONFORMANCE_IDS.groupA,
        name: 'Fixture Region One',
        description: null,
        objectIds: [CONFORMANCE_IDS.structureA1, CONFORMANCE_IDS.structureA2],
        assetPath: null,
        boundingBox: null,
      },
    ],
    layers: [
      {
        id: 'outer',
        name: 'Fixture Outer Layer',
        description: null,
        defaultVisible: true,
        order: 0,
        opacity: 0.15,
        peelable: true,
        peelMode: 'ghost',
        colorToken: null,
      },
      {
        id: 'middle',
        name: 'Fixture Middle Layer',
        description: null,
        defaultVisible: true,
        order: 1,
        opacity: 0.15,
        peelable: true,
        peelMode: 'ghost',
        colorToken: null,
      },
      {
        id: 'inner',
        name: 'Fixture Inner Layer',
        description: null,
        defaultVisible: true,
        order: 2,
        opacity: 0.15,
        peelable: false,
        peelMode: 'ghost',
        colorToken: null,
      },
    ],
    objects: [
      {
        semanticId: CONFORMANCE_IDS.root,
        providerId: 'fixture-root',
        name: 'Fixture Root',
        kind: 'group',
        parentId: null,
        meshes: [],
        system: null,
        region: null,
        layers: [],
      },
      {
        semanticId: CONFORMANCE_IDS.groupA,
        providerId: 'fixture-group-a',
        name: 'Fixture Group A',
        kind: 'group',
        parentId: CONFORMANCE_IDS.root,
        meshes: [],
        system: 'cardiovascular',
        region: 'thorax',
        layers: [],
      },
      {
        semanticId: CONFORMANCE_IDS.groupB,
        providerId: 'fixture-group-b',
        name: 'Fixture Group B',
        kind: 'group',
        parentId: CONFORMANCE_IDS.root,
        meshes: [],
        system: 'respiratory',
        region: 'abdomen',
        layers: [],
      },
      {
        semanticId: CONFORMANCE_IDS.structureA1,
        providerId: 'fixture-a1',
        name: 'Fixture Structure A1',
        officialName: 'Structura fictiva prima',
        kind: 'structure',
        parentId: CONFORMANCE_IDS.groupA,
        meshes: ['Fixture_A1_001'],
        system: 'cardiovascular',
        region: 'thorax',
        layers: ['outer'],
        latinName: 'Structura fictiva prima',
        laterality: 'left',
        description: 'A fixture structure. Exists to exercise the contract, not to describe a body.',
        function: 'Exercises descriptive metadata handling.',
        synonyms: ['Fixture A1'],
        clinicalNotes: [],
        references: [
          { source: 'VEO conformance fixture', citation: 'fixture/A1', url: null },
        ],
        educationalLevel: 'foundation',
        externalIds: { FIXTURE: 'A1' },
        boundingBox: { min: [-1, -1, -1], max: [0, 1, 1] },
        explodedOffset: [-1.5, 0, 0],
      },
      {
        semanticId: CONFORMANCE_IDS.structureA2,
        providerId: 'fixture-a2',
        name: 'Fixture Structure A2',
        kind: 'structure',
        parentId: CONFORMANCE_IDS.groupA,
        meshes: ['Fixture_A2_001', 'Fixture_A2_002'],
        system: 'cardiovascular',
        region: 'thorax',
        layers: ['middle'],
        boundingBox: { min: [0, -1, -1], max: [1, 1, 1] },
      },
      {
        semanticId: CONFORMANCE_IDS.structureB1,
        providerId: 'fixture-b1',
        name: 'Fixture Structure B1',
        kind: 'structure',
        parentId: CONFORMANCE_IDS.groupB,
        meshes: ['Fixture_B1_001'],
        system: 'respiratory',
        region: 'abdomen',
        layers: ['outer'],
      },
      {
        semanticId: CONFORMANCE_IDS.structureB2,
        providerId: 'fixture-b2',
        name: 'Fixture Structure B2',
        kind: 'structure',
        parentId: CONFORMANCE_IDS.groupB,
        meshes: ['Fixture_B2_001'],
        system: 'respiratory',
        region: 'abdomen',
        layers: ['inner'],
      },
    ],
    relationships: [
      {
        id: 'fixture-rel-1',
        source: CONFORMANCE_IDS.structureA1,
        target: CONFORMANCE_IDS.structureA2,
        kind: 'adjacent_to',
        label: 'Fixture Structure A2',
        bidirectional: true,
        confidence: 1,
      },
      {
        id: 'fixture-rel-2',
        source: CONFORMANCE_IDS.structureA1,
        target: CONFORMANCE_IDS.structureB1,
        kind: 'supplies',
        label: 'Fixture Structure B1',
        bidirectional: false,
        confidence: 1,
      },
    ],
    explosion: [
      {
        id: 'fixture-group-b',
        objectIds: [CONFORMANCE_IDS.structureB1, CONFORMANCE_IDS.structureB2],
        center: [0, 0, 0],
        scale: 1.5,
        spacing: 0.8,
      },
    ],
  };
}

/** Mesh names the fixture's asset would contain, for the asset cross-check. */
export const CONFORMANCE_MESH_NAMES: readonly string[] = [
  'Fixture_A1_001',
  'Fixture_A2_001',
  'Fixture_A2_002',
  'Fixture_B1_001',
  'Fixture_B2_001',
];
