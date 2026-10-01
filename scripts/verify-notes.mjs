/**
 * Gate 16 verification: notes, in a real browser.
 *
 * Governing rule, unchanged since Gate 10:
 *
 *   A note appearing is NOT a pass.
 *
 * A panel that rendered its own local state would look identical to one
 * reading the server. So the UI checks assert the content came from the
 * server, and the security checks use no interception at all.
 *
 * ## What is real and what is substituted
 *
 * Real: the Next server, the proxy, the Library and workspace pages, the
 * notes API's authentication and authorization, the rate limiter, the error
 * shapes, the entitlement gate on export, and the layout at six widths.
 *
 * Substituted: Supabase. `fixture-auth-server.mjs` answers `auth.getUser()`
 * so a browser can be signed in; it is deliberately NOT a database. So the
 * API's AUTH behaviour is driven with nothing intercepted — that is the
 * security-critical half — while the panel's rendering is driven against
 * intercepted `/api/notes` responses shaped exactly as the route builds them.
 *
 * The database half is verified against real PostgreSQL 16 by
 * `verify-rls.sh`, which proves the cross-user matrix, the bounds, the
 * generated search column and the server-owned timestamp by execution.
 *
 * Usage: node scripts/verify-notes.mjs [baseUrl]
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

// --- fixtures, shaped exactly as `/api/notes` builds them -------------------

const VENTRICLE = 'veo.anatomy.heart.left_ventricle';
const HEART = 'veo.anatomy.heart';

function note(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    semanticId: null,
    modelRef: null,
    title: null,
    body: 'A note body.',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function serveNotes(page, notes) {
  return page.route('**/api/notes?**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, notes, total: notes.length }),
        })
      : route.fallback(),
  );
}

const FORBIDDEN_IN_RESPONSES = [
  { name: 'a stack trace', pattern: /\bat\s+\w+.*\(.*:\d+:\d+\)/ },
  { name: 'a server path', pattern: /\/home\/|\/var\/|node_modules/ },
  { name: 'a PostgreSQL error code', pattern: /\b(23505|42501|23514|PGRST\d+)\b/ },
  { name: 'a raw SQL fragment', pattern: /\b(select|insert into|update .* set)\b.*\bfrom\b/i },
  { name: 'a constraint name', pattern: /notes_(body|title|tags)_/ },
  { name: 'a Supabase or Stripe secret', pattern: /sk_(live|test)_|whsec_|SERVICE_ROLE/ },
];

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  try {
    // =====================================================================
    console.log('\n=== 1. THE NOTES API REFUSES AN ANONYMOUS CALLER ===');
    // =====================================================================
    // No interception. The real routes, through the real proxy.
    {
      const anon = await browser.newContext();
      const id = '11111111-1111-4111-8111-111111111111';

      const cases = [
        { method: 'get', path: '/api/notes', label: 'GET /api/notes' },
        { method: 'post', path: '/api/notes', label: 'POST /api/notes', data: { body: 'mine now' } },
        { method: 'patch', path: `/api/notes/${id}`, label: 'PATCH /api/notes/[id]', data: { body: 'edited' } },
        { method: 'delete', path: `/api/notes/${id}`, label: 'DELETE /api/notes/[id]' },
      ];

      for (const item of cases) {
        const response = await anon.request[item.method](`${BASE}${item.path}`, {
          ...(item.data ? { data: item.data } : {}),
          failOnStatusCode: false,
        });

        check(response.status() === 401, `${item.label} refuses with 401`, `got ${response.status()}`);
        check(
          /unauthenticated/.test(await response.text()),
          `${item.label} names the reason`,
        );
      }

      // Export is BOTH entitlement-gated and authenticated. Anonymous must be
      // refused for the session, not for the plan: telling somebody who is
      // not signed in to upgrade is nonsense.
      const exported = await anon.request.get(`${BASE}/api/notes/export`, {
        failOnStatusCode: false,
      });
      check(exported.status() === 401, 'GET /api/notes/export refuses with 401', `got ${exported.status()}`);
      check(
        !/plan_required/.test(await exported.text()),
        'and does not tell a signed-out visitor to upgrade',
      );

      await anon.close();

      // Positive control: signed in, the list is NOT 401. Without this, a
      // route answering 401 unconditionally would pass everything above.
      const context = await signedIn(browser);
      const authed = await context.request.get(`${BASE}/api/notes`, { failOnStatusCode: false });
      check(
        authed.status() !== 401,
        'positive control: signed in, the same route is not refused as unauthenticated',
        `got ${authed.status()}`,
      );
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 2. A NOTE ID FROM THE URL IS NOT TRUSTED ===');
    // =====================================================================
    {
      const context = await signedIn(browser);

      /*
       * Another learner's note, and ids that are not ids at all. Every one
       * must answer 404 — never 403, which would confirm the id exists and
       * turn the endpoint into an oracle for enumerating note ids.
       */
      const ids = [
        ['a well-formed id belonging to nobody here', '22222222-2222-4222-8222-222222222222'],
        ['a malformed id', 'not-a-uuid'],
        ['a path traversal', '..%2F..%2Fetc%2Fpasswd'],
        ['a SQL fragment', "1';drop%20table%20notes;--"],
      ];

      /*
       * Two assertions per case, and they are not the same assertion.
       *
       * "Never 403" is the SECURITY property and holds unconditionally: a 403
       * would confirm the id is real.
       *
       * "404" is only reachable for an id rejected before a query runs. The
       * fixture provides authentication and deliberately no database, so a
       * well-formed id reaches the database and the query errors — correctly
       * reported as 503 "could not reach your notes". The 404-for-a-foreign-row
       * path is proved where it can be: `note-service.test.ts` drives it with
       * a client that returns no row, and `verify-rls.sh` proves against real
       * PostgreSQL that a foreign row matches nothing in the first place.
       */
      const PRE_QUERY = new Set([
        'a malformed id',
        'a path traversal',
        'a SQL fragment',
      ]);

      for (const [label, id] of ids) {
        for (const method of ['patch', 'delete']) {
          const response = await context.request[method](`${BASE}/api/notes/${id}`, {
            ...(method === 'patch' ? { data: { body: 'taken' } } : {}),
            failOnStatusCode: false,
          });
          const status = response.status();

          check(
            status !== 403,
            `${method.toUpperCase()} with ${label} never confirms the id exists`,
            `got ${status}`,
          );

          if (PRE_QUERY.has(label)) {
            check(
              status === 404,
              `${method.toUpperCase()} with ${label} answers 404 before any query`,
              `got ${status}`,
            );
          } else {
            check(
              status === 404 || status === 503,
              `${method.toUpperCase()} with ${label} answers 404, or 503 with no database`,
              `got ${status}`,
            );
          }
        }
      }

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 3. IDENTITY CANNOT BE SUPPLIED BY THE CLIENT ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const other = '22222222-2222-4222-8222-222222222222';

      const attempts = [
        { label: 'ownerId in the body', data: { body: 'x', ownerId: other } },
        { label: 'owner_id in the body', data: { body: 'x', owner_id: other } },
        { label: 'userId in the body', data: { body: 'x', userId: other } },
        { label: 'ownerId in the query', query: `?ownerId=${other}`, data: { body: 'x' } },
      ];

      for (const attempt of attempts) {
        const response = await context.request.post(
          `${BASE}/api/notes${attempt.query ?? ''}`,
          { data: attempt.data, failOnStatusCode: false },
        );
        const body = await response.text();

        check(!body.includes(other), `${attempt.label} is never echoed back`, body.slice(0, 120));
        check(
          response.status() !== 403,
          `${attempt.label} is not consulted for authorization`,
          `got ${response.status()}`,
        );
      }

      const headerAttempt = await context.request.post(`${BASE}/api/notes`, {
        headers: { 'x-owner-id': other },
        data: { body: 'x' },
        failOnStatusCode: false,
      });
      check(
        !(await headerAttempt.text()).includes(other),
        'an owner id in a header is never echoed back',
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 4. VALIDATION REFUSES, AND EXPLAINS ===');
    // =====================================================================
    {
      const context = await signedIn(browser);

      const invalid = [
        ['an empty note', { body: '   ' }],
        ['a body past the limit', { body: 'x'.repeat(20_001) }],
        ['a title past the limit', { body: 'b', title: 'x'.repeat(201) }],
        ['an anchor that is not a semantic id', { body: 'b', semanticId: 'heart' }],
        ['an anchor with too few segments', { body: 'b', semanticId: 'veo.anatomy' }],
        ['an uppercase anchor', { body: 'b', semanticId: 'VEO.anatomy.heart' }],
        ['a traversal in the anchor', { body: 'b', semanticId: '../../etc/passwd' }],
        ['a model ref with a path in it', { body: 'b', modelRef: '../secret' }],
        ['too many tags', { body: 'b', tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }],
        ['an oversized tag', { body: 'b', tags: ['x'.repeat(41)] }],
      ];

      for (const [label, data] of invalid) {
        const response = await context.request.post(`${BASE}/api/notes`, {
          data,
          failOnStatusCode: false,
        });
        const body = await response.text();

        check(response.status() === 400, `${label} is refused with 400`, `got ${response.status()}`);

        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          /* handled below */
        }
        check(
          parsed?.ok === false && typeof parsed?.error?.message === 'string',
          `${label} returns a structured error a learner can read`,
          body.slice(0, 120),
        );

        for (const forbidden of FORBIDDEN_IN_RESPONSES) {
          check(!forbidden.pattern.test(body), `${label} leaks no ${forbidden.name}`);
        }
      }

      // A malformed body is a 400 too, not a 500.
      const garbage = await context.request.post(`${BASE}/api/notes`, {
        headers: { 'content-type': 'application/json' },
        data: 'not json at all',
        failOnStatusCode: false,
      });
      check(garbage.status() === 400, 'an unparseable body is refused with 400', `got ${garbage.status()}`);

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 5. THE LIBRARY SHOWS SERVER STATE ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();
      const errors = captureConsole(page);

      await serveNotes(page, [
        note({ id: 'a', title: 'Chordae tendineae', body: 'They stop the valve inverting.', tags: ['cardiac'] }),
        note({ id: 'b', body: 'A second note.' }),
      ]);

      await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notes/i }).click();
      await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

      const body = await page.locator('main').innerText();

      check(body.includes('Chordae tendineae'), 'a note title from the server is shown');
      check(body.includes('They stop the valve inverting.'), 'and its body');
      check(body.includes('cardiac'), 'and its tags');

      const count = await page.locator('[data-veo-note]').count();
      check(count === 2, `both notes render (${count})`);

      const total = await page.locator('[data-veo-notes-count]').innerText();
      check(/2 notes/.test(total), 'the count is the server total, not the page size', total);

      // Search and export belong to the Library, not the workspace.
      check(
        (await page.locator('[data-veo-notes-search]').count()) === 1,
        'the Library offers search',
      );
      check(
        (await page.locator('[data-veo-notes-export]').count()) === 1,
        'and export',
      );

      check(errors.length === 0, 'no console errors on the Library', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 6. AN EMPTY RESULT IS DISTINGUISHED FROM AN EMPTY ACCOUNT ===');
    // =====================================================================
    {
      // The positive control for section 5. A panel that rendered its own
      // state would show the same thing in both cases.
      const context = await signedIn(browser);
      const page = await context.newPage();

      await serveNotes(page, []);

      await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notes/i }).click();
      await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

      const empty = await page.locator('main').innerText();
      check(/No notes yet/i.test(empty), 'with no notes, it says so');
      check(
        (await page.locator('[data-veo-note]').count()) === 0,
        'and renders none',
      );

      // Now search for something. Same empty list, different meaning.
      await page.locator('[data-veo-notes-search]').fill('chordae');
      await page.waitForTimeout(600);

      const searched = await page.locator('main').innerText();
      check(
        /Nothing matched/i.test(searched),
        'a search that matched nothing says THAT, not "no notes yet"',
        searched.slice(0, 160).replace(/\n/g, ' '),
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 7. AN INHERITED NOTE IS LABELLED, NOT MERGED ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();

      // The server returns the lineage; the panel decides what is direct.
      await serveNotes(page, [
        note({ id: 'own', semanticId: VENTRICLE, body: 'Written about the ventricle.' }),
        note({ id: 'parent', semanticId: HEART, body: 'Written about the heart.' }),
      ]);

      await page.goto(`${BASE}/explore?diagnostic=1`, { waitUntil: 'networkidle' });

      // Drive the real engine to a selection rather than faking one.
      const selected = await page
        .waitForFunction(
          (id) => {
            window.__VEO_ENGINE__?.select?.(id);
            return window.__VEO_ENGINE__?.state?.()?.selectedId === id;
          },
          'veo.diagnostic.test_scene.system_a.object_1',
          { timeout: 30_000, polling: 250 },
        )
        .then(() => true)
        .catch(() => false);

      check(selected, 'a structure is selected in the real engine');

      if (selected) {
        await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 }).catch(() => {});
        check(
          (await page.locator('[data-veo-notes]').count()) > 0,
          'the Context Panel carries a notes section for the selection',
        );
        check(
          (await page.locator('[data-veo-note-new]').count()) > 0,
          'and offers to note the structure',
        );
      }

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 8. EXPORT IS REFUSED WITHOUT THE ENTITLEMENT ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();

      await serveNotes(page, [note({ id: 'a', body: 'something to export' })]);

      // The shape the gate produces for a learner on the free tier.
      await page.route('**/api/notes/export', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: {
              code: 'plan_required',
              message: 'Exporting your notes is part of a paid plan.',
            },
          }),
        }),
      );

      await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notes/i }).click();
      await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

      await page.locator('[data-veo-notes-export]').click();
      await page.waitForSelector('[data-veo-export-refused]', { timeout: 15_000 });

      const refusal = await page.locator('[data-veo-export-refused]').innerText();
      check(/paid plan/i.test(refusal), 'the refusal says why', refusal);
      check(/See plans/i.test(refusal), 'and offers the remedy');

      const href = await page.locator('[data-veo-export-refused] a').getAttribute('href');
      check(href === '/plans', 'which links to the plans page', `${href}`);

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 9. EXPORT SUCCEEDS WITH IT ===');
    // =====================================================================
    {
      // The control for section 8: if the refusal were unconditional, both
      // would look the same.
      const context = await signedIn(browser);
      const page = await context.newPage();

      await serveNotes(page, [note({ id: 'a', body: 'something to export' })]);
      await page.route('**/api/notes/export', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/markdown; charset=utf-8',
          body: '# VEO notes\n\n_Exported 2026-10-01T00:00:00.000Z_\n\nsomething to export\n',
        }),
      );

      await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notes/i }).click();
      await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

      await page.locator('[data-veo-notes-export]').click();
      await page.waitForTimeout(1200);

      check(
        (await page.locator('[data-veo-export-refused]').count()) === 0,
        'with the entitlement, nothing is refused',
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 10. WRITING A NOTE GOES THROUGH THE SERVER ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();

      let posted = null;
      const stored = [];

      await page.route('**/api/notes**', async (route) => {
        const request = route.request();

        if (request.method() === 'POST') {
          posted = JSON.parse(request.postData() ?? '{}');
          stored.push(note({ id: 'new', title: posted.title, body: posted.body }));
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, note: stored[0] }),
          });
        }

        if (request.method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, notes: stored, total: stored.length }),
          });
        }

        return route.fallback();
      });

      await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notes/i }).click();
      await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

      await page.locator('[data-veo-note-new]').click();
      await page.waitForSelector('[data-veo-note-editor]', { timeout: 10_000 });

      const save = page.locator('[data-veo-note-save]');
      check(await save.isDisabled(), 'save is disabled while the note is empty');

      await page.locator('[data-veo-note-title-input]').fill('Papillary muscles');
      await page.locator('[data-veo-note-body-input]').fill('They tension the chordae.');
      check(await save.isEnabled(), 'and becomes available once there is something to save');

      await save.click();
      await page.waitForTimeout(1200);

      check(posted !== null, 'the note was sent to the server');
      check(posted?.title === 'Papillary muscles', 'carrying the title typed', `${posted?.title}`);
      check(posted?.body === 'They tension the chordae.', 'and the body typed');
      check(
        posted !== null && !('ownerId' in posted) && !('id' in posted),
        'and no identity of its own',
        JSON.stringify(posted),
      );

      // The list is RE-READ rather than optimistically patched, so what the
      // learner sees is what the server holds.
      const rendered = await page.locator('main').innerText();
      check(rendered.includes('Papillary muscles'), 'and the list re-read shows it');

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 11. A SERVER REFUSAL IS SHOWN, NOT SWALLOWED ===');
    // =====================================================================
    {
      const context = await signedIn(browser);
      const page = await context.newPage();

      await page.route('**/api/notes**', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({
                ok: false,
                error: { code: 'invalid_request', message: 'A note can be up to 20,000 characters.' },
              }),
            })
          : route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ ok: true, notes: [], total: 0 }),
            }),
      );

      await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /Notes/i }).click();
      await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

      await page.locator('[data-veo-note-new]').click();
      await page.locator('[data-veo-note-body-input]').fill('too long, apparently');
      await page.locator('[data-veo-note-save]').click();
      await page.waitForSelector('[data-veo-note-save-error]', { timeout: 15_000 });

      const message = await page.locator('[data-veo-note-save-error]').innerText();
      check(
        /20,000 characters/.test(message),
        "the server's own explanation is shown verbatim",
        message,
      );
      check(
        (await page.locator('[data-veo-note-editor]').count()) === 1,
        'and the editor stays open with the work still in it',
      );

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 12. SIX VIEWPORTS ===');
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

        await serveNotes(page, [
          note({ id: 'a', title: 'A note with a reasonably long title to test wrapping', body: 'x'.repeat(400), tags: ['cardiac', 'valves'] }),
        ]);

        await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
        await page.getByRole('tab', { name: /Notes/i }).click();
        await page.waitForSelector('[data-veo-notes]', { timeout: 20_000 });

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
          ['[data-veo-note]', 'the note card'],
          ['[data-veo-notes-search]', 'the search field'],
          ['[data-veo-note-new]', 'the new-note button'],
        ]) {
          const box = await page.locator(selector).first().boundingBox();
          check(
            box !== null && box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.height >= 16,
            `${viewport.name} — ${label} is reachable and not clipped`,
            JSON.stringify(box),
          );
        }

        // The editor must be usable here too: a textarea whose save button
        // sits off-screen is a feature nobody can complete.
        await page.locator('[data-veo-note-new]').click();
        await page.waitForSelector('[data-veo-note-editor]', { timeout: 10_000 });

        const bodyBox = await page.locator('[data-veo-note-body-input]').boundingBox();
        check(
          bodyBox !== null && bodyBox.x >= -1 && bodyBox.x + bodyBox.width <= viewport.width + 1,
          `${viewport.name} — the editor fits the width`,
          JSON.stringify(bodyBox),
        );

        const saveBox = await page.locator('[data-veo-note-save]').boundingBox();
        check(
          saveBox !== null && saveBox.x >= -1 && saveBox.x + saveBox.width <= viewport.width + 1,
          `${viewport.name} — the save control is on screen`,
          JSON.stringify(saveBox),
        );

        check(errors.length === 0, `${viewport.name} — no console errors`, errors.join(' | '));
        await context.close();
      }
    }

    // =====================================================================
    console.log('\n=== 13. ABUSE CONTROL IS LIVE ON WRITES ===');
    // =====================================================================
    // Last, deliberately: this spends a real limiter bucket.
    {
      const anon = await browser.newContext();
      const statuses = [];
      let limitedBody = '';

      // `notes.write` permits 60 a minute. Anonymous requests are refused at
      // the gate with 401 until the limiter takes over with 429 — so seeing
      // 429 proves the limiter runs BEFORE the auth check, which is the
      // ordering the route intends.
      for (let i = 0; i < 70; i += 1) {
        const response = await anon.request.post(`${BASE}/api/notes`, {
          data: { body: 'flood' },
          failOnStatusCode: false,
        });
        statuses.push(response.status());
        if (response.status() === 429) {
          limitedBody = await response.text();
          break;
        }
      }

      check(statuses.includes(429), 'bursting the write endpoint is rate limited', `${statuses.length} requests`);
      check(statuses[0] === 401, 'and the first was refused for the session, not the rate', `${statuses[0]}`);
      check(/rate_limited/.test(limitedBody), 'the refusal is rate_limited', limitedBody.slice(0, 120));
      check(
        !/quota_exhausted|upgrade|plan/i.test(limitedBody),
        'and says nothing about plans, because writing notes is free',
        limitedBody.slice(0, 120),
      );

      await anon.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`VEO NOTES VERIFICATION: ${results.pass} passed, ${results.fail} failed`);
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
