/**
 * Anatomy asset validation.
 *
 * Checks a manifest before it is ever served. A mislabelled structure renders
 * perfectly, selects perfectly and teaches a learner something false, with
 * nothing in the running application looking broken — so the cheapest place to
 * catch it is here, at authoring time.
 *
 * Usage:
 *   npm run validate:anatomy                      validate the conformance fixture
 *   npm run validate:anatomy -- <path-or-url>     validate a real manifest
 *   npm run validate:anatomy -- <path> --asset <file.glb>
 *
 * With `--asset`, mesh names and the model version are read from the asset
 * itself and cross-checked, which is the only way to catch a manifest that is
 * internally perfect but describes a different revision of the geometry.
 *
 * Exit code 0 means the manifest may be served. Warnings never fail: a model
 * that is merely incomplete is still useful, and failing it would push authors
 * towards inventing content to satisfy a validator.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validateManifest, type ManifestIssue } from '../src/anatomy/mapping/validation';
import {
  CONFORMANCE_FIXTURE_LABEL,
  conformanceManifest,
} from '../src/anatomy/fixtures/conformance-manifest';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const flagIndex = args.indexOf('--asset');
const assetPath = flagIndex >= 0 ? args[flagIndex + 1] : null;
const target = positional[0] ?? null;

const BOLD = '\u001b[1m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const GREEN = '\u001b[32m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

interface AssetFacts {
  meshNames?: readonly string[];
  modelVersion?: string | null;
}

async function loadPayload(): Promise<{ payload: unknown; source: string }> {
  if (!target) {
    console.log(
      `${DIM}No manifest given; validating the built-in contract fixture.${RESET}\n` +
        `${DIM}${CONFORMANCE_FIXTURE_LABEL} — test content, not anatomy.${RESET}\n`,
    );
    return { payload: conformanceManifest(), source: 'built-in conformance fixture' };
  }

  if (/^https?:\/\//.test(target)) {
    const response = await fetch(target, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Manifest request failed with HTTP ${response.status}: ${target}`);
    }
    return { payload: await response.json(), source: target };
  }

  const path = resolve(process.cwd(), target);
  return { payload: JSON.parse(await readFile(path, 'utf8')), source: path };
}

/**
 * Read mesh names and a version stamp out of a GLB/GLTF.
 *
 * Deliberately minimal: enough to cross-check the manifest without pulling a
 * full GLTF parser into a validation script. A .glb's JSON chunk is read
 * directly; a .gltf is already JSON.
 */
async function readAssetFacts(path: string): Promise<AssetFacts> {
  const absolute = resolve(process.cwd(), path);
  const buffer = await readFile(absolute);

  let gltf: {
    nodes?: { name?: string }[];
    meshes?: { name?: string }[];
    asset?: { extras?: { modelVersion?: string; version?: string } };
  };
  if (absolute.endsWith('.glb')) {
    // GLB: 12-byte header, then chunks. The first chunk is the JSON.
    const magic = buffer.readUInt32LE(0);
    if (magic !== 0x46546c67) throw new Error(`${path} is not a GLB file.`);
    const chunkLength = buffer.readUInt32LE(12);
    gltf = JSON.parse(buffer.subarray(20, 20 + chunkLength).toString('utf8'));
  } else {
    gltf = JSON.parse(buffer.toString('utf8'));
  }

  const meshNames: string[] = [];
  for (const node of gltf.nodes ?? []) {
    if (typeof node.name === 'string') meshNames.push(node.name);
  }
  for (const mesh of gltf.meshes ?? []) {
    if (typeof mesh.name === 'string') meshNames.push(mesh.name);
  }

  // Vendors stamp a version in asset.version, asset.extras or a custom key.
  const modelVersion =
    gltf.asset?.extras?.modelVersion ?? gltf.asset?.extras?.version ?? null;

  return { meshNames: [...new Set(meshNames)], modelVersion };
}

function report(list: readonly ManifestIssue[], colour: string, label: string) {
  if (list.length === 0) return;
  console.log(`${colour}${BOLD}${label} (${list.length})${RESET}`);
  for (const item of list) {
    const subject = item.subject ? ` ${DIM}[${item.subject}]${RESET}` : '';
    console.log(`  ${colour}${item.code}${RESET}${subject}\n    ${item.message}`);
  }
  console.log('');
}

async function main() {
  const { payload, source } = await loadPayload();

  let assetFacts: AssetFacts = {};
  if (assetPath) {
    assetFacts = await readAssetFacts(assetPath);
    console.log(
      `${DIM}Cross-checking against ${assetPath}: ${assetFacts.meshNames?.length ?? 0} mesh names, ` +
        `version ${assetFacts.modelVersion ?? 'not stamped'}.${RESET}\n`,
    );
  }

  const result = validateManifest(payload, assetFacts);

  console.log(`${BOLD}VEO anatomy manifest validation${RESET}`);
  console.log(`${DIM}${source}${RESET}\n`);

  if ('issues' in result) {
    console.log(`${RED}${BOLD}SCHEMA INVALID${RESET}`);
    console.log(`  ${result.message}`);
    for (const issue of result.issues) console.log(`    - ${issue}`);
    process.exit(1);
  }

  const { manifest, errors, warnings } = result;

  console.log(
    `  model          ${manifest.name}\n` +
      `  provider       ${manifest.provider}\n` +
      `  model version  ${manifest.modelVersion}\n` +
      `  manifest ver.  ${manifest.manifestVersion} (format ${manifest.formatVersion})\n` +
      `  licence        ${manifest.licence.kind}, ${manifest.licence.holder}` +
      `${manifest.licence.expiresAt ? `, expires ${manifest.licence.expiresAt}` : ''}\n` +
      `  structures     ${manifest.objects.length}\n` +
      `  layers         ${manifest.layers.length}\n` +
      `  systems        ${manifest.systems.length}\n` +
      `  regions        ${manifest.regions.length}\n` +
      `  relationships  ${manifest.relationships.length}\n`,
  );

  report(errors, RED, 'ERRORS');
  report(warnings, YELLOW, 'WARNINGS');

  if (errors.length > 0) {
    console.log(`${RED}${BOLD}REFUSED${RESET} — ${errors.length} error(s). This manifest must not be served.`);
    process.exit(1);
  }

  const suffix = warnings.length > 0 ? ` with ${warnings.length} warning(s)` : '';
  console.log(`${GREEN}${BOLD}VALID${RESET}${suffix} — this manifest may be served.`);
}

main().catch((error) => {
  console.error(`${RED}${BOLD}VALIDATION FAILED${RESET}`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
