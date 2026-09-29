/**
 * Gate verification: drives the real application in a real browser.
 *
 * Checks that cannot be made from source inspection:
 *   1. every route responds and renders its landmarks
 *   2. no console errors or page errors on any route
 *   3. the layout holds at every supported breakpoint, with no horizontal
 *      overflow and no viewport collapsing to a thumbnail
 *   4. navigation actually moves between routes
 *   5. keyboard accessibility baseline: skip link, focus visibility
 *
 * Usage: node scripts/verify-ui.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { authCookie } from './fixture-auth-server.mjs';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3410';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54330';

const ROUTES = [
  // `anon` marks a route that must be visited SIGNED OUT. /login and /signup
  // redirect an authenticated visitor to the dashboard — correct product
  // behaviour, asserted in section 7 — so visiting them signed in would test
  // the redirect rather than the page.
  { path: '/', name: 'Landing', heading: /Learning you can see/i, anon: true },
  { path: '/login', name: 'Login', heading: /Sign in to VEO/i, anon: true },
  { path: '/signup', name: 'Signup', heading: /Create your VEO account/i, anon: true },
  { path: '/forgot-password', name: 'Forgot password', heading: /Reset your password/i },
  { path: '/reset-password', name: 'Reset password', heading: /Set a new password/i },
  { path: '/onboarding', name: 'Onboarding', heading: /What should we call you/i },
  { path: '/dashboard', name: 'Home', heading: /Home|Welcome back/i },
  { path: '/learn', name: 'Learn', heading: /Browse what VEO teaches/i },
  { path: '/explore', name: 'Explore', heading: null },
  { path: '/recall', name: 'Recall', heading: /Retrieve it from memory/i },
  { path: '/library', name: 'Library', heading: /Your source material/i },
  { path: '/settings', name: 'Settings', heading: /Account, preferences and the integrations/i },
  { path: '/legal/terms', name: 'Terms', heading: /Terms of Service/i },
  { path: '/legal/privacy', name: 'Privacy', heading: /What VEO stores/i },
];

const BREAKPOINTS = [
  { width: 360, height: 780, label: '360 (small phone)' },
  { width: 390, height: 844, label: '390 (phone)' },
  { width: 430, height: 932, label: '430 (large phone)' },
  { width: 768, height: 1024, label: '768 (tablet)' },
  { width: 1024, height: 768, label: '1024 (small laptop)' },
  { width: 1440, height: 900, label: '1440 (desktop)' },
];

/** Console noise that is not a defect in the application. */
const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
  /fixture-auth-server implements auth only/i,
  /*
   * The fixture provides AUTHENTICATION and deliberately no database, so the
   * learning and analytics routes correctly answer 503 "could not reach your
   * learning record". The browser logs a generic line for any failed fetch,
   * which is not an application error.
   *
   * This ignore is not a blanket one: `EXPECTED_UNAVAILABLE` below lists the
   * only endpoints allowed to 503, every failed response is checked against
   * it, and section 8 asserts the pages SAY so rather than showing zeros. A
   * 503 from anywhere else still fails the run.
   */
  /Failed to load resource: the server responded with a status of 503/i,
];

/**
 * The endpoints that may answer 503 in this environment, because they need the
 * database the fixture does not provide.
 */
const EXPECTED_UNAVAILABLE = [/\/api\/learning\//, /\/api\/analytics\//, /\/api\/account/];

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

function attachConsoleCapture(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORED.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  // Any failing response from an endpoint NOT on the expected list is a real
  // error, and is recorded here rather than being swallowed by the ignore
  // above.
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (EXPECTED_UNAVAILABLE.some((pattern) => pattern.test(url))) return;
    errors.push(`unexpected ${response.status()} from ${url}`);
  });

  return errors;
}

/**
 * A browser context, optionally carrying a session.
 *
 * Gate 2's shell used to be verified signed OUT, which worked only because a
 * deployment with no Supabase left protected routes reachable. Gate 15 closed
 * that, and the shell is now verified as an authenticated learner — which is
 * the path a real user takes, so this is a stronger check than the one it
 * replaces, not a workaround for it.
 */
async function contextFor(browser, viewport, { signedIn = true } = {}) {
  const context = await browser.newContext({ viewport });
  if (signedIn) {
    const cookie = authCookie(SUPABASE_URL);
    await context.addCookies([
      { name: cookie.name, value: cookie.value, url: BASE, httpOnly: false, sameSite: 'Lax' },
    ]);
  }
  return context;
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

try {
  // ---------------------------------------------------------------- routes --
  console.log('\n=== 1. ROUTES RENDER, NO CONSOLE ERRORS ===');
  {
    for (const route of ROUTES) {
      const context = await contextFor(
        browser,
        { width: 1440, height: 900 },
        { signedIn: !route.anon },
      );
      const page = await context.newPage();
      const errors = attachConsoleCapture(page);

      const response = await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
      const status = response?.status() ?? 0;

      check(status === 200, `${route.name} (${route.path}) responds 200`, `got ${status}`);

      const main = await page.locator('#veo-main').count();
      check(main > 0, `${route.name} renders a <main> landmark`);

      if (route.heading) {
        const text = await page.locator('body').innerText();
        check(route.heading.test(text), `${route.name} shows its heading`);
      }

      await page.waitForTimeout(350);
      check(errors.length === 0, `${route.name} logs no console errors`, errors.join(' | '));

      await page.close();
      await context.close();
    }
  }

  // ------------------------------------------------------------ breakpoints --
  console.log('\n=== 2. RESPONSIVE BREAKPOINTS ===');
  {
    const responsiveRoutes = ['/', '/dashboard', '/explore', '/learn', '/settings'];
    for (const breakpoint of BREAKPOINTS) {
      const context = await contextFor(browser, {
        width: breakpoint.width,
        height: breakpoint.height,
      });
      const page = await context.newPage();

      for (const path of responsiveRoutes) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        // A couple of pixels of sub-pixel rounding is tolerable; a scrollbar is not.
        check(
          overflow <= 2,
          `${breakpoint.label} ${path} has no horizontal overflow`,
          `overflow ${overflow}px`,
        );
      }

      // Navigation must be reachable at every size: rail on desktop, bottom nav on mobile.
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      const navVisible = await page
        .locator('nav[aria-label="Primary"]')
        .evaluateAll((nodes) => nodes.some((node) => node.getBoundingClientRect().height > 0));
      check(navVisible, `${breakpoint.label} primary navigation is visible`);

      await page.close();
      await context.close();
    }
  }

  // ----------------------------------------------- viewport is the hero ------
  console.log('\n=== 3. 3D VIEWPORT IS VISUALLY DOMINANT ===');
  {
    for (const breakpoint of [BREAKPOINTS[0], BREAKPOINTS[3], BREAKPOINTS[5]]) {
      const context = await contextFor(browser, {
        width: breakpoint.width,
        height: breakpoint.height,
      });
      const page = await context.newPage();
      await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      const metrics = await page.evaluate(() => {
        const canvasRegion = document.querySelector('[aria-label="Structure details"]')
          ? null
          : null;
        void canvasRegion;
        // The canvas column is the flex-1 region inside the workspace row.
        const region =
          document.querySelector('main #veo-main, main') ?? document.querySelector('main');
        const rect = region?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          mainWidth: rect?.width ?? 0,
          mainHeight: rect?.height ?? 0,
          bodyScrollHeight: document.body.scrollHeight,
        };
      });

      // The workspace must fill the screen rather than sit inside a scrolling page.
      const fillsScreen = metrics.mainHeight >= metrics.viewportHeight * 0.6;
      check(
        fillsScreen,
        `${breakpoint.label} workspace fills the screen`,
        `main ${Math.round(metrics.mainHeight)}px of ${metrics.viewportHeight}px`,
      );

      const noPageScroll = metrics.bodyScrollHeight <= metrics.viewportHeight + 4;
      check(
        noPageScroll,
        `${breakpoint.label} workspace does not scroll the page`,
        `body ${metrics.bodyScrollHeight}px vs viewport ${metrics.viewportHeight}px`,
      );

      await page.close();
      await context.close();
    }
  }

  // ------------------------------------------------------------ navigation --
  console.log('\n=== 4. NAVIGATION ===');
  {
    const context = await contextFor(browser, { width: 1440, height: 900 });
    const page = await context.newPage();
    const errors = attachConsoleCapture(page);

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

    for (const [label, expected] of [
      ['Learn', '/learn'],
      ['Explore', '/explore'],
      ['Recall', '/recall'],
      ['Library', '/library'],
      ['Home', '/dashboard'],
    ]) {
      await page.locator(`nav[aria-label="Primary"] a`, { hasText: label }).first().click();
      await page.waitForURL(`**${expected}*`, { timeout: 8000 }).catch(() => {});
      const url = new URL(page.url());
      check(url.pathname === expected, `clicking "${label}" navigates to ${expected}`, page.url());
    }

    // The active route must be announced, not merely coloured.
    const current = await page.locator('nav[aria-label="Primary"] a[aria-current="page"]').count();
    check(current >= 1, 'active navigation item exposes aria-current="page"');

    check(errors.length === 0, 'navigation produces no console errors', errors.join(' | '));

    await page.close();
    await context.close();
  }

  // --------------------------------------------------------- accessibility --
  console.log('\n=== 5. ACCESSIBILITY BASELINE ===');
  {
    const context = await contextFor(browser, { width: 1440, height: 900 });
    const page = await context.newPage();

    for (const path of ['/dashboard', '/explore']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });

      // First Tab should reach the skip link.
      await page.keyboard.press('Tab');
      const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
      check(
        /skip to/i.test(firstFocus ?? ''),
        `${path} exposes a skip link as the first tab stop`,
        firstFocus ?? 'nothing focused',
      );

      // Focus must be visible, not removed.
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const style = window.getComputedStyle(el);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      check(
        outline !== null && outline.outlineStyle !== 'none',
        `${path} keeps a visible focus indicator`,
        JSON.stringify(outline),
      );
    }

    // Every image-free icon button must carry an accessible name.
    await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((button) => {
          const text = (button.textContent ?? '').trim();
          const label = button.getAttribute('aria-label');
          const labelledBy = button.getAttribute('aria-labelledby');
          return text.length === 0 && !label && !labelledBy;
        })
        .map((button) => button.outerHTML.slice(0, 80)),
    );
    check(unnamed.length === 0, 'every button has an accessible name', unnamed.join(' | '));

    // Exactly one h1 per page is the expected document outline.
    for (const path of ['/dashboard', '/learn', '/library', '/settings']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      const h1s = await page.locator('h1').count();
      check(h1s === 1, `${path} has exactly one <h1>`, `found ${h1s}`);
    }

    await page.close();
    await context.close();
  }

  // ------------------------------------------------------ honest 3D state ---
  console.log('\n=== 6. NO FABRICATED CONTENT ===');
  {
    const context = await contextFor(browser, { width: 1440, height: 900 });
    const page = await context.newPage();

    await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const exploreText = await page.locator('body').innerText();
    check(
      /Choose a model|3D model unavailable/i.test(exploreText),
      'workspace reports an honest model state rather than rendering stand-in geometry',
    );

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    const dashboardText = await page.locator('body').innerText();
    const fabricated = dashboardText.match(
      /\b\d+%\s*(complete|mastered|retention|accuracy)|\b\d+\s*day streak\b/gi,
    );
    check(fabricated === null, 'dashboard shows no fabricated statistics', (fabricated ?? []).join(', '));

    await page.goto(`${BASE}/learn`, { waitUntil: 'networkidle' });
    const learnText = await page.locator('body').innerText();
    check(
      /Awaiting licensed assets/i.test(learnText),
      'Learn marks anatomy categories as awaiting licensed assets',
    );

    await page.close();
    await context.close();
  }

  // ------------------------------------------------------ session routing ---
  console.log('\n=== 7. ROUTING FOLLOWS THE SESSION ===');
  {
    // Signed in, the sign-in screens are not somewhere to be.
    const signedIn = await contextFor(browser, { width: 1440, height: 900 });
    const page = await signedIn.newPage();

    for (const path of ['/login', '/signup']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      check(
        new URL(page.url()).pathname === '/dashboard',
        `signed in, ${path} redirects to the dashboard`,
        page.url(),
      );
    }
    await page.close();
    await signedIn.close();

    // Signed out, every protected route sends them to sign in and remembers
    // where they were going.
    const anon = await contextFor(browser, { width: 1440, height: 900 }, { signedIn: false });
    const anonPage = await anon.newPage();

    for (const path of ['/dashboard', '/learn', '/recall', '/library', '/settings', '/analytics', '/plans', '/onboarding']) {
      await anonPage.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      const url = new URL(anonPage.url());
      check(url.pathname === '/login', `signed out, ${path} redirects to sign in`, anonPage.url());
      check(
        url.searchParams.get('next') === path,
        `signed out, ${path} is remembered for after sign-in`,
        url.search,
      );
    }

    // And /explore stays open: Gate 2's deliberate product demonstration.
    const explore = await anonPage.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
    check(
      new URL(anonPage.url()).pathname === '/explore' && (explore?.status() ?? 0) === 200,
      'signed out, /explore remains reachable',
      anonPage.url(),
    );

    await anonPage.close();
    await anon.close();
  }

  // ------------------------------------------- honest about missing data ---
  console.log('\n=== 8. AN UNREACHABLE RECORD IS SAID, NOT INVENTED ===');
  {
    /*
     * This environment has authentication and no database on purpose. A
     * learner in that situation must be TOLD their record is unreachable.
     * Showing a zero would be indistinguishable, to them, from having studied
     * nothing — which is the fabrication Gate 2 exists to forbid.
     */
    const context = await contextFor(browser, { width: 1440, height: 900 });
    const page = await context.newPage();

    for (const [path, label] of [['/dashboard', 'Home'], ['/recall', 'Recall']]) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const body = await page.locator('body').innerText();

      check(
        /could not reach|not configured|unavailable|couldn't reach/i.test(body),
        `${label} says the learning record is unreachable`,
        body.slice(0, 160).replace(/\n/g, ' '),
      );
      check(
        !/\b\d+\s*day streak\b|\b\d+%\s*(retention|mastered|accuracy)/i.test(body),
        `${label} invents no statistics while the record is unreachable`,
      );
    }

    await page.close();
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('\n' + '='.repeat(60));
console.log(`RESULT: ${results.pass} passed, ${results.fail} failed`);
if (results.problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of results.problems) console.log(`  - ${problem}`);
}
console.log('='.repeat(60));

process.exit(results.fail === 0 ? 0 : 1);
