/**
 * Gate 15 verification: accounts, sessions and the production boundary.
 *
 * Governing rule, unchanged since Gate 10:
 *
 *   A refusal appearing is NOT a pass.
 *
 * Every check below asserts the refusal CORRESPONDS to a real decision — the
 * right status, the right reason, the right thing unchanged afterwards — and
 * that the same request from somebody entitled to make it is NOT refused.
 *
 * ## What is real and what is substituted
 *
 * Real: the Next server, the proxy/middleware, every page, the account API's
 * authentication and authorization, the rate limiter, the error shapes, and
 * the layout at six widths.
 *
 * Substituted: Supabase. `fixture-auth-server.mjs` answers `auth.getUser()`
 * so a browser can be signed in; it is deliberately NOT a database. So the
 * account API's AUTH behaviour is driven with no interception at all — that
 * is the security-critical half — while the settings UI's rendering is driven
 * against intercepted `/api/account` responses shaped exactly as the route
 * builds them.
 *
 * The database half is verified against real PostgreSQL 16 by
 * `verify-rls.sh`, which proves the cross-user matrix and the deletion
 * cascade by execution.
 *
 * Usage: node scripts/verify-account.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { authCookie, FIXTURE_USER } from './fixture-auth-server.mjs';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3411';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54330';

const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
  /fixture-auth-server implements auth only/i,
  /Failed to load resource: the server responded with a status of 50[0-9]/i,
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

async function signedIn(browser, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const cookie = authCookie(SUPABASE_URL);
  await context.addCookies([
    { name: cookie.name, value: cookie.value, url: BASE, httpOnly: false, sameSite: 'Lax' },
  ]);
  return context;
}

/** A profile response shaped exactly as `/api/account` builds one. */
function profileBody(overrides = {}) {
  return {
    ok: true,
    profile: {
      displayName: 'Verification Learner',
      level: 'intermediate',
      timeZone: 'UTC',
      locale: 'en',
      interests: ['anatomy'],
      onboardedAt: '2026-01-01T00:00:00.000Z',
      email: FIXTURE_USER.email,
      emailVerified: true,
      ...overrides,
    },
  };
}

/** Strings that must never appear in anything a client receives. */
const FORBIDDEN_IN_RESPONSES = [
  { name: 'a Stripe secret', pattern: /sk_(live|test)_/ },
  { name: 'a webhook secret', pattern: /whsec_/ },
  { name: 'a service-role key name', pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: 'a stack trace', pattern: /\bat\s+\w+.*\(.*:\d+:\d+\)/ },
  { name: 'a file path from the server', pattern: /\/home\/|\/var\/|node_modules/ },
  { name: 'a PostgreSQL error code', pattern: /\b(23505|42501|PGRST\d+)\b/ },
  { name: 'a raw SQL fragment', pattern: /\b(select|insert into|update .* set)\b.*\bfrom\b/i },
];

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  try {
    // =====================================================================
    console.log('\n=== 1. THE ACCOUNT API REFUSES AN ANONYMOUS CALLER ===');
    // =====================================================================
    // No interception whatsoever. The real route, through the real proxy.
    {
      const anon = await browser.newContext();

      const cases = [
        { method: 'get', label: 'GET /api/account' },
        { method: 'patch', label: 'PATCH /api/account', data: { displayName: 'Intruder' } },
        { method: 'delete', label: 'DELETE /api/account', data: { confirm: 'DELETE MY ACCOUNT' } },
      ];

      for (const item of cases) {
        const response = await anon.request[item.method](`${BASE}/api/account`, {
          ...(item.data ? { data: item.data } : {}),
          failOnStatusCode: false,
        });

        check(response.status() === 401, `${item.label} refuses with 401`, `got ${response.status()}`);

        const body = await response.text();
        check(
          /unauthenticated/.test(body),
          `${item.label} names the reason rather than failing vaguely`,
          body.slice(0, 120),
        );
      }

      // A deletion attempt WITH the right phrase but no session must still be
      // refused for the session, not accepted. Asserted explicitly because
      // this is the one request that destroys data.
      const armed = await anon.request.delete(`${BASE}/api/account`, {
        data: { confirm: 'DELETE MY ACCOUNT' },
        failOnStatusCode: false,
      });
      check(
        armed.status() === 401,
        'a correctly-phrased deletion with no session is still refused',
        `got ${armed.status()}`,
      );

      await anon.close();

      // Positive control: signed in, the same route is NOT 401. Without this,
      // a route that answered 401 unconditionally would pass every check.
      const context = await signedIn(browser);
      const authed = await context.request.get(`${BASE}/api/account`, {
        failOnStatusCode: false,
      });
      check(
        authed.status() !== 401,
        'positive control: signed in, the same route is not refused as unauthenticated',
        `got ${authed.status()}`,
      );
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 2. IDENTITY CANNOT BE SUPPLIED BY THE CLIENT ===');
    // =====================================================================
    {
      const context = await signedIn(browser);

      /*
       * The account API takes no user id. These requests try to give it one
       * anyway, in every shape a careless implementation might read: the body,
       * the query string, and a header.
       *
       * The route must ignore all of them. With no database behind the
       * fixture the write cannot complete, so what is asserted is that the
       * request is NOT treated as being about another account — never a 200
       * that acted on a supplied id, and never a 403 implying the id was
       * consulted.
       */
      const attempts = [
        { label: 'in the body', data: { displayName: 'x', userId: '00000000-0000-4000-8000-000000000bad' } },
        { label: 'as user_id in the body', data: { displayName: 'x', user_id: '00000000-0000-4000-8000-000000000bad' } },
        { label: 'in the query string', query: '?userId=00000000-0000-4000-8000-000000000bad', data: { displayName: 'x' } },
      ];

      for (const attempt of attempts) {
        const response = await context.request.patch(
          `${BASE}/api/account${attempt.query ?? ''}`,
          { data: attempt.data, failOnStatusCode: false },
        );
        const body = await response.text();

        check(
          !body.includes('000000000bad'),
          `a user id supplied ${attempt.label} is never echoed back`,
          body.slice(0, 120),
        );
        check(
          response.status() !== 403,
          `a user id supplied ${attempt.label} is not consulted for authorization`,
          `got ${response.status()}`,
        );
      }

      // And a header, which is the shape a proxy misconfiguration produces.
      const headerAttempt = await context.request.patch(`${BASE}/api/account`, {
        headers: { 'x-user-id': '00000000-0000-4000-8000-000000000bad' },
        data: { displayName: 'x' },
        failOnStatusCode: false,
      });
      check(
        !(await headerAttempt.text()).includes('000000000bad'),
        'a user id supplied in a header is never echoed back',
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 3. DELETION REQUIRES THE TYPED PHRASE ===');
    // =====================================================================
    {
      const context = await signedIn(browser);

      for (const confirm of ['', 'yes', 'delete my account', 'DELETE MY ACCOUNT!', null]) {
        const response = await context.request.delete(`${BASE}/api/account`, {
          ...(confirm === null ? {} : { data: { confirm } }),
          failOnStatusCode: false,
        });

        check(
          response.status() === 400,
          `deletion with confirmation ${JSON.stringify(confirm)} is refused as unconfirmed`,
          `got ${response.status()}`,
        );

        const body = await response.text();
        check(
          /not_confirmed/.test(body),
          `and says which requirement was not met`,
          body.slice(0, 120),
        );
      }

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 4. NOTHING INTERNAL LEAKS THROUGH AN ERROR ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const anon = await browser.newContext();

      /*
       * Hostile and malformed input at every account and billing endpoint.
       * Each response is scanned for the things an error handler leaks when
       * it forwards a provider message: keys, stack traces, server paths,
       * PostgreSQL error codes, SQL.
       */
      const probes = [
        { ctx: context, method: 'patch', path: '/api/account', data: 'not json at all', raw: true },
        { ctx: context, method: 'patch', path: '/api/account', data: { displayName: '' } },
        { ctx: context, method: 'patch', path: '/api/account', data: { level: 'god_mode' } },
        { ctx: context, method: 'patch', path: '/api/account', data: { displayName: 'x'.repeat(5000) } },
        { ctx: context, method: 'patch', path: '/api/account', data: { interests: Array(500).fill('a') } },
        { ctx: context, method: 'delete', path: '/api/account', data: { confirm: { $ne: null } } },
        { ctx: context, method: 'get', path: '/api/billing/status' },
        { ctx: context, method: 'post', path: '/api/billing/checkout', data: { tier: '../../etc/passwd' } },
        { ctx: anon, method: 'post', path: '/api/billing/webhook', data: { type: 'x' } },
        { ctx: anon, method: 'post', path: '/api/ai/tutor', data: { modelRef: "'; drop table profiles; --" } },
      ];

      for (const probe of probes) {
        const response = await probe.ctx.request[probe.method](`${BASE}${probe.path}`, {
          ...(probe.data !== undefined
            ? probe.raw
              ? { data: probe.data, headers: { 'content-type': 'application/json' } }
              : { data: probe.data }
            : {}),
          failOnStatusCode: false,
        });

        const body = await response.text();
        const label = `${probe.method.toUpperCase()} ${probe.path}`;

        check(
          response.status() >= 200 && response.status() < 600,
          `${label} answers rather than hanging`,
          `${response.status()}`,
        );

        for (const forbidden of FORBIDDEN_IN_RESPONSES) {
          check(
            !forbidden.pattern.test(body),
            `${label} leaks no ${forbidden.name}`,
            body.slice(0, 160),
          );
        }

        // An error body must be structured, not a bare string or HTML.
        if (response.status() >= 400) {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            /* handled below */
          }
          check(
            parsed !== null && parsed.ok === false && typeof parsed.error?.code === 'string',
            `${label} returns a structured error with a code`,
            body.slice(0, 120),
          );
        }
      }

      await context.close();
      await anon.close();
    }

    // =====================================================================
    console.log('\n=== 5. THE SETTINGS SURFACE SHOWS SERVER STATE ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();
      const errors = captureConsole(page);

      await page.route('**/api/account', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(profileBody()),
            })
          : route.fallback(),
      );

      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-account]', { timeout: 20_000 });

      const body = await page.locator('main').innerText();

      check(body.includes(FIXTURE_USER.email), 'the account shows the signed-in email');
      check(/Verified/i.test(body), 'and reports the verification state Supabase recorded');

      const name = await page.locator('[data-veo-display-name]').inputValue();
      check(name === 'Verification Learner', 'the display name comes from the server', name);

      const level = await page.locator('[data-veo-level]').inputValue();
      check(level === 'intermediate', 'and so does the learning level', level);

      // Save is disabled until something actually changed: a button that
      // cannot do anything is a dead button.
      check(
        await page.locator('[data-veo-save-profile]').isDisabled(),
        'save is disabled while nothing has changed',
      );

      await page.locator('[data-veo-display-name]').fill('Changed Name');
      check(
        await page.locator('[data-veo-save-profile]').isEnabled(),
        'and becomes available once something has',
      );

      check(errors.length === 0, 'no console errors on settings', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 6. AN UNVERIFIED EMAIL IS SAID, NOT ASSUMED ===');
    // =====================================================================
    {
      // The positive control for section 5: if the badge were hard-coded,
      // both would look identical.
      const context = await signedIn(browser);
      const page = await context.newPage();

      await page.route('**/api/account', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(profileBody({ emailVerified: false })),
            })
          : route.fallback(),
      );

      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-account]', { timeout: 20_000 });

      const state = await page.locator('[data-veo-email-state]').innerText();
      check(state.trim() === 'Not verified', 'an unconfirmed address is reported as such', state);

      const body = await page.locator('main').innerText();
      check(
        /has not been confirmed/i.test(body),
        'and explained, rather than shown as a bare badge',
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 7. DELETION IS CONFIRMED IN THE INTERFACE TOO ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();

      await page.route('**/api/account', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(profileBody()),
            })
          : route.fallback(),
      );

      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-veo-account]', { timeout: 20_000 });

      await page.locator('[data-veo-delete-open]').click();
      await page.waitForSelector('[data-veo-delete-modal]', { timeout: 10_000 });

      const confirmButton = page.locator('[data-veo-delete-confirm-button]');
      check(await confirmButton.isDisabled(), 'the delete button starts disabled');

      await page.locator('[data-veo-delete-confirm] input, input[data-veo-delete-confirm]').first().fill('delete my account');
      check(
        await confirmButton.isDisabled(),
        'and stays disabled for the wrong phrase, including wrong case',
      );

      await page.locator('[data-veo-delete-confirm] input, input[data-veo-delete-confirm]').first().fill('DELETE MY ACCOUNT');
      check(
        await confirmButton.isEnabled(),
        'and becomes available only for the exact phrase',
      );

      // Pressing it must surface whatever the server says rather than
      // pretending to have succeeded.
      await page.route('**/api/account', (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({
                ok: false,
                error: {
                  code: 'active_subscription',
                  message:
                    'Cancel your subscription before deleting your account, so you are not charged for an account that no longer exists.',
                },
              }),
            })
          : route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(profileBody()),
            }),
      );

      await confirmButton.click();
      await page.waitForSelector('[data-veo-delete-error]', { timeout: 15_000 });

      const message = await page.locator('[data-veo-delete-error]').innerText();
      check(
        /Cancel your subscription/i.test(message),
        'a refusal from the server is shown to the learner',
        message,
      );
      check(
        new URL(page.url()).pathname === '/settings',
        'and they are not navigated away as though it had worked',
        page.url(),
      );

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
        const context = await signedIn(browser, viewport);
        const page = await context.newPage();
        const errors = captureConsole(page);

        await page.route('**/api/account', (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(profileBody()),
              })
            : route.fallback(),
        );

        await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-veo-account]', { timeout: 20_000 });

        // Measured by DISPLACEMENT: an element inside a horizontal scroller
        // inflates scrollWidth without the PAGE being scrollable.
        const shift = await page.evaluate(async () => {
          window.scrollTo(9999, 0);
          await new Promise((r) => requestAnimationFrame(r));
          const x = window.scrollX;
          window.scrollTo(0, 0);
          return x;
        });
        check(shift === 0, `${viewport.name} ${viewport.width}px — no horizontal overflow`, `${shift}px`);

        for (const [selector, label] of [
          ['[data-veo-display-name]', 'the name field'],
          ['[data-veo-save-profile]', 'the save button'],
          ['[data-veo-delete-open]', 'the delete control'],
        ]) {
          const box = await page.locator(selector).first().boundingBox();
          check(
            box !== null && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.height >= 20,
            `${viewport.name} — ${label} is reachable and not clipped`,
            JSON.stringify(box),
          );
        }

        // The confirmation dialog must be usable at this width too: a modal
        // whose button sits off-screen is a feature nobody can complete.
        await page.locator('[data-veo-delete-open]').click();
        await page.waitForSelector('[data-veo-delete-modal]', { timeout: 10_000 });

        const buttonBox = await page.locator('[data-veo-delete-confirm-button]').boundingBox();
        check(
          buttonBox !== null &&
            buttonBox.x >= 0 &&
            buttonBox.x + buttonBox.width <= viewport.width + 1 &&
            buttonBox.y + buttonBox.height <= viewport.height + 1,
          `${viewport.name} — the confirmation button is on screen`,
          JSON.stringify(buttonBox),
        );

        check(errors.length === 0, `${viewport.name} — no console errors`, errors.join(' | '));
        await context.close();
      }
    }

    // =====================================================================
    console.log('\n=== 9. ABUSE CONTROL IS LIVE, AND IS NOT THE QUOTA ===');
    // =====================================================================
    // Last, deliberately: this spends a real limiter bucket, so running it
    // earlier would change the answers above.
    {
      const anon = await browser.newContext();

      // `account.delete` permits 5 in 5 minutes. The sixth must be refused
      // for RATE, not for the session — and must say so with a different code
      // from the plan quota, because upgrading does not fix it.
      const statuses = [];
      let rateLimitedBody = '';

      for (let i = 0; i < 7; i += 1) {
        const response = await anon.request.delete(`${BASE}/api/account`, {
          data: { confirm: 'wrong' },
          failOnStatusCode: false,
        });
        statuses.push(response.status());
        if (response.status() === 429) rateLimitedBody = await response.text();
      }

      check(
        statuses.includes(429),
        'bursting the deletion endpoint is eventually rate limited',
        statuses.join(','),
      );
      check(
        statuses[0] !== 429,
        'and the first request was not, so the limit is a limit and not a block',
        `${statuses[0]}`,
      );
      check(
        /rate_limited/.test(rateLimitedBody),
        'the refusal is rate_limited, not quota_exhausted',
        rateLimitedBody.slice(0, 120),
      );
      check(
        !/quota_exhausted|upgrade|plan/i.test(rateLimitedBody),
        'and says nothing about plans, because buying one would not help',
        rateLimitedBody.slice(0, 120),
      );

      await anon.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`VEO ACCOUNT VERIFICATION: ${results.pass} passed, ${results.fail} failed`);
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
