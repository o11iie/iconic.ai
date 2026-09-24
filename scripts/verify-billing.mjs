/**
 * Gate 14 verification: plans, allowances and enforcement, in a real browser.
 *
 * Governing rule, unchanged since Gate 10:
 *
 *   A refusal appearing is NOT a pass.
 *
 * A page that rendered "upgrade" unconditionally would look identical to one
 * that enforces. So every check asserts the REFUSAL CORRESPONDS to a real
 * decision — the right reason, the right status, the right remaining count —
 * and that a learner who has allowance left is not refused.
 *
 * ## What is real and what is substituted
 *
 * Real: the Next server, middleware, /plans, /settings, the workspace, the
 * entitlement UI, the layout at six widths.
 *
 * Substituted: Supabase. Auth is answered by `fixture-auth-server.mjs` so a
 * browser can be signed in, and `/api/billing/*` is answered by route
 * interception carrying responses shaped exactly as the real routes build
 * them. The enforcement itself — that the eleventh call is refused, and that
 * ten simultaneous callers cannot overspend an allowance of four — is proved
 * against real PostgreSQL by `verify-rls.sh`, which is where it lives.
 *
 * Usage: node scripts/verify-billing.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { authCookie } from './fixture-auth-server.mjs';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3411';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54330';

const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
  /fixture-auth-server implements auth only/i,
];

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
  return errors;
}

async function signedInContext(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const cookie = authCookie(SUPABASE_URL);
  await context.addCookies([
    { name: cookie.name, value: cookie.value, url: BASE, httpOnly: false, sameSite: 'Lax' },
  ]);
  return context;
}

const text = (page) => page.locator('main').innerText();

/**
 * Open the workspace and put a structure in context.
 *
 * Waits on the conditions themselves — the engine handle existing, the
 * selection landing, the control becoming enabled — rather than on a fixed
 * delay. A sleep here would be the thing that turns a real regression into an
 * intermittent one: it passes on a fast run and fails on a slow one, and
 * nobody can tell which they are looking at.
 *
 * Returns null on success, or a string saying which step did not happen.
 */
async function selectStructure(page, semanticId) {
  try {
    await page.waitForFunction(() => Boolean(window.__VEO_ENGINE__?.select), null, {
      timeout: 30_000,
    });
  } catch {
    return 'the engine never mounted';
  }

  try {
    await page.waitForFunction(
      (id) => {
        window.__VEO_ENGINE__?.select?.(id);
        return window.__VEO_ENGINE__?.state?.()?.selectedId === id;
      },
      semanticId,
      { timeout: 20_000, polling: 250 },
    );
  } catch {
    return 'the structure never became selected';
  }

  try {
    await page
      .locator('[data-veo-study-mode="quiz"]:not([disabled])')
      .waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    return 'Quiz me never became enabled with a structure in context';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fixtures, shaped exactly as `/api/billing/status` builds them.
// ---------------------------------------------------------------------------

const FREE_TIER_KEYS = ['material.upload', 'ai.generate_flashcards'];
const PLUS_KEYS = [
  'material.upload', 'material.unlimited_uploads', 'ai.tutor',
  'ai.generate_flashcards', 'ai.generate_questions', 'spatial.unlimited_sessions',
];
const PRO_KEYS = [...PLUS_KEYS, 'spatial.premium_models', 'recall.advanced_scheduling', 'export.notes'];
const ALL_KEYS = [
  'spatial.premium_models', 'spatial.unlimited_sessions', 'ai.tutor',
  'ai.generate_questions', 'ai.generate_flashcards', 'material.upload',
  'material.unlimited_uploads', 'recall.advanced_scheduling', 'export.notes',
];

/** The allowance a free learner has, matching FREE_DAILY_LIMITS. */
const FLASHCARD_LIMIT = 10;
const UPLOAD_LIMIT = 5;

function capability(key, { granted, limit = null, used = 0 }) {
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return {
    key,
    granted,
    limit,
    used,
    remaining,
    exhausted: limit !== null && remaining === 0,
    denial: !granted ? 'plan_required' : limit !== null && remaining === 0 ? 'quota_exhausted' : null,
  };
}

function statusFor(tier, { flashcardsUsed = 0, checkoutAvailable = false } = {}) {
  const granted = tier === 'free' ? FREE_TIER_KEYS
    : tier === 'plus' ? PLUS_KEYS
    : tier === 'pro' ? PRO_KEYS : ALL_KEYS;

  return {
    ok: true,
    tier,
    checkoutAvailable,
    timeZone: 'UTC',
    tiers: { free: FREE_TIER_KEYS, plus: PLUS_KEYS, pro: PRO_KEYS, institution: ALL_KEYS },
    capabilities: ALL_KEYS.map((key) => {
      const isGranted = granted.includes(key);
      if (!isGranted) return capability(key, { granted: false });
      if (tier !== 'free') return capability(key, { granted: true });
      if (key === 'ai.generate_flashcards') {
        return capability(key, { granted: true, limit: FLASHCARD_LIMIT, used: flashcardsUsed });
      }
      if (key === 'material.upload') {
        return capability(key, { granted: true, limit: UPLOAD_LIMIT, used: 0 });
      }
      return capability(key, { granted: true });
    }),
  };
}

function installBilling(page, status) {
  return page.route('**/api/billing/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status')) {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(status),
      });
    }
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
  });
}

// ---------------------------------------------------------------------------

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  try {
    // =====================================================================
    console.log('\n=== 1. A FREE LEARNER SEES THEIR REAL ALLOWANCE ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      await installBilling(page, statusFor('free', { flashcardsUsed: 3 }));

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');
      const body = await text(page);

      check(!/\/login/.test(page.url()), 'a signed-in learner reaches /plans', page.url());
      check(/You are on Free/i.test(body), 'it names their real tier');

      // The numbers must be theirs, not illustrative.
      check(
        new RegExp(`${FLASHCARD_LIMIT - 3} of ${FLASHCARD_LIMIT}`).test(body),
        `flashcards show ${FLASHCARD_LIMIT - 3} of ${FLASHCARD_LIMIT} remaining`,
        body.match(/\d+ of \d+/g)?.join(', ') ?? '',
      );
      check(
        new RegExp(`${UPLOAD_LIMIT} of ${UPLOAD_LIMIT}`).test(body),
        `uploads show the full ${UPLOAD_LIMIT} remaining`,
      );

      const meters = await page.locator('[data-veo-allowance]').count();
      check(meters === 2, `both metered capabilities are shown (${meters})`);

      // Nothing on a paid plan may be presented as theirs.
      check(
        !/You are on (Plus|Pro|Institution)/i.test(body),
        'no paid tier is presented as theirs',
      );

      check(errors.length === 0, 'no console errors on /plans', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 2. A SPENT ALLOWANCE IS SHOWN AS SPENT ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      await installBilling(page, statusFor('free', { flashcardsUsed: FLASHCARD_LIMIT }));

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');
      const body = await text(page);

      check(
        new RegExp(`0 of ${FLASHCARD_LIMIT}`).test(body),
        'the exhausted allowance reads 0 remaining',
      );
      check(
        /Spent for today/i.test(body),
        'and says it is spent for today rather than showing a bare zero',
      );
      check(
        /resets tomorrow/i.test(body),
        'and says when it comes back',
      );

      check(errors.length === 0, 'no console errors', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 3. THE PLAN COMPARISON IS THE SERVER\'S, NOT THE PAGE\'S ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      await installBilling(page, statusFor('free'));

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');
      const body = await text(page);

      for (const tier of ['Free', 'Plus', 'Pro', 'Institution']) {
        check(new RegExp(`\\b${tier}\\b`).test(body), `${tier} is listed`);
      }

      // The capabilities shown must be the ones the server sent, which are the
      // ones its own resolver grants.
      check(/AI tutor/i.test(body), 'the tutor appears as a capability');
      check(
        /Generated flashcards/i.test(body),
        'and flashcards, which free holds',
      );

      // No price is invented. VEO has never taken a payment.
      check(
        !/[£$€]\s?\d/.test(body),
        'no price is shown, because none has ever been charged',
        body.match(/[£$€]\s?\d+/)?.[0] ?? '',
      );

      check(errors.length === 0, 'no console errors', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 4. UNCONFIGURED CHECKOUT IS HONEST, NOT A DEAD BUTTON ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      await installBilling(page, statusFor('free', { checkoutAvailable: false }));

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');
      const body = await text(page);

      check(
        /Payments are not set up/i.test(body),
        'the page says payments are not set up in this deployment',
      );
      check(
        /allowances above are real and are enforced/i.test(body),
        'and is explicit that the allowances shown ARE enforced',
      );

      // Every upgrade control must be disabled rather than present and broken.
      const upgrades = page.locator('[data-veo-upgrade]');
      const count = await upgrades.count();
      check(count >= 3, `${count} upgrade controls are present`);

      const disabled = await upgrades.evaluateAll((nodes) =>
        nodes.every((node) => node.hasAttribute('disabled')),
      );
      check(disabled, 'every one is disabled, so no button fails when pressed');

      check(errors.length === 0, 'no console errors', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 5. CHECKOUT BECOMES AVAILABLE WHEN CONFIGURED ===');
    // =====================================================================
    {
      // The positive control for section 4: if the disabled state were
      // hard-coded, this would look identical.
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      await installBilling(page, statusFor('free', { checkoutAvailable: true }));

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');

      const enabled = await page
        .locator('[data-veo-upgrade]')
        .evaluateAll((nodes) => nodes.some((node) => !node.hasAttribute('disabled')));

      check(enabled, 'upgrade controls become enabled when checkout is available');
      check(
        !/Payments are not set up/i.test(await text(page)),
        'and the unavailable notice disappears',
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 6. A PAID LEARNER IS NOT METERED ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      await installBilling(page, statusFor('pro'));

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');
      const body = await text(page);

      check(/You are on Pro/i.test(body), 'their real tier is Pro');
      check(
        /Nothing on your plan is capped daily/i.test(body),
        'and nothing is capped daily',
      );
      check(
        (await page.locator('[data-veo-allowance]').count()) === 0,
        'no allowance meters are shown at all',
      );
      check(
        !/of \d+ left today/i.test(body),
        'and no remaining-count language appears',
      );

      check(errors.length === 0, 'no console errors', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 7. SETTINGS AGREES WITH PLANS ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      await installBilling(page, statusFor('free', { flashcardsUsed: 4 }));

      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plan-settings]', { timeout: 20_000 });
      const body = await text(page);

      check(/Your plan/i.test(body), 'settings shows a plan panel');
      check(/\bFree\b/.test(body), 'naming the same tier');
      check(
        new RegExp(`${FLASHCARD_LIMIT - 4} of ${FLASHCARD_LIMIT} left today`).test(body),
        'and the same remaining allowance as /plans',
        body.match(/\d+ of \d+ left today/g)?.join(', ') ?? '',
      );

      // A capability they do not have must say so, not be silently omitted.
      check(
        /part of a paid plan|Included on a paid plan/i.test(body),
        'a capability they lack is named with its remedy',
      );

      await page.getByRole('link', { name: /Compare plans/i }).click();
      await page.waitForURL(/\/plans/, { timeout: 20_000 });
      check(/\/plans/.test(page.url()), 'and links through to the plans page');

      check(errors.length === 0, 'no console errors on settings', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 8. SIX VIEWPORTS ===');
    // =====================================================================
    {
      const VIEWPORTS = [
        { width: 1440, height: 900, name: 'desktop' },
        { width: 1024, height: 768, name: 'small laptop' },
        { width: 768, height: 1024, name: 'tablet' },
        { width: 430, height: 932, name: 'large phone' },
        { width: 390, height: 844, name: 'phone' },
        { width: 360, height: 800, name: 'small phone' },
      ];

      for (const viewport of VIEWPORTS) {
        const context = await signedInContext(browser, {
          width: viewport.width, height: viewport.height,
        });
        const page = await context.newPage();
        const errors = captureConsole(page);
        await installBilling(page, statusFor('free', { flashcardsUsed: 3 }));

        await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-veo-plans]');

        // Measured by DISPLACEMENT, not scrollWidth: an element inside a
        // horizontal scroller inflates scrollWidth without the PAGE being
        // scrollable.
        const shift = await page.evaluate(async () => {
          window.scrollTo(9999, 0);
          await new Promise((r) => requestAnimationFrame(r));
          const x = window.scrollX;
          window.scrollTo(0, 0);
          return x;
        });
        check(shift === 0, `${viewport.name} ${viewport.width}px — no horizontal overflow`, `${shift}px`);

        // The allowance must stay readable, not collapse.
        const meters = await page.locator('[data-veo-allowance]').evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) };
          }),
        );
        check(meters.length === 2, `${viewport.name} — both allowances render`);
        check(
          meters.every((m) => m.h >= 40 && m.x >= 0 && m.x + m.w <= viewport.width + 1),
          `${viewport.name} — no allowance is clipped`,
          JSON.stringify(meters),
        );

        // And the tier cards must not be cut off.
        const cards = await page.locator('[data-veo-upgrade]').evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { w: Math.round(r.width), x: Math.round(r.left) };
          }),
        );
        check(
          cards.every((c) => c.x >= 0 && c.x + c.w <= viewport.width + 1),
          `${viewport.name} — no upgrade control is clipped`,
          JSON.stringify(cards),
        );

        check(errors.length === 0, `${viewport.name} — no console errors`, errors.join(' | '));
        await context.close();
      }
    }

    // =====================================================================
    console.log('\n=== 9. UNAUTHENTICATED AND UNCONFIGURED STATES ===');
    // =====================================================================
    {
      // No auth cookie at all: middleware must send them to sign in.
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      const response = await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      check(
        /\/login/.test(page.url()),
        'a signed-out visitor is redirected away from /plans',
        page.url(),
      );
      check((response?.status() ?? 0) < 500, 'and is not shown an error page');

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 10. NOTHING SECRET REACHES THE BROWSER ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      await installBilling(page, statusFor('free'));

      const scripts = [];
      page.on('response', async (response) => {
        const type = response.headers()['content-type'] ?? '';
        if (!/javascript/.test(type)) return;
        try {
          scripts.push(await response.text());
        } catch {
          /* unreadable is not evidence either way */
        }
      });

      await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-plans]');

      const bundle = scripts.join('\n');
      check(bundle.length > 10_000, 'the scan actually read the shipped bundles', `${bundle.length} bytes`);
      check(!/sk_live_|sk_test_/.test(bundle), 'no Stripe secret key in client code');
      check(!/whsec_/.test(bundle), 'no Stripe webhook secret in client code');
      check(!/STRIPE_SECRET_KEY/.test(bundle), 'no Stripe secret variable name in client code');
      check(!/SUPABASE_SERVICE_ROLE/.test(bundle), 'no service-role key name in client code');

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 11. THE REAL ROUTES REFUSE A REAL UNAUTHENTICATED CALLER ===');
    // =====================================================================
    {
      /*
       * No interception whatsoever. These requests reach the routes VEO ships,
       * through the middleware VEO ships, and the status codes below are the
       * ones the gate produced.
       *
       * This is the check that cannot be faked by the fixtures above: every
       * other section substitutes the billing response, so none of them proves
       * the gate exists. This one does.
       */
      const anon = await browser.newContext();

      /*
       * Guard, not a skip. If the AI is not configured on this server, the
       * routes below would refuse for that reason instead of the plan, and
       * section 12's workflow would be unreachable. Asserted so the run FAILS
       * rather than quietly proving something weaker.
       */
      const availability = await anon.request.get(`${BASE}/api/ai/tutor`, {
        failOnStatusCode: false,
      });
      const availabilityBody = await availability.json().catch(() => ({}));
      check(
        availabilityBody.configured === true,
        'the AI is configured on this server, so a 401 below is the gate and not a missing key',
        JSON.stringify(availabilityBody),
      );

      const cases = [
        { method: 'get', path: '/api/billing/status' },
        { method: 'post', path: '/api/billing/checkout', data: { tier: 'pro' } },
        { method: 'post', path: '/api/ai/tutor', data: { modelRef: 'x' } },
        { method: 'post', path: '/api/ai/questions', data: { modelRef: 'x', semanticId: 'veo.a.b.c' } },
        { method: 'post', path: '/api/ai/flashcards', data: { modelRef: 'x', semanticId: 'veo.a.b.c' } },
      ];

      for (const item of cases) {
        const response = await anon.request[item.method](`${BASE}${item.path}`, {
          ...(item.data ? { data: item.data } : {}),
          failOnStatusCode: false,
        });
        const status = response.status();
        check(status === 401, `${item.path} refuses an unauthenticated caller with 401`, `got ${status}`);

        const body = await response.text();
        check(
          /unauthenticated/.test(body),
          `${item.path} names the reason rather than failing vaguely`,
          body.slice(0, 120),
        );
      }

      // A malformed body must still be refused for the RIGHT reason: the gate
      // runs before parsing, so an unentitled caller is never told their
      // request was malformed instead.
      const malformed = await anon.request.post(`${BASE}/api/ai/tutor`, {
        headers: { 'content-type': 'application/json' },
        data: 'not json at all',
        failOnStatusCode: false,
      });
      check(
        malformed.status() === 401,
        'an unauthenticated caller sending garbage is refused for the plan, not the syntax',
        `got ${malformed.status()}`,
      );

      await anon.close();

      // Positive control: the same route, signed in, is NOT 401. Without this,
      // a route that returned 401 unconditionally would pass every check above.
      const signedIn = await signedInContext(browser, { width: 1440, height: 900 });
      const authed = await signedIn.request.get(`${BASE}/api/billing/status`, {
        failOnStatusCode: false,
      });
      check(
        authed.status() !== 401,
        'positive control: the same route, signed in, is not refused as unauthenticated',
        `got ${authed.status()}`,
      );
      await signedIn.close();
    }

    // =====================================================================
    console.log('\n=== 12. A REFUSAL IN CONTEXT EXPLAINS ITSELF ===');
    // =====================================================================
    {
      /*
       * The workflow a learner actually meets: they ask for study material and
       * the allowance is gone.
       *
       * The envelope below is the one `generation-route.ts` builds, carrying
       * the status `DENIAL_STATUS` assigns. What is asserted is not that a
       * message appeared but that the panel OFFERED THE RIGHT REMEDY — and,
       * in the control case, that it did not offer it when the failure was a
       * fault rather than a plan.
       */
      const DIAGNOSTIC_OBJ = 'veo.diagnostic.test_scene.system_a.object_1';

      const refusals = [
        {
          name: 'a spent allowance',
          status: 429,
          code: 'quota_exhausted',
          message: "That is today's free allowance for generated flashcards. It resets tomorrow.",
          title: /That is today's free allowance/i,
          href: /\/plans/,
          label: /See plans/i,
        },
        {
          name: 'a capability not on the plan',
          status: 403,
          code: 'plan_required',
          message: 'Generated questions are part of a paid plan.',
          title: /Included on a paid plan/i,
          href: /\/plans/,
          label: /See plans/i,
        },
      ];

      for (const refusal of refusals) {
        const context = await signedInContext(browser, { width: 1440, height: 900 });
        const page = await context.newPage();

        await page.route('**/api/ai/questions', (route) =>
          route.fulfill({
            status: refusal.status,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              error: { code: refusal.code, message: refusal.message },
            }),
          }),
        );

        await page.goto(`${BASE}/explore?diagnostic=1`, { waitUntil: 'networkidle' });

        const blocked = await selectStructure(page, DIAGNOSTIC_OBJ);
        check(blocked === null, `${refusal.name}: the control is reachable`, blocked ?? '');
        if (blocked !== null) {
          await context.close();
          continue;
        }
        await page.locator('[data-veo-study-mode="quiz"]').click();

        const remedy = page.locator(`[data-veo-plan-refusal="${refusal.code}"]`);
        await remedy.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

        check(
          (await remedy.count()) === 1,
          `${refusal.name}: the panel offers the remedy for this exact reason`,
        );

        const panel = await page.locator('[data-veo-learning]').first().innerText();
        check(refusal.title.test(panel), `${refusal.name}: and names it plainly`, panel.slice(0, 160));
        check(
          panel.includes(refusal.message),
          `${refusal.name}: and carries the server's own explanation`,
        );

        // A retry cannot fix a plan. Offering one would send a learner in a
        // loop spending nothing and getting nowhere.
        check(
          !/Try again/i.test(panel),
          `${refusal.name}: and does not offer a retry, which cannot help`,
        );

        const href = await remedy.getAttribute('href');
        check(refusal.href.test(href ?? ''), `${refusal.name}: the remedy links to ${refusal.href}`, `${href}`);
        check(refusal.label.test(await remedy.innerText()), `${refusal.name}: with an actionable label`);

        // Following it must actually arrive.
        await remedy.click();
        await page.waitForURL(refusal.href, { timeout: 20_000 }).catch(() => {});
        check(refusal.href.test(page.url()), `${refusal.name}: and following it arrives`, page.url());

        await context.close();
      }

      // --- the control -----------------------------------------------------
      //
      // A provider fault is NOT a plan problem. If the panel showed "See plans"
      // here, every check above would be meaningless.
      {
        const context = await signedInContext(browser, { width: 1440, height: 900 });
        const page = await context.newPage();

        await page.route('**/api/ai/questions', (route) =>
          route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              error: { code: 'provider_failed', message: 'The model did not answer.' },
            }),
          }),
        );

        await page.goto(`${BASE}/explore?diagnostic=1`, { waitUntil: 'networkidle' });
        const blocked = await selectStructure(page, DIAGNOSTIC_OBJ);
        check(blocked === null, 'control: the control is reachable', blocked ?? '');
        await page.locator('[data-veo-study-mode="quiz"]').click();

        await page
          .locator('[data-veo-learning][data-veo-learning-status="error"]')
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 })
          .catch(() => {});

        const panel = await page.locator('[data-veo-learning]').first().innerText();

        check(
          (await page.locator('[data-veo-plan-refusal]').count()) === 0,
          'control: a provider fault offers no upgrade, because upgrading would not fix it',
        );
        check(/Try again/i.test(panel), 'control: it offers a retry instead', panel.slice(0, 160));
        check(
          !/paid plan|allowance/i.test(panel),
          'control: and says nothing about plans or allowances',
        );

        await context.close();
      }

      // Signed out, the same refusal must send them to sign in, not to pay.
      {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();

        await page.route('**/api/ai/questions', (route) =>
          route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              error: { code: 'unauthenticated', message: 'Sign in to generate study material.' },
            }),
          }),
        );

        await page.goto(`${BASE}/explore?diagnostic=1`, { waitUntil: 'networkidle' });
        const blocked = await selectStructure(page, DIAGNOSTIC_OBJ);
        check(blocked === null, 'signed out: the control is reachable', blocked ?? '');
        await page.locator('[data-veo-study-mode="quiz"]').click();

        const remedy = page.locator('[data-veo-plan-refusal="unauthenticated"]');
        await remedy.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

        check((await remedy.count()) === 1, 'signed out: the refusal offers sign-in');
        check(
          /\/login/.test((await remedy.getAttribute('href')) ?? ''),
          'signed out: and links to sign in rather than to plans',
          `${await remedy.getAttribute('href')}`,
        );
        check(
          /Sign in/i.test(await remedy.innerText()),
          'signed out: with the right label',
        );

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`VEO BILLING VERIFICATION: ${results.pass} passed, ${results.fail} failed`);
  console.log('='.repeat(60));
  if (results.problems.length > 0) {
    console.log('\nProblems:');
    for (const problem of results.problems) console.log(`  - ${problem}`);
  }
  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
