import { describe, expect, it } from 'vitest';
import { ANATOMY_MODEL_CATALOG, findCatalogEntry } from '@/anatomy/models/catalog';
import { anatomyProviderConfig } from '@/config/anatomy.server';
import {
  buildTutorFixtureGraph,
  TUTOR_FIXTURE_LABEL,
  TUTOR_FIXTURE_NAMESPACE,
} from './tutor-fixture';
import { TUTOR_FIXTURE_MODEL_REF } from './tutor-fixture-ref';

/**
 * The fixture must never be mistaken for the product working.
 *
 * Gate 9 is RED: VEO has no licensed anatomy. The tutor fixture exists so the
 * tutor architecture can be proved anyway — and the risk that creates is that
 * controlled test content quietly becomes the thing a learner sees, or the
 * thing a demo shows. These tests are the guard on that.
 */

describe('the fixture stays out of the product', () => {
  it('is absent from the anatomy catalogue, which is the serving allowlist', () => {
    expect(findCatalogEntry(TUTOR_FIXTURE_MODEL_REF)).toBeNull();
  });

  it('shares no model reference with any catalogue entry', () => {
    const refs = ANATOMY_MODEL_CATALOG.map((entry) => entry.modelRef);
    expect(refs).not.toContain(TUTOR_FIXTURE_MODEL_REF);
  });

  it('lives outside the anatomy namespace entirely', () => {
    // Not merely a different path under `veo.anatomy` — a different domain, so
    // no anatomy query can ever reach it.
    expect(TUTOR_FIXTURE_NAMESPACE.startsWith('veo.anatomy')).toBe(false);
    expect(TUTOR_FIXTURE_NAMESPACE.startsWith('veo.diagnostic')).toBe(true);

    for (const id of buildTutorFixtureGraph().objects.keys()) {
      expect(id.startsWith(TUTOR_FIXTURE_NAMESPACE)).toBe(true);
    }
  });

  it('is not in the anatomy domain', () => {
    expect(buildTutorFixtureGraph().model.domain).toBe('diagnostic');
  });

  it('says what it is in its own name', () => {
    // Whatever surface renders it, the label travels with it.
    expect(TUTOR_FIXTURE_LABEL).toContain('TEST FIXTURE');
    expect(buildTutorFixtureGraph().model.name).toBe(TUTOR_FIXTURE_LABEL);
  });

  it('claims no licence it does not hold', () => {
    const licence = buildTutorFixtureGraph().model.licence;
    expect(licence.kind).toBe('veo_owned');
    expect(licence.holder).toBe('VEO');
  });
});

describe('no fixture structure states an anatomical fact', () => {
  it('names nothing anatomical', () => {
    const graph = buildTutorFixtureGraph();
    const text = [...graph.objects.values()]
      .map((o) => `${o.name} ${o.description ?? ''} ${o.synonyms.join(' ')}`)
      .join(' ')
      .toLowerCase();

    // A representative sweep. The point is not exhaustiveness — it is that a
    // future edit adding plausible anatomy to this fixture fails a test.
    for (const term of [
      'heart',
      'ventricle',
      'atrium',
      'artery',
      'vein',
      'muscle',
      'bone',
      'femur',
      'nerve',
      'brain',
      'lung',
      'kidney',
      'liver',
    ]) {
      expect(text).not.toContain(term);
    }
  });

  it('describes its structures only in terms of the fixture itself', () => {
    const core = buildTutorFixtureGraph().objects.get(
      `${TUTOR_FIXTURE_NAMESPACE}.assembly_a.core_unit` as never,
    );
    expect(core?.description).toContain('fixture');
  });
});

describe('Gate 9 remains honest', () => {
  it('reports no licensed anatomy source in this environment', () => {
    // The tutor working against a fixture must not make the product claim it
    // has anatomy. This is the same check Gate 8 and Gate 9 assert, repeated
    // here because Gate 10 is exactly where the temptation to blur it arises.
    const config = anatomyProviderConfig('gltf-asset');

    expect(config.configured).toBe(false);
    expect(config.delivery).toBe('none');
    expect(config.reason).toContain('No licensed anatomy source is configured');
  });

  it('every catalogue entry still declares that it needs a licensed asset', () => {
    for (const entry of ANATOMY_MODEL_CATALOG) {
      expect(entry.licensedAssetRequired).toBe(true);
    }
  });
});
