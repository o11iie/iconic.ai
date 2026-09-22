import 'server-only';

import { buildDiagnosticGraph, DIAGNOSTIC_MODEL_REF } from '@/engine/3d/diagnostics/diagnostic-scene';
import { findCatalogEntry } from '@/anatomy/models/catalog';
import { manifestToGraph } from '@/anatomy/mapping/graph';
import { parseManifest } from '@/anatomy/mapping/validation';
import { anatomyProviderConfig, anatomyServerEnv } from '@/config/anatomy.server';
import { env } from '@/config/env';
import type { SpatialModelGraph } from '@/types/domain/spatial';
import { buildTutorFixtureGraph, TUTOR_FIXTURE_MODEL_REF } from '../fixtures/tutor-fixture-ref';

/**
 * Resolving a model reference to a graph, SERVER-SIDE.
 *
 * This is the reason the tutor route does not accept a graph from the browser.
 *
 * A client-supplied graph would mean a client could describe any structure it
 * liked — inventing names, descriptions and relationships — and VEO would
 * faithfully feed them to the model as though they were licensed content. The
 * tutor's honesty guarantees would then be worth exactly nothing, because the
 * thing it is honest ABOUT would be attacker-controlled.
 *
 * So the browser sends a model reference and a semantic id. The server decides
 * what that model contains. The browser's own scene state still comes from the
 * browser — it is the only place that knows what the learner has hidden — but
 * scene state cannot invent a structure, only describe the display of one the
 * server already resolved.
 */

export type ModelResolution =
  | { readonly ok: true; readonly graph: SpatialModelGraph; readonly isFixture: boolean }
  | { readonly ok: false; readonly code: 'unknown_model' | 'not_configured'; readonly message: string };

/**
 * Resolve a model reference.
 *
 * Controlled test content is resolved locally and marked as a fixture, so the
 * prompt can state plainly that it is test content. Everything else goes
 * through the catalogue allowlist and the licensed provider, exactly as the
 * anatomy route does — the tutor gets no privileged path to content the rest
 * of the product cannot serve.
 */
export async function resolveModelGraph(modelRef: string): Promise<ModelResolution> {
  if (modelRef === TUTOR_FIXTURE_MODEL_REF) {
    return { ok: true, graph: buildTutorFixtureGraph(), isFixture: true };
  }

  if (modelRef === DIAGNOSTIC_MODEL_REF) {
    return { ok: true, graph: buildDiagnosticGraph(), isFixture: true };
  }

  const entry = findCatalogEntry(modelRef);
  if (!entry) {
    return {
      ok: false,
      code: 'unknown_model',
      message: `No model "${modelRef}" is in the VEO catalogue.`,
    };
  }

  const config = anatomyProviderConfig(env.NEXT_PUBLIC_ANATOMY_PROVIDER);
  if (!config.configured) {
    return {
      ok: false,
      code: 'not_configured',
      message: config.reason ?? 'No licensed anatomy source is configured.',
    };
  }

  const base = anatomyServerEnv().ANATOMY_ASSET_BASE_URL?.replace(/\/+$/, '') ?? null;
  if (!base) {
    return {
      ok: false,
      code: 'not_configured',
      message:
        'A hosted anatomy provider is configured but no asset host is set, so no manifest can be resolved.',
    };
  }

  let payload: unknown;
  try {
    const response = await fetch(`${base}/${modelRef}/manifest.json`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return {
        ok: false,
        code: 'not_configured',
        message: `The licensed host did not return a manifest for "${modelRef}".`,
      };
    }
    payload = await response.json();
  } catch {
    // The upstream reason stays here: it can carry host names and request ids.
    return {
      ok: false,
      code: 'not_configured',
      message: `The licensed host could not be reached for "${modelRef}".`,
    };
  }

  const manifest = parseManifest(payload);
  if (!manifest.ok) {
    return {
      ok: false,
      code: 'not_configured',
      message: `The manifest for "${modelRef}" did not pass validation, so VEO will not describe it.`,
    };
  }

  return {
    ok: true,
    graph: manifestToGraph(manifest.value, {
      providerId: env.NEXT_PUBLIC_ANATOMY_PROVIDER,
      baseUrl: base,
    }),
    isFixture: false,
  };
}
