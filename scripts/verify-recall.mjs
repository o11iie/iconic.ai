/**
 * Gate 12 verification: the recall surface, in a real browser.
 *
 * Governing rule, unchanged from Gates 10 and 11:
 *
 *   A number appearing is NOT a pass.
 *
 * A dashboard that rendered constants would still show a streak. So every
 * check here asserts the figure on screen CORRESPONDS to the data the server
 * sent — and, for the cases that matter most, that an EMPTY account shows
 * nothing rather than a zero dressed as a measurement.
 *
 * ## What is real and what is substituted
 *
 * Real: the Next server, the middleware, the page, every component, the
 * session state machine, the layout at six widths, the keyboard handling.
 *
 * Substituted: Supabase. Auth is answered by `fixture-auth-server.mjs` so a
 * browser can be signed in at all, and the learning API is answered by route
 * interception below so the UI can be driven through states a database would
 * take days to reach. Neither substitution touches VEO's source.
 *
 * The layers this does NOT cover are covered by execution elsewhere, and
 * deliberately so:
 *   - the API routes           -> 22 behavioural tests driving the real handlers
 *   - the database and its RLS -> scripts/verify-rls.sh, 37 checks on real PostgreSQL
 *   - the scheduler and queue  -> unit tests, mutation-tested
 *
 * Usage: node scripts/verify-recall.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { authCookie } from './fixture-auth-server.mjs';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3411';

const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
  // The fixture auth server implements auth only; the browser's own Supabase
  // client probing anything else is expected and is not a VEO fault.
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
  page.on('crash', () => errors.push('page crashed'));
  return errors;
}

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like what src/app/api/learning/queue returns.
// ---------------------------------------------------------------------------

const MODEL = '__veo_ai_tutor_test_fixture__';
const CORE = 'veo.diagnostic.tutor_fixture.assembly_a.core_unit';
const EDGE = 'veo.diagnostic.tutor_fixture.assembly_a.edge_unit';

/** The structure the Gate 11 suite generates about, reused here verbatim. */
const DIAGNOSTIC_OBJ = 'veo.diagnostic.test_scene.system_a.object_1';

function emptyQueue() {
  return {
    ok: true,
    timeZone: 'UTC',
    counts: { overdue: 0, due: 0, learning: 0, new: 0, upcoming: 0, suspended: 0, actionable: 0 },
    queue: [],
    nextDueAt: null,
    upcoming: 0,
    streak: { current: 0, longest: 0, totalStudyDays: 0, lastStudyDate: null, studiedToday: false },
    goal: { target: 20, completed: 0, remaining: 20, progress: 0, met: false },
    progress: { reviewsCompleted: 0, secondsStudied: 0, studyDays: 0, firstStudyDate: null },
    activity: Array.from({ length: 28 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, '0')}`,
      reviews: 0,
    })),
    retention: { overall: null, recent: null, totalReviews: 0, recentReviews: 0 },
    mastery: { structures: [], tree: [] },
    activeSession: null,
    reviewable: 0,
  };
}

/** A learner with a real history. Every figure below is asserted on screen. */
const POPULATED = {
  streakCurrent: 7,
  streakLongest: 12,
  retentionOverall: 0.82,
  reviewsCompleted: 143,
  studyDays: 19,
  goalTarget: 20,
  goalCompleted: 6,
  due: 3,
};

function populatedQueue() {
  return {
    ok: true,
    timeZone: 'UTC',
    counts: { overdue: 2, due: 1, learning: 0, new: 0, upcoming: 4, suspended: 0, actionable: 3 },
    queue: [
      {
        itemId: 'item-1', contentId: 'question:q1', contentType: 'question',
        semanticId: CORE, modelRef: MODEL, bucket: 'overdue', overdueDays: 4.2, phase: 'review',
      },
      {
        itemId: 'item-2', contentId: 'flashcard:f1', contentType: 'flashcard',
        semanticId: EDGE, modelRef: MODEL, bucket: 'overdue', overdueDays: 1.5, phase: 'review',
      },
      {
        itemId: 'item-3', contentId: 'question:q2', contentType: 'question',
        semanticId: null, modelRef: null, bucket: 'due', overdueDays: 0.2, phase: 'review',
      },
    ],
    nextDueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    upcoming: 4,
    streak: {
      current: POPULATED.streakCurrent,
      longest: POPULATED.streakLongest,
      totalStudyDays: POPULATED.studyDays,
      lastStudyDate: '2026-03-15',
      studiedToday: true,
    },
    goal: {
      target: POPULATED.goalTarget, completed: POPULATED.goalCompleted,
      remaining: 14, progress: 0.3, met: false,
    },
    progress: {
      reviewsCompleted: POPULATED.reviewsCompleted, secondsStudied: 41_000,
      studyDays: POPULATED.studyDays, firstStudyDate: '2026-02-01',
    },
    activity: Array.from({ length: 28 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, '0')}`,
      reviews: i % 4 === 0 ? 0 : (i % 7) + 1,
    })),
    retention: {
      overall: POPULATED.retentionOverall, recent: 0.9,
      totalReviews: POPULATED.reviewsCompleted, recentReviews: 50,
    },
    mastery: {
      structures: [
        {
          semanticId: EDGE, mastery: 0.31, itemCount: 2, reviewCount: 9,
          lapses: 4, dueNow: 1, lastReviewedAt: '2026-03-14T10:00:00.000Z', band: 'struggling',
        },
        {
          semanticId: CORE, mastery: 0.74, itemCount: 3, reviewCount: 14,
          lapses: 1, dueNow: 1, lastReviewedAt: '2026-03-15T09:00:00.000Z', band: 'developing',
        },
      ],
      tree: [],
    },
    activeSession: null,
    reviewable: 2,
  };
}

const SESSION_ITEMS = [
  {
    itemId: 'item-1',
    contentType: 'question',
    semanticId: CORE,
    modelRef: MODEL,
    payload: {
      prompt: 'Which assembly does the core unit belong to?',
      options: ['Assembly A', 'Assembly B', 'Assembly C'],
      answer: 'Assembly A',
      explanation: 'The fixture places the core unit inside assembly A.',
    },
  },
  {
    itemId: 'item-2',
    contentType: 'flashcard',
    semanticId: EDGE,
    modelRef: MODEL,
    payload: { front: 'Edge unit', back: 'Sits at the boundary of assembly A.' },
  },
  {
    itemId: 'item-3',
    contentType: 'question',
    semanticId: null,
    modelRef: null,
    payload: { prompt: 'An item with no structure attached.', answer: 'Still reviewable' },
  },
];

/**
 * Install the learning API.
 *
 * `state` is mutated by the handlers, so the dashboard that renders after a
 * session reflects what the session actually did — the same way a real server
 * would. A harness that returned a constant would let a broken refresh pass.
 */
function installLearningApi(page, state) {
  return page.route('**/api/learning/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname.endsWith('/queue') && method === 'GET') {
      state.queueRequests.push(url.search);
      return json(state.queue);
    }

    if (url.pathname.endsWith('/session') && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      state.sessionStarts.push(body);
      return json({
        ok: true,
        session: {
          id: 'session-fixture-1',
          status: 'active',
          startedAt: new Date().toISOString(),
          endedAt: null,
          plannedItemIds: SESSION_ITEMS.map((item) => item.itemId),
          answeredItemIds: [],
          completedCount: 0,
          correctCount: 0,
        },
        items: SESSION_ITEMS,
      });
    }

    if (url.pathname.endsWith('/session') && method === 'PATCH') {
      state.sessionEnds.push(JSON.parse(request.postData() ?? '{}'));
      return json({ ok: true, session: null });
    }

    if (url.pathname.endsWith('/review') && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      state.reviews.push(body);

      if (state.failNextReview) {
        state.failNextReview = false;
        return json(
          { ok: false, error: { code: 'unavailable', message: 'VEO could not record that.' } },
          503,
        );
      }

      // Reflect the review in the dashboard the next refresh will fetch.
      state.queue = {
        ...state.queue,
        counts: { ...state.queue.counts, actionable: 0, overdue: 0, due: 0 },
        queue: [],
        progress: {
          ...state.queue.progress,
          reviewsCompleted: state.queue.progress.reviewsCompleted + 1,
        },
      };

      return json({
        ok: true,
        deduplicated: false,
        state: {
          phase: 'review',
          dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          intervalDays: 2,
          repetitions: 3,
          lapses: 0,
        },
      });
    }

    return json({ ok: false, error: { code: 'invalid_request', message: 'no' } }, 400);
  });
}

function freshState(queue) {
  return {
    queue,
    queueRequests: [],
    sessionStarts: [],
    sessionEnds: [],
    reviews: [],
    failNextReview: false,
  };
}

const text = (page) => page.locator('main').innerText();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54330';

/**
 * A signed-in context.
 *
 * The cookie is the one `@supabase/ssr` writes itself, so the middleware and
 * the route handlers validate it through their normal path — nothing about
 * VEO's authentication is bypassed or stubbed, only the server it talks to.
 */
async function signedInContext(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const cookie = authCookie(SUPABASE_URL);
  await context.addCookies([
    { name: cookie.name, value: cookie.value, url: BASE, httpOnly: false, sameSite: 'Lax' },
  ]);
  return context;
}

// ---------------------------------------------------------------------------

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  try {
    // =====================================================================
    console.log('\n=== 1. AN EMPTY ACCOUNT TELLS THE TRUTH ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      const state = freshState(emptyQueue());
      await installLearningApi(page, state);

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });

      const body = await text(page);

      check(
        !/\/login/.test(page.url()),
        'a signed-in learner reaches /recall rather than being redirected',
        page.url(),
      );

      // The single most important honesty check in this gate.
      check(
        !/\b0\s*%/.test(body),
        'retention is NOT shown as 0% on an account with no reviews',
        body.match(/.{0,40}0\s*%.{0,40}/)?.[0] ?? '',
      );
      check(
        /Not measured yet/i.test(body),
        'retention says it has not been measured',
      );
      check(
        /Nothing due|caught up|Nothing scheduled/i.test(body),
        'the queue says there is nothing due',
      );
      check(
        /A day counts once you complete a review/i.test(body),
        'the streak explains what would earn one rather than showing a number',
      );
      check(
        /No reviews completed yet/i.test(body),
        'progress reports zero completed honestly',
      );
      check(
        /No reviews yet/i.test(body),
        'the activity strip says it is empty',
      );
      check(
        !/Review \d+ item/i.test(body),
        'no review button is offered when nothing is due',
      );
      check(errors.length === 0, 'no console errors on the empty dashboard', errors.join(' | '));

      await context.close();
    }

    // =====================================================================
    console.log('\n=== 2. A REAL HISTORY IS REPORTED, NOT DECORATED ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      const state = freshState(populatedQueue());
      await installLearningApi(page, state);

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });
      const body = await text(page);

      // Correspondence: each figure must match the data, not merely exist.
      check(
        new RegExp(`\\b${POPULATED.streakCurrent}\\b`).test(body),
        `the streak shows the server's ${POPULATED.streakCurrent}`,
      );
      check(
        new RegExp(`Longest\\s+${POPULATED.streakLongest}`).test(body),
        `the longest streak shows the server's ${POPULATED.streakLongest}`,
      );
      check(
        new RegExp(`\\b${Math.round(POPULATED.retentionOverall * 100)}\\s*%`).test(body),
        `retention shows ${Math.round(POPULATED.retentionOverall * 100)}%, matching the data`,
      );
      check(
        new RegExp(`\\b${POPULATED.reviewsCompleted}\\b`).test(body),
        `progress shows the server's ${POPULATED.reviewsCompleted} reviews`,
      );
      check(
        new RegExp(`${POPULATED.studyDays}\\s+days`).test(body),
        `progress shows ${POPULATED.studyDays} study days`,
      );
      check(
        new RegExp(`${POPULATED.goalCompleted} of ${POPULATED.goalTarget}`).test(body),
        "today's card shows progress against the stored goal",
      );
      check(
        new RegExp(`Review ${POPULATED.due} items`).test(body),
        `the call to action offers exactly the ${POPULATED.due} due items`,
      );
      check(/2 overdue/.test(body) && /1 due/.test(body), 'the bucket breakdown matches the counts');

      // Weakest first — the struggling structure must lead.
      const structureOrder = body.indexOf('edge_unit') < body.indexOf('core_unit');
      check(structureOrder, 'the weakest structure is listed first');
      check(/31\s*%/.test(body), 'the weak structure shows its real mastery (31%)');
      check(/struggling/i.test(body), 'its band is named');

      // VEO must not invent a display name for a structure.
      check(
        !/Left Ventricle|Aorta|Heart Chamber/i.test(body),
        'no invented anatomical name appears anywhere on the dashboard',
      );

      check(errors.length === 0, 'no console errors on the populated dashboard', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 3. A REVIEW SESSION, DRIVEN END TO END ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      const state = freshState(populatedQueue());
      await installLearningApi(page, state);

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /Review 3 items/i }).click();
      await page.waitForSelector('text=Which assembly does the core unit belong to?');

      check(state.sessionStarts.length === 1, 'starting a session calls the server exactly once');
      check(
        Array.isArray(state.sessionStarts[0]?.itemIds) &&
          state.sessionStarts[0].itemIds.length === 3,
        'the client proposes the queue it was shown',
      );
      check(
        !('userId' in (state.sessionStarts[0] ?? {})),
        'the start request carries no user id',
        JSON.stringify(state.sessionStarts[0]),
      );

      // ---- rating is unavailable before answering -----------------------
      const ratingBefore = await page.getByRole('button', { name: /^Good —/ }).count();
      check(ratingBefore === 0, 'no rating control is offered before the answer is given');

      // ---- answer, then rate --------------------------------------------
      await page.getByRole('button', { name: 'Assembly A' }).click();
      await page.waitForSelector('text=You had it.');
      check(true, 'choosing the correct option is recognised as correct');

      const good = page.getByRole('button', { name: /^Good —/ });
      check((await good.count()) === 1, 'the rating bar appears once an answer is given');

      await good.click();
      await page.waitForSelector('text=Edge unit');

      check(state.reviews.length === 1, 'rating submits exactly one review');
      const first = state.reviews[0];
      check(first?.itemId === 'item-1', 'the review names the item that was on screen');
      check(first?.rating === 'good', 'the review carries the rating that was pressed');
      check(first?.correct === true, 'the review reports the answer was correct');
      check(
        typeof first?.idempotencyKey === 'string' && first.idempotencyKey.length >= 8,
        'the review carries an idempotency key',
      );
      check(
        !('userId' in (first ?? {})) && !('now' in (first ?? {})) && !('dueAt' in (first ?? {})),
        'the review names neither the learner, the time, nor the schedule',
        JSON.stringify(first),
      );
      check(first?.sessionId === 'session-fixture-1', 'the review is attributed to the session');

      // ---- flashcard: reveal by keyboard, rate by keyboard ---------------
      await page.keyboard.press(' ');
      await page.waitForSelector('text=Sits at the boundary of assembly A.');
      check(true, 'Space reveals a flashcard answer');

      await page.keyboard.press('2');
      await page.waitForSelector('text=An item with no structure attached.');
      check(state.reviews.length === 2, 'a number key submits the review');
      check(state.reviews[1]?.rating === 'hard', 'key 2 maps to Hard, matching its printed label');
      check(
        state.reviews[1]?.correct === null,
        'a self-rated flashcard reports correctness as unknown, not invented',
      );
      check(
        state.reviews[1]?.idempotencyKey !== first?.idempotencyKey,
        'each answer carries its own key',
      );

      // ---- View in 3D ----------------------------------------------------
      const linkCount = await page.getByRole('link', { name: /View in 3D/i }).count();
      check(linkCount === 0, 'an item with no structure offers no View in 3D link');

      // ---- finish --------------------------------------------------------
      //
      // The third item is a typed question, so it cannot be rated until an
      // answer is given — the same invariant asserted above, reached here by
      // a different route.
      check(
        (await page.getByRole('button', { name: /^Good —/ }).count()) === 0,
        'a typed question also withholds the rating bar until answered',
      );

      await page.keyboard.press(' ');
      await page.waitForSelector('text=Still reviewable');
      await page.getByRole('button', { name: /^Good —/ }).click();
      await page.waitForSelector('text=Session complete');

      check(state.reviews.length === 3, 'every item in the queue was reviewed');
      check(state.sessionEnds.length === 1, 'the session is closed on the server');
      check(state.sessionEnds[0]?.status === 'completed', 'it is closed as completed');
      check(
        /3 reviews recorded/.test(await text(page)),
        'the summary reports the real number of reviews',
      );

      // ---- the dashboard reflects what happened --------------------------
      await page.getByRole('button', { name: /Back to recall/i }).click();
      await page.waitForSelector('text=caught up');
      check(true, 'returning to the dashboard shows the learner is caught up');

      check(errors.length === 0, 'no console errors during a session', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 4. FAILURE DOES NOT LOSE THE LEARNER\'S ANSWER ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      const state = freshState(populatedQueue());
      await installLearningApi(page, state);

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /Review 3 items/i }).click();
      await page.waitForSelector('text=Which assembly does the core unit belong to?');

      await page.getByRole('button', { name: 'Assembly A' }).click();
      state.failNextReview = true;
      await page.getByRole('button', { name: /^Good —/ }).click();
      await page.waitForSelector('text=VEO could not record that.');

      const body = await text(page);
      check(
        /Which assembly does the core unit belong to\?/.test(body),
        'the learner stays on the item whose answer was not recorded',
      );
      check(/You had it\./.test(body), 'their answer is still on screen');
      check(
        (await page.getByRole('button', { name: /^Good —/ }).count()) === 1,
        'they can rate again',
      );

      const keyBefore = state.reviews[0]?.idempotencyKey;
      await page.getByRole('button', { name: /^Good —/ }).click();
      await page.waitForSelector('text=Edge unit');

      check(state.reviews.length === 2, 'the retry is submitted');
      check(
        state.reviews[1]?.idempotencyKey === keyBefore,
        'the retry reuses the SAME idempotency key, so it is one answer and not two',
        `${keyBefore} vs ${state.reviews[1]?.idempotencyKey}`,
      );

      // The browser logs the 503 this section deliberately caused. That one
      // line is expected; ANY other error is not, and is not ignored — a
      // blanket filter on 503s here would hide a real failure elsewhere on
      // this path.
      const expected = /Failed to load resource.*503/i;
      const unexpected = errors.filter((line) => !expected.test(line));

      check(
        errors.some((line) => expected.test(line)),
        'the deliberate failure really did reach the browser as a 503',
        'the failure path was never exercised',
      );
      check(
        unexpected.length === 0,
        'no console errors on the failure path beyond the 503 it caused',
        unexpected.join(' | '),
      );
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 5. VIEW IN 3D REACHES THE REAL WORKSPACE ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      const state = freshState(populatedQueue());
      await installLearningApi(page, state);

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /Review 3 items/i }).click();
      await page.waitForSelector('text=Which assembly does the core unit belong to?');

      const link = page.getByRole('link', { name: /View in 3D/i }).first();
      check((await link.count()) === 1, 'an item tied to a structure offers View in 3D');

      const href = await link.getAttribute('href');
      check(
        href?.includes(`model=${encodeURIComponent(MODEL)}`) ?? false,
        'the link names the model the item belongs to',
        href ?? '',
      );
      check(
        href?.includes(`select=${encodeURIComponent(CORE)}`) ?? false,
        'the link names the exact structure, which SceneController focuses',
        href ?? '',
      );

      await link.click();
      await page.waitForURL(/\/explore\?/, { timeout: 20_000 });
      check(/\/explore/.test(page.url()), 'it lands on the workspace', page.url());
      check(
        page.url().includes(encodeURIComponent(CORE)),
        'the structure survives the navigation',
        page.url(),
      );

      check(errors.length === 0, 'no console errors following View in 3D', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 6. SIX VIEWPORTS, NO HORIZONTAL SCROLL ===');
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
          width: viewport.width,
          height: viewport.height,
        });
        const page = await context.newPage();
        const errors = captureConsole(page);
        const state = freshState(populatedQueue());
        await installLearningApi(page, state);

        await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });

        // Measured by DISPLACEMENT, not by scrollWidth: an element inside a
        // horizontal scroller inflates scrollWidth without the PAGE being
        // scrollable, and reporting that as overflow is a false alarm.
        const shift = await page.evaluate(async () => {
          window.scrollTo(9999, 0);
          await new Promise((r) => requestAnimationFrame(r));
          const x = window.scrollX;
          window.scrollTo(0, 0);
          return x;
        });
        check(shift === 0, `${viewport.name} ${viewport.width}px — dashboard does not scroll sideways`, `${shift}px`);

        // The same, inside a session, where the rating bar is widest.
        await page.getByRole('button', { name: /Review 3 items/i }).click();
        await page.waitForSelector('text=Which assembly does the core unit belong to?');
        await page.getByRole('button', { name: 'Assembly A' }).click();
        await page.waitForSelector('button[aria-label^="Easy"]');

        const sessionShift = await page.evaluate(async () => {
          window.scrollTo(9999, 0);
          await new Promise((r) => requestAnimationFrame(r));
          const x = window.scrollX;
          window.scrollTo(0, 0);
          return x;
        });
        check(
          sessionShift === 0,
          `${viewport.name} ${viewport.width}px — review screen does not scroll sideways`,
          `${sessionShift}px`,
        );

        // Every rating must be reachable and large enough to hit.
        const boxes = await page.getByRole('button', { name: /—/ }).evaluateAll((nodes) =>
          nodes
            .filter((n) => /^(Again|Hard|Good|Easy) —/.test(n.getAttribute('aria-label') ?? ''))
            .map((n) => {
              const r = n.getBoundingClientRect();
              return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) };
            }),
        );
        check(boxes.length === 4, `${viewport.name} — all four ratings are present`);
        check(
          boxes.every((b) => b.h >= 40 && b.w >= 60),
          `${viewport.name} — every rating is a real touch target`,
          JSON.stringify(boxes),
        );
        check(
          boxes.every((b) => b.x >= 0 && b.x + b.w <= viewport.width + 1),
          `${viewport.name} — no rating is clipped off-screen`,
          JSON.stringify(boxes),
        );

        check(errors.length === 0, `${viewport.name} — no console errors`, errors.join(' | '));
        await context.close();
      }
    }

    // =====================================================================
    console.log('\n=== 7. KEYBOARD ONLY, NO MOUSE ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);
      const state = freshState(populatedQueue());
      await installLearningApi(page, state);

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /Review 3 items/i }).click();
      await page.waitForSelector('text=Which assembly does the core unit belong to?');

      // Every rating carries a description, not just a word.
      const labels = await page
        .getByRole('button', { name: 'Assembly A' })
        .click()
        .then(() =>
          page.getByRole('button', { name: /—/ }).evaluateAll((nodes) =>
            nodes
              .map((n) => n.getAttribute('aria-label') ?? '')
              .filter((l) => /^(Again|Hard|Good|Easy) —/.test(l)),
          ),
        );
      check(labels.length === 4, 'each rating has an accessible label');
      check(
        labels.every((l) => l.split('—')[1]?.trim().length > 5),
        'each label explains what the rating means',
        JSON.stringify(labels),
      );

      // Focus must be able to reach a rating.
      const reached = await page.evaluate(async () => {
        const buttons = [...document.querySelectorAll('button')];
        const target = buttons.find((b) => /^Good —/.test(b.getAttribute('aria-label') ?? ''));
        if (!target) return false;
        target.focus();
        return document.activeElement === target;
      });
      check(reached, 'a rating can take keyboard focus');

      await page.keyboard.press('Enter');
      await page.waitForSelector('text=Edge unit');
      check(state.reviews.length === 1, 'Enter on a focused rating submits it');
      check(state.reviews[0]?.rating === 'good', 'the focused rating is the one submitted');

      // A typed answer containing a digit must not rate the card.
      const beforeTyping = state.reviews.length;
      await page.keyboard.press(' ');
      await page.waitForSelector('text=Sits at the boundary of assembly A.');
      check(state.reviews.length === beforeTyping, 'Space reveals without rating');

      check(errors.length === 0, 'no console errors during keyboard use', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 8. GENERATED CONTENT REACHES THE SCHEDULE ===');
    // =====================================================================
    //
    // The join between Gate 11 and Gate 12. Without it the recall engine is
    // a dashboard with no way for anything to arrive in it, and the empty
    // state would be permanent rather than honest.
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const errors = captureConsole(page);

      const enrolled = [];
      await page.route('**/api/learning/enrol', async (route) => {
        enrolled.push(JSON.parse(route.request().postData() ?? '{}'));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            item: {
              itemId: `item-${enrolled.length}`,
              contentId: 'c',
              contentType: 'question',
              semanticId: null,
              phase: 'new',
              dueAt: new Date().toISOString(),
            },
          }),
        });
      });

      // The diagnostic fixture, exactly as the Gate 11 suite drives it.
      await page.goto(`${BASE}/explore?diagnostic=1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      await page.evaluate((id) => window.__VEO_ENGINE__?.select?.(id), DIAGNOSTIC_OBJ);
      await page.waitForTimeout(600);

      const selected = await page.evaluate(
        () => window.__VEO_ENGINE__?.state?.()?.selectedId ?? null,
      );
      check(selected === DIAGNOSTIC_OBJ, 'a structure is selected', String(selected));

      await page.locator('[data-veo-study-mode="quiz"]').click();
      await page.waitForSelector('[data-veo-learning-results]', { timeout: 60_000 });

      const addButton = page.locator('[data-veo-schedule-add]');
      check((await addButton.count()) === 1, 'generated content offers Add to schedule');

      await addButton.click();
      await page.waitForSelector('[data-veo-schedule-result]', { timeout: 30_000 });

      check(enrolled.length > 0, `enrolment posted ${enrolled.length} items`);

      const first = enrolled[0] ?? {};
      check(
        typeof first.contentRef === 'string' && /^(question|flashcard):/.test(first.contentRef),
        'each item carries a derived content ref, so re-adding cannot double-schedule',
        JSON.stringify(first.contentRef),
      );
      check(
        typeof first.modelRef === 'string' && first.modelRef.length > 0,
        'the item records which model it came from',
        String(first.modelRef),
      );
      check(
        typeof first.semanticId === 'string' && first.semanticId.startsWith('veo.'),
        'the item records the structure it is about',
        String(first.semanticId),
      );
      check(
        typeof first.payload === 'object' && typeof first.payload?.prompt === 'string',
        'the generated text is stored with the item, since it cannot be regenerated',
      );
      check(
        !('userId' in first) && !('now' in first) && !('dueAt' in first),
        'enrolment names neither the learner, the time, nor a schedule',
        JSON.stringify(Object.keys(first)),
      );

      const resultText = await page.locator('[data-veo-schedule-result]').innerText();
      check(
        new RegExp(`${enrolled.length} added`).test(resultText),
        'the UI reports the real number added',
        resultText,
      );

      check(errors.length === 0, 'no console errors while enrolling', errors.join(' | '));
      await context.close();
    }

    // =====================================================================
    console.log('\n=== 9. NOTHING SECRET REACHES THE BROWSER ===');
    // =====================================================================
    {
      const context = await signedInContext(browser, { width: 1440, height: 900 });
      const page = await context.newPage();
      const state = freshState(populatedQueue());
      await installLearningApi(page, state);

      const scripts = [];
      page.on('response', async (response) => {
        const type = response.headers()['content-type'] ?? '';
        if (!/javascript/.test(type)) return;
        try {
          scripts.push(await response.text());
        } catch {
          /* a script that cannot be read is not evidence either way */
        }
      });

      await page.goto(`${BASE}/recall`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /Review 3 items/i }).click();
      await page.waitForSelector('text=Which assembly does the core unit belong to?');

      const bundle = scripts.join('\n');
      check(bundle.length > 10_000, 'the scan actually read the shipped bundles', `${bundle.length} bytes`);
      check(!/SUPABASE_SERVICE_ROLE/.test(bundle), 'no service-role key name in client code');
      check(!/sk-[A-Za-z0-9]{20,}/.test(bundle), 'no OpenAI-shaped key in client code');
      check(!/\bservice_role\b/.test(bundle), 'no service_role token in client code');

      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`VEO RECALL VERIFICATION: ${results.pass} passed, ${results.fail} failed`);
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
