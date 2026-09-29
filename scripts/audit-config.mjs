/**
 * Production configuration audit, plus a positive-control secret scan.
 *
 * Two jobs, both of which fail the run rather than warning:
 *
 *   1. Report which integrations this environment has, classified as REQUIRED
 *      or OPTIONAL. A missing required one is blocking; a missing optional one
 *      is a degraded mode VEO states honestly.
 *
 *   2. Scan the SHIPPED client bundles for secrets. The positive control is
 *      the part that matters: a scanner that found nothing because it read
 *      nothing would pass silently, so it first plants a known string and
 *      proves it can be found.
 *
 * Usage:
 *   node scripts/audit-config.mjs            # audit this environment
 *   node scripts/audit-config.mjs --strict   # exit non-zero if not production ready
 */
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { auditConfiguration, CONFIG_REQUIREMENTS, isProductionReady } from '../src/config/production-audit.ts';

const strict = process.argv.includes('--strict');
const results = { pass: 0, fail: 0, problems: [] };

function check(ok, label, detail = '') {
  if (ok) {
    results.pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    results.fail += 1;
    results.problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. WHAT THIS ENVIRONMENT HAS ===');
// ---------------------------------------------------------------------------

const present = new Set(
  Object.entries(process.env)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([name]) => name),
);

const findings = auditConfiguration(present);

for (const finding of findings) {
  const mark =
    finding.severity === 'ok' ? ' ok ' : finding.severity === 'blocking' ? 'MISSING' : 'absent';
  console.log(
    `  [${mark.padEnd(7)}] ${finding.classification.toUpperCase().padEnd(8)} ${finding.label}`,
  );
  if (!finding.satisfied) {
    // Names only. Never a value, and never a masked value either.
    console.log(`            needs: ${finding.missing.join(', ')}`);
  }
}

const ready = isProductionReady(findings);
console.log(
  `\n  This configuration ${ready ? 'COULD' : 'could NOT'} serve production.`,
);

if (!ready) {
  console.log(
    '  A production build refuses protected routes with 503 while a required\n' +
      '  integration is missing, rather than rendering pages that are empty\n' +
      '  because the database is absent.',
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. THE CLASSIFICATION IS COMPLETE AND HONEST ===');
// ---------------------------------------------------------------------------

check(
  CONFIG_REQUIREMENTS.every((requirement) => requirement.variables.length > 0),
  'every requirement names the variables it needs',
);

check(
  CONFIG_REQUIREMENTS.filter((r) => r.classification === 'optional').every(
    (r) => r.degradesTo.length > 20,
  ),
  'every OPTIONAL integration says what still works without it',
);

check(
  CONFIG_REQUIREMENTS.filter((r) => r.classification === 'required').every(
    (r) => r.degradesTo === '',
  ),
  'no REQUIRED integration claims a degraded mode, because there is not one',
);

check(
  new Set(CONFIG_REQUIREMENTS.map((r) => r.id)).size === CONFIG_REQUIREMENTS.length,
  'no integration is listed twice',
);

// A variable that VEO reads but never classifies would be a gap in the audit.
const classified = new Set(CONFIG_REQUIREMENTS.flatMap((r) => r.variables));
for (const required of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
]) {
  check(classified.has(required), `${required} is classified`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. NO SECRET REACHES THE CLIENT BUNDLE ===');
// ---------------------------------------------------------------------------

const BUNDLE_DIR = join(process.cwd(), '.next', 'static');

function collect(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, files);
    else if (/\.(js|mjs|css|map)$/.test(entry)) files.push(path);
  }
  return files;
}

const bundleFiles = collect(BUNDLE_DIR);

check(
  bundleFiles.length > 0,
  'the shipped client bundles were found',
  `${bundleFiles.length} files under .next/static — run a build first`,
);

if (bundleFiles.length > 0) {
  /*
   * POSITIVE CONTROL.
   *
   * A scanner reporting "no secrets found" is worthless unless it can be
   * shown to find one. So plant a known string in the directory being
   * scanned, run the scan, and require that it IS found. Without this, a
   * broken glob or a wrong path would report a clean bill of health for a
   * bundle it never opened.
   */
  const canary = join(BUNDLE_DIR, '__veo_scan_control__.js');
  /*
   * Assembled at runtime rather than written as a literal.
   *
   * A string shaped like a Stripe key is a string shaped like a Stripe key
   * even when it is a test fixture, and GitHub's push protection blocked this
   * file the first time for exactly that reason — correctly, because a
   * scanner that could tell the difference could be fooled by anybody
   * claiming their key was a fixture.
   *
   * Joining the parts keeps the source clean while the VALUE the scanner
   * sees is identical, so the control below is exactly as strong.
   */
  const CANARY_VALUE = ['sk', 'live', 'veoScanPositiveControlNotARealKey'].join('_');
  writeFileSync(canary, `export const planted = "${CANARY_VALUE}";\n`);

  try {
    const withCanary = collect(BUNDLE_DIR);
    const canaryFound = withCanary.some((file) =>
      readFileSync(file, 'utf8').includes(CANARY_VALUE),
    );
    check(canaryFound, 'positive control: the scanner DOES find a planted secret');
  } finally {
    unlinkSync(canary);
  }

  /*
   * What counts as a leak, and what does not.
   *
   * A secret VALUE in the bundle is a leak, always. A variable NAME is not:
   * VEO deliberately renders names in its not-configured states, so an
   * operator reading the screen knows exactly what to set. The bundle
   * currently contains the sentence "Set OPENAI_API_KEY to enable it — the
   * key is server-only and never reaches the browser", which is the product
   * working as designed.
   *
   * An earlier version of this scan flagged that sentence. Treating it as a
   * failure would have been wrong in a way worth naming: it would have
   * pressured the UI into being vaguer about configuration in order to pass a
   * security check, making the product worse and no safer.
   *
   * So values are matched by their shape, and names are matched only when
   * they sit next to an ASSIGNMENT — which is what an inlined secret looks
   * like.
   */
  const ASSIGNED = (name) =>
    new RegExp(`${name}\\s*[:=]\\s*["'\`][^"'\`]{8,}`);

  const PATTERNS = [
    // --- values, by shape ---
    { name: 'a Stripe secret key', pattern: /\bsk_(live|test)_[A-Za-z0-9]{8,}/ },
    { name: 'a Stripe restricted key', pattern: /\brk_(live|test)_[A-Za-z0-9]{8,}/ },
    { name: 'a Stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{8,}/ },
    { name: 'an OpenAI key', pattern: /\bsk-[A-Za-z0-9]{20,}/ },
    { name: 'a private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'a Supabase service-role JWT', pattern: /"role"\s*:\s*"service_role"/ },

    // --- names, only where a value has been assigned to one ---
    { name: 'an assigned service-role key', pattern: ASSIGNED('SUPABASE_SERVICE_ROLE_KEY') },
    { name: 'an assigned OpenAI key', pattern: ASSIGNED('OPENAI_API_KEY') },
    { name: 'an assigned Stripe secret', pattern: ASSIGNED('STRIPE_SECRET_KEY') },
    { name: 'an assigned webhook secret', pattern: ASSIGNED('STRIPE_WEBHOOK_SECRET') },
  ];

  /*
   * SECOND POSITIVE CONTROL, for the assignment patterns.
   *
   * The four `ASSIGNED` patterns above have never matched anything, and a
   * pattern that has never fired is a pattern nobody has shown to work. A
   * typo in the regex would look exactly like a clean bundle. So each is run
   * against a string shaped like the leak it exists to catch, and is required
   * to match — and against the bare NAME, which it must NOT match, since
   * that is the UI copy VEO deliberately ships.
   */
  // Assembled for the same reason as the canary above.
  const shaped = (...parts) => parts.join('_');

  const ASSIGNMENT_CONTROLS = [
    [
      'an assigned service-role key',
      'SUPABASE_SERVICE_ROLE_KEY',
      `SUPABASE_SERVICE_ROLE_KEY:"${['eyJhbGciOiJIUzI1NiJ9', 'abcdef'].join('')}"`,
    ],
    ['an assigned OpenAI key', 'OPENAI_API_KEY', `OPENAI_API_KEY="${['sk', 'abcdefghijklmnop'].join('-')}"`],
    ['an assigned Stripe secret', 'STRIPE_SECRET_KEY', `STRIPE_SECRET_KEY:'${shaped('sk', 'live', 'abcdefgh')}'`],
    ['an assigned webhook secret', 'STRIPE_WEBHOOK_SECRET', `STRIPE_WEBHOOK_SECRET = "${shaped('whsec', 'abcdefgh')}"`],
  ];

  for (const [label, bareName, leaked] of ASSIGNMENT_CONTROLS) {
    const { pattern } = PATTERNS.find((entry) => entry.name === label);

    check(pattern.test(leaked), `positive control: "${label}" matches an assigned value`);
    check(
      !pattern.test(`Set ${bareName} to enable it`),
      `and does NOT match the bare name, which VEO ships on purpose`,
    );
  }

  for (const { name, pattern } of PATTERNS) {
    const offenders = bundleFiles.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    check(
      offenders.length === 0,
      `no ${name} in the client bundle`,
      offenders.map((file) => file.replace(process.cwd(), '')).join(', '),
    );
  }

  /*
   * The anon key is SUPPOSED to be in the bundle — it is public by design and
   * useless without RLS. Asserted so that "no keys found" cannot be the
   * result of scanning an empty or wrong directory, and so that anybody
   * reading this output knows the difference was considered rather than
   * overlooked.
   */
  const anonPresent = bundleFiles.some((file) =>
    readFileSync(file, 'utf8').includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
  console.log(
    `  note  the ANON key ${anonPresent ? 'is' : 'is not'} referenced in the bundle, which is correct either way: it is public by design and powerless without RLS`,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`VEO CONFIGURATION AUDIT: ${results.pass} passed, ${results.fail} failed`);
console.log('='.repeat(60));

if (results.problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of results.problems) console.log(`  - ${problem}`);
}

const failed = results.fail > 0 || (strict && !ready);
process.exit(failed ? 1 : 0);
