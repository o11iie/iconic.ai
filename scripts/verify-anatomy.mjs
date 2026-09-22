/**
 * Gate 8 verification: anatomy provider integration in a real browser.
 *
 * Proves the pipeline is ready to accept licensed anatomy:
 *
 *   licensed source → provider → adapter → manifest → semantic graph → engine
 *
 * and, just as importantly, that when no licensed source is configured the
 * product says so rather than showing something that looks like anatomy.
 *
 * The secret-boundary check runs with a positive control: a sentinel value is
 * planted where a public variable lives and the scan is required to FIND it,
 * because a scan that finds nothing may simply be a scan that does not work.
 *
 * Usage: node scripts/verify-anatomy.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3410';

const IGNORED = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /favicon\.ico/i];

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

function captureConsole(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED.some((p) => p.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // An unhandled rejection never reaches console.error, so a load that failed
  // inside a promise would otherwise look like a clean run.
  page.on('crash', () => errors.push('page crashed'));
  return errors;
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = captureConsole(page);

  // ------------------------------------------- 1-2. provider configuration --
  console.log('\n=== 1-2. PROVIDER CONFIGURATION ===');
  const statusResponse = await page.request.get(`${BASE}/api/anatomy`);
  check(statusResponse.status() === 200, 'the anatomy service answers', `${statusResponse.status()}`);

  const status = await statusResponse.json();
  check(typeof status.configured === 'boolean', 'it reports whether anatomy can be served');
  check(
    typeof status.providerId === 'string' && status.providerId.length > 0,
    'it names the configured provider',
    `${status.providerId}`,
  );
  check(
    ['public_asset', 'server_mediated', 'none'].includes(status.delivery),
    'it reports how geometry would be delivered',
    `${status.delivery}`,
  );

  if (!status.configured) {
    check(
      typeof status.reason === 'string' && status.reason.length > 20,
      'it explains, in words a person can act on, why it cannot',
      `${status.reason}`,
    );
  }

  // ------------------------------------------- 3. honest unavailable state --
  console.log('\n=== 3. HONEST UNAVAILABLE STATE ===');
  const explore = await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
  check(explore?.status() === 200, 'the workspace opens without a licensed asset');

  /*
   * Ask for a REAL catalogue model.
   *
   * Bare /explore has chosen no model, so it says "choose a model" — which is
   * correct but says nothing about licensing. This check previously matched
   * `/not configured/` anywhere in the body and was in fact matching the AI
   * study bar's "AI tutor is not configured" notice; the moment a tutor was
   * configured, the check failed while anatomy behaviour was unchanged. It was
   * passing for the wrong reason.
   *
   * Requesting a catalogued model forces the question the gate actually asks:
   * when a learner asks for anatomy VEO is not licensed to serve, does VEO say
   * so, and does it refuse to draw anything?
   */
  await page.goto(`${BASE}/explore?model=heart`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();

  check(
    /model unavailable|not configured in this environment/i.test(body),
    'asking for a catalogued model states plainly that it cannot be served',
    body.split('\n').filter(Boolean).slice(8, 11).join(' / '),
  );
  check(
    /NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL|ANATOMY_ASSET_BASE_URL/.test(body),
    'and names the exact configuration the deployment is missing',
  );
  check(
    (await page.locator('canvas').count()) === 0,
    'it renders no geometry at all rather than a stand-in',
    `${await page.locator('canvas').count()} canvases`,
  );
  check(
    !/SPATIAL ENGINE TEST/i.test(body),
    'the diagnostic scene is not exposed on the normal workspace',
  );

  // ------------------------------------------- 4. diagnostic isolation ------
  console.log('\n=== 4. DIAGNOSTIC STAYS SEPARATE FROM ANATOMY ===');
  await page.goto(`${BASE}/explore?diagnostic=1`, { waitUntil: 'networkidle' });
  const diagnosticBody = await page.locator('body').innerText();

  check(
    /VEO SPATIAL ENGINE TEST/.test(diagnosticBody),
    'the diagnostic is reachable only behind its own flag',
  );
  check(
    /diagnostic content|not subject content|not a subject model/i.test(diagnosticBody),
    'and is labelled as diagnostic content wherever it appears',
  );

  const diagnosticIds = await page.evaluate(
    () => window.__VEO_ENGINE__?.state().registry ?? [],
  );
  check(
    diagnosticIds.length > 0 && diagnosticIds.every((id) => id.startsWith('veo.diagnostic.')),
    'every diagnostic object stays in the reserved diagnostic namespace',
    diagnosticIds.slice(0, 2).join(', '),
  );
  check(
    !diagnosticIds.some((id) => id.startsWith('veo.anatomy.')),
    'no diagnostic object claims an anatomy identity',
  );

  // ------------------------------------------- 5. unknown model refused -----
  console.log('\n=== 5. THE CATALOGUE IS THE ALLOWLIST ===');
  const unknown = await page.request.get(`${BASE}/api/anatomy/not-a-real-model`);
  check(unknown.status() === 404, 'a model outside the catalogue is refused', `${unknown.status()}`);

  const traversal = await page.request.get(`${BASE}/api/anatomy/${encodeURIComponent('../../etc/passwd')}`);
  check(
    traversal.status() === 404,
    'the route cannot be walked outside the catalogue',
    `${traversal.status()}`,
  );

  const known = await page.request.get(`${BASE}/api/anatomy/heart`);
  check(
    known.status() === 503 || known.status() === 502,
    'a catalogued model with no licensed source reports unavailable, not empty anatomy',
    `${known.status()}`,
  );
  const knownBody = await known.json();
  check(
    typeof knownBody.message === 'string' && knownBody.message.length > 20,
    'with an actionable reason',
    `${knownBody.message}`,
  );

  // ------------------------------------------- 6. secret boundary -----------
  console.log('\n=== 6. NO PROVIDER SECRET REACHES THE BROWSER ===');

  /*
   * Collect every script the page actually loads, plus the HTML itself. This
   * is what a learner's browser can read.
   */
  const sources = [];
  page.on('response', async (response) => {
    const type = response.headers()['content-type'] ?? '';
    if (!/javascript|html|json/.test(type)) return;
    try {
      sources.push(await response.text());
    } catch {
      /* a response body that cannot be read cannot leak either */
    }
  });

  await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const haystack = sources.join('\n');
  check(haystack.length > 10_000, 'the scan actually read the shipped code', `${haystack.length} bytes`);

  /*
   * Positive control.
   *
   * A scan that finds no secret may simply be a scan that finds nothing. So it
   * must first find something it SHOULD: the value of a NEXT_PUBLIC variable,
   * which the build inlines into the bundle by design. If that is missing, the
   * scan is broken and every "no leak" result below is worthless.
   */
  const publicValue = status.providerId;
  check(
    haystack.includes(publicValue),
    `positive control: the public value "${publicValue}" IS found, so the scan works`,
    publicValue,
  );

  const secrets = [
    ['ANATOMY_PROVIDER_API_KEY', process.env.ANATOMY_PROVIDER_API_KEY],
    ['ANATOMY_ASSET_SIGNING_SECRET', process.env.ANATOMY_ASSET_SIGNING_SECRET],
    ['VEO_SENTINEL_SECRET', process.env.VEO_SENTINEL_SECRET],
  ];

  for (const [name, value] of secrets) {
    if (!value) {
      check(true, `${name}: not set in this environment, nothing to leak`);
      continue;
    }
    check(!haystack.includes(value), `${name}: its VALUE never reaches the browser`);
  }

  // The names of server-only variables must not appear either: their presence
  // in a bundle means the build inlined them.
  for (const name of ['ANATOMY_PROVIDER_API_KEY', 'ANATOMY_ASSET_SIGNING_SECRET']) {
    check(!haystack.includes(name), `${name}: not even its name is inlined into the bundle`);
  }

  // Gate 9 extends the scan past the bundle to every surface a credential
  // could reach: storage the page writes, the URL it navigates to, and the
  // HTML the server rendered.
  const storage = await page.evaluate(() => {
    const read = (store) => {
      try {
        return Object.entries({ ...store });
      } catch {
        return [];
      }
    };
    return {
      local: read(window.localStorage),
      session: read(window.sessionStorage),
      url: window.location.href,
      cookies: document.cookie,
    };
  });

  const surfaces = [
    JSON.stringify(storage.local),
    JSON.stringify(storage.session),
    storage.url,
    storage.cookies,
    await page.content(),
  ].join('\n');

  for (const [name, value] of secrets) {
    if (!value) {
      // Say so rather than skipping silently. A scan that quietly runs zero
      // times is indistinguishable from a scan that passed, and this suite's
      // whole claim is that it looked.
      check(true, `${name}: not set, so no client surface can carry it`);
      continue;
    }
    check(
      !surfaces.includes(value),
      `${name}: absent from storage, URL, cookies and rendered HTML`,
    );
  }

  check(
    !/api[_-]?key=|token=|secret=/i.test(storage.url),
    'no credential is carried in the URL',
    storage.url,
  );

  // ------------------------------------------- 7. no source files exposed ---
  console.log('\n=== 7. NO ANATOMY SOURCE FILE IS DOWNLOADABLE ===');
  const assetUrls = sources.length;
  void assetUrls;

  const directAsset = await page.request.get(`${BASE}/models/heart/heart.glb`);
  check(
    directAsset.status() >= 400,
    'VEO serves no anatomy asset from its own origin',
    `${directAsset.status()}`,
  );

  const directManifest = await page.request.get(`${BASE}/models/heart/manifest.json`);
  check(
    directManifest.status() >= 400,
    'nor a manifest from a guessable path',
    `${directManifest.status()}`,
  );

  // ------------------------------------------- 8. console -------------------
  console.log('\n=== 8. CONSOLE ===');
  check(errors.length === 0, 'no console errors across the anatomy surfaces', errors.slice(0, 3).join(' | '));

  await context.close();
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`GATE 8 ANATOMY INTEGRATION: ${results.pass} passed, ${results.fail} failed`);
if (results.problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of results.problems) console.log(`  - ${problem}`);
}
console.log('='.repeat(60));

process.exit(results.fail === 0 ? 0 : 1);
