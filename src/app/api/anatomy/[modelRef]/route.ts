import { NextResponse } from 'next/server';
import { env } from '@/config/env';
import { anatomyProviderConfig, anatomyServerEnv } from '@/config/anatomy.server';
import { findCatalogEntry } from '@/anatomy/models/catalog';
import { validateManifest } from '@/anatomy/mapping/validation';

export const dynamic = 'force-dynamic';

/**
 * Model access.
 *
 *     browser  →  VEO server  →  licensed provider  →  temporary resource
 *
 * The browser asks VEO for a model by its catalogue reference. VEO holds the
 * credential, fetches and validates the manifest, and returns it along with a
 * URL for the geometry that is time-limited when the licence requires it.
 *
 * Two things never cross this boundary. The provider's credential, obviously.
 * And the raw asset path on the licensed host — a learner receives a URL that
 * grants access to view the model, not the address of a downloadable source
 * file on someone's licensed CDN.
 *
 * A manifest that fails validation is refused here rather than in the browser.
 * A mislabelled structure renders perfectly and teaches something false, so
 * the cheapest place to stop it is before it is ever served.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ modelRef: string }> },
) {
  const { modelRef } = await context.params;

  // The catalogue is the allowlist. Without this the route is an open proxy
  // to any path on the licensed host, which is precisely the extraction
  // vector a licence forbids.
  const entry = findCatalogEntry(modelRef);
  if (!entry) {
    return NextResponse.json(
      { error: 'unknown_model', message: `No model "${modelRef}" is in the VEO catalogue.` },
      { status: 404 },
    );
  }

  const config = anatomyProviderConfig(env.NEXT_PUBLIC_ANATOMY_PROVIDER);
  if (!config.configured) {
    return NextResponse.json(
      { error: 'not_configured', message: config.reason },
      { status: 503 },
    );
  }

  const server = anatomyServerEnv();
  const base = server.ANATOMY_ASSET_BASE_URL?.replace(/\/+$/, '') ?? null;

  if (!base) {
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          'A hosted anatomy provider is configured but no asset host is set. Hosted-provider asset resolution is implemented by the provider adapter for that vendor.',
      },
      { status: 503 },
    );
  }

  const manifestUrl = `${base}/${modelRef}/manifest.json`;

  let payload: unknown;
  try {
    const response = await fetch(manifestUrl, {
      headers: {
        accept: 'application/json',
        ...(server.ANATOMY_PROVIDER_API_KEY
          ? { authorization: `Bearer ${server.ANATOMY_PROVIDER_API_KEY}` }
          : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'manifest_unavailable',
          message: `The licensed asset host returned HTTP ${response.status} for this model's manifest.`,
        },
        { status: 502 },
      );
    }
    payload = await response.json();
  } catch {
    // The upstream error is deliberately not echoed: it can carry the host,
    // the path and occasionally the credential that failed.
    return NextResponse.json(
      {
        error: 'manifest_unavailable',
        message: 'The licensed asset host could not be reached.',
      },
      { status: 502 },
    );
  }

  const result = validateManifest(payload);
  if ('issues' in result) {
    return NextResponse.json(
      { error: 'manifest_invalid', message: result.message, issues: result.issues },
      { status: 422 },
    );
  }
  if (result.errors.length > 0) {
    return NextResponse.json(
      {
        error: 'manifest_invalid',
        message: 'The model manifest is internally inconsistent and was refused.',
        issues: result.errors.map((i) => `${i.code}: ${i.message}`),
      },
      { status: 422 },
    );
  }

  const manifest = result.manifest;

  return NextResponse.json({
    modelRef,
    manifest,
    assetUrl: `${base}/${modelRef}/${manifest.assetPath}`,
    delivery: config.delivery,
    expiresInSeconds:
      config.delivery === 'server_mediated' ? server.ANATOMY_ASSET_URL_TTL_SECONDS : null,
    warnings: result.warnings.map((i) => `${i.code}: ${i.message}`),
  });
}
