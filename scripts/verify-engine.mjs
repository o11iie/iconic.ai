/**
 * Gate 5 verification: drives the spatial engine in a real browser.
 *
 * Asserts engine behaviour, not DOM presence. Camera pose, GPU resource
 * counts, registry contents, selection and material state are read from the
 * engine itself through the diagnostic debug bridge, so every claim here is
 * about what the engine actually did.
 *
 * Requires NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true on the server.
 *
 * Usage: node scripts/verify-engine.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3410';
const EXPLORE = `${BASE}/explore?diagnostic=1`;

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
  return errors;
}

const state = (page) => page.evaluate(() => window.__VEO_ENGINE__?.state() ?? null);

async function waitForEngine(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const s = window.__VEO_ENGINE__?.state();
      return Boolean(s && s.ready && s.registry.length > 0);
    },
    { timeout },
  );
}

/** Canvas centre, for pointer gestures. */
async function canvasBox(page) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = captureConsole(page);

  // ---------------------------------------------------- 1-3. boot + scene --
  console.log('\n=== 1-3. PAGE, CANVAS, DIAGNOSTIC SCENE ===');
  const response = await page.goto(EXPLORE, { waitUntil: 'networkidle' });
  check(response?.status() === 200, 'workspace page opens', `status ${response?.status()}`);

  check((await page.locator('canvas').count()) > 0, 'canvas element is present');

  await waitForEngine(page);
  const booted = await state(page);

  check(booted.ready, 'engine initialises and reports ready');
  check(booted.memory !== null && booted.memory.geometries > 0, 'renderer has live GPU geometry',
    JSON.stringify(booted.memory));
  check(
    booted.registry.length === 5,
    'diagnostic scene registers its selectable nodes',
    `${booted.registry.length} registered`,
  );
  check(
    booted.registry.every((id) => id.startsWith('veo.diagnostic.')),
    'every registered id is in the reserved diagnostic namespace',
    booted.registry.join(', '),
  );

  const label = await page.locator('body').innerText();
  check(/VEO SPATIAL ENGINE TEST/.test(label), 'diagnostic scene is visibly labelled');
  check(
    /not a subject model|diagnostic content/i.test(label),
    'label states it is not subject content',
  );

  // -------------------------------------------------------- 4-5. orbit -----
  console.log('\n=== 4-5. CAMERA RESPONDS / ORBIT ===');
  const beforeOrbit = (await state(page)).camera;
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 180, cy + 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  const afterOrbit = (await state(page)).camera;
  check(
    dist(beforeOrbit.position, afterOrbit.position) > 0.1,
    'orbit moves the camera',
    `moved ${dist(beforeOrbit.position, afterOrbit.position).toFixed(3)}`,
  );
  check(
    Math.abs(afterOrbit.distance - beforeOrbit.distance) < 0.05,
    'orbit preserves distance to target',
    `${beforeOrbit.distance.toFixed(3)} -> ${afterOrbit.distance.toFixed(3)}`,
  );

  // ---------------------------------------------------------- 6. zoom ------
  console.log('\n=== 6. ZOOM ===');
  const beforeZoom = (await state(page)).camera;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(350);
  const afterZoom = (await state(page)).camera;

  check(
    afterZoom.distance < beforeZoom.distance - 0.01,
    'wheel zooms the camera in',
    `${beforeZoom.distance.toFixed(3)} -> ${afterZoom.distance.toFixed(3)}`,
  );

  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(350);
  const zoomedOut = (await state(page)).camera;
  check(
    Number.isFinite(zoomedOut.distance) && zoomedOut.distance > 0,
    'zoom stays within usable limits',
    `distance ${zoomedOut.distance.toFixed(3)}`,
  );

  // ----------------------------------------------------------- 7. pan ------
  console.log('\n=== 7. PAN ===');
  const beforePan = (await state(page)).camera;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 140, cy + 90, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(350);
  const afterPan = (await state(page)).camera;

  check(
    dist(beforePan.target, afterPan.target) > 0.05,
    'pan moves the camera target',
    `target moved ${dist(beforePan.target, afterPan.target).toFixed(3)}`,
  );

  // --------------------------------------------------------- 8. reset ------
  console.log('\n=== 8. RESET ===');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(500);
  const afterReset = (await state(page)).camera;

  check(
    dist(afterReset.target, [0, 0, 0]) < 0.6,
    'reset returns the camera target to the model centre',
    `target ${afterReset.target.map((v) => v.toFixed(2)).join(', ')}`,
  );
  check(
    dist(afterReset.position, afterPan.position) > 0.1,
    'reset actually moves the camera back',
  );

  // ------------------------------------------- 9-11. target, select, highlight
  console.log('\n=== 9-11. TARGETING, SELECTION, HIGHLIGHT ===');
  const targetId = booted.registry[0];

  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), targetId);
  await page.waitForTimeout(250);
  let s = await state(page);

  check(s.selectedId === targetId, 'an object can be targeted by semantic id', s.selectedId ?? 'none');
  check(s.visualStates[targetId] === 'selected', 'selection produces a selected visual state',
    s.visualStates[targetId]);
  check(
    Object.entries(s.visualStates).filter(([, v]) => v === 'selected').length === 1,
    'exactly one object is selected at a time',
  );

  // Selection must be reflected outside the canvas — the canvas is aria-hidden,
  // so this panel and the live region are how the selection is communicated.
  const panelText = await page.locator('aside[aria-label="Structure details"]').innerText();
  check(
    panelText.includes(targetId),
    'selection is reported outside the canvas with its semantic id',
    panelText.slice(0, 80).replace(/\n/g, ' / '),
  );
  // The heading, not the whole panel: the semantic id is printed there too,
  // and matching against it would pass without the name ever being rendered.
  const panelHeading = await page
    .locator('aside[aria-label="Structure details"] h2')
    .first()
    .innerText();
  check(
    /^Object \d+$/.test(panelHeading.trim()),
    'the panel names the selected object',
    `heading "${panelHeading.trim()}"`,
  );

  const liveRegion = await page.locator('[aria-live="polite"]').first().innerText();
  check(/Selected/i.test(liveRegion), 'selection is announced in a live region', liveRegion);

  // ---- pointer selection through the real raycast path ----
  await page.evaluate(() => window.__VEO_ENGINE__.select(null));
  await page.getByRole('button', { name: 'Fit model' }).click();
  await page.waitForTimeout(500);

  let hitFound = false;
  const gridSteps = [-0.22, -0.11, 0, 0.11, 0.22];
  outer: for (const dx of gridSteps) {
    for (const dy of gridSteps) {
      await page.mouse.move(cx + dx * box.width, cy + dy * box.height);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(120);
      const hit = await state(page);
      if (hit.selectedId) {
        hitFound = true;
        break outer;
      }
    }
  }
  check(hitFound, 'clicking geometry selects it through the raycast pipeline');

  // ---- highlight clears ----
  // Park the pointer off the canvas first: a structure under the cursor is
  // legitimately 'hovered', which is not residue.
  await page.mouse.move(4, 4);
  await page.evaluate(() => window.__VEO_ENGINE__.select(null));
  await page.waitForTimeout(250);
  s = await state(page);

  check(s.selectedId === null, 'selection clears');
  check(s.hoveredId === null, 'hover clears when the pointer leaves the canvas');
  check(
    Object.values(s.visualStates).every((v) => v === 'default'),
    'highlight clears with no visual residue',
    JSON.stringify(s.visualStates),
  );

  // ---- repeated selection changes must not accumulate ----
  for (const id of [...booted.registry, ...booted.registry]) {
    await page.evaluate((x) => window.__VEO_ENGINE__.select(x), id);
  }
  await page.waitForTimeout(250);
  s = await state(page);
  check(
    Object.entries(s.visualStates).filter(([, v]) => v === 'selected').length === 1,
    'repeated selection changes leave exactly one highlight',
  );

  // ------------------------------------------ 12-13. fit + model replacement
  console.log('\n=== 12-13. FIT TO SELECTION / MODEL REPLACEMENT ===');
  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), booted.registry[2]);
  const beforeFit = (await state(page)).camera;
  await page.evaluate(() => window.__VEO_ENGINE__.fitSelection());
  await page.waitForTimeout(500);
  const afterFit = (await state(page)).camera;

  check(
    dist(beforeFit.position, afterFit.position) > 0.05 ||
      Math.abs(beforeFit.distance - afterFit.distance) > 0.05,
    'fit-to-selection reframes the camera',
    `distance ${beforeFit.distance.toFixed(2)} -> ${afterFit.distance.toFixed(2)}`,
  );

  const beforeReplace = await state(page);
  const baselineGeometries = beforeReplace.memory.geometries;
  check(beforeReplace.selectedId !== null, 'a selection is held going into replacement');

  for (let cycle = 0; cycle < 4; cycle += 1) {
    await page.evaluate(() => window.__VEO_ENGINE__.replaceScene());
    await page.waitForTimeout(450);
  }
  await waitForEngine(page);
  const afterReplace = await state(page);

  check(
    afterReplace.sceneEpoch >= 4,
    'scene replacement actually ran',
    `epoch ${afterReplace.sceneEpoch}`,
  );
  check(
    afterReplace.registry.length === beforeReplace.registry.length,
    'registry holds no stale objects after replacement',
    `${beforeReplace.registry.length} -> ${afterReplace.registry.length}`,
  );
  // A reload of the same scene deliberately KEEPS the learner's selection —
  // losing it on every reload would be hostile. What must not happen is the
  // selection becoming a dangling reference to disposed geometry, so assert
  // it still resolves and its highlight re-applied to the NEW meshes.
  check(
    afterReplace.selectedId === null ||
      afterReplace.registry.includes(afterReplace.selectedId),
    'any surviving selection still resolves in the rebuilt registry',
    `${afterReplace.selectedId} in [${afterReplace.registry.join(', ')}]`,
  );
  check(
    afterReplace.selectedId === null ||
      afterReplace.visualStates[afterReplace.selectedId] === 'selected',
    'the highlight re-applies to the replacement geometry, not the disposed mesh',
    JSON.stringify(afterReplace.visualStates),
  );
  check(
    afterReplace.memory.geometries <= baselineGeometries,
    'GPU geometry count does not grow across 4 replacements (no leak)',
    `${baselineGeometries} -> ${afterReplace.memory.geometries}`,
  );

  // ------------------------------------------------- 14-15. errors, layout --
  console.log('\n=== 14-15. CONSOLE + LAYOUT ===');
  check(errors.length === 0, 'no console errors during the whole session', errors.join(' | '));

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 2, 'no horizontal page overflow', `${overflow}px`);

  const pageScroll = await page.evaluate(
    () => document.body.scrollHeight - window.innerHeight,
  );
  check(pageScroll <= 4, 'the 3D canvas introduces no page-level scrolling', `${pageScroll}px`);

  await page.close();
  await context.close();

  // ---------------------------------------------------------- 16. mobile ---
  console.log('\n=== 16. MOBILE VIEWPORT ===');
  for (const [w, h, name] of [
    [360, 780, '360'],
    [390, 844, '390'],
    [430, 932, '430'],
    [768, 1024, '768'],
  ]) {
    const mobile = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: true,
      isMobile: w < 768,
    });
    const mpage = await mobile.newPage();
    const merrors = captureConsole(mpage);

    await mpage.goto(EXPLORE, { waitUntil: 'networkidle' });
    await waitForEngine(mpage);

    const canvas = await mpage.locator('canvas').first().boundingBox();
    check(
      canvas !== null && canvas.height >= h * 0.3,
      `${name} canvas is a usable size, not a thumbnail`,
      canvas ? `${Math.round(canvas.height)}px of ${h}px` : 'no canvas',
    );

    const mOverflow = await mpage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(mOverflow <= 2, `${name} has no horizontal overflow`, `${mOverflow}px`);

    // Touch orbit must move the camera.
    //
    // Wait for the camera to settle first: the initial framing animates, and
    // sampling a pose mid-transition compares two moving values and can read
    // as no movement at all. That was an intermittent failure here, and a
    // test that sometimes measures the wrong thing is worse than no test.
    await mpage.waitForFunction(
      () => {
        const camera = window.__VEO_ENGINE__?.state().camera;
        if (!camera) return false;
        const previous = window.__veoSettle;
        window.__veoSettle = camera.position.join(',');
        return previous === window.__veoSettle;
      },
      { timeout: 10000, polling: 250 },
    );

    const beforeTouch = (await state(mpage)).camera;
    const tx = canvas.x + canvas.width / 2;
    const ty = canvas.y + canvas.height / 2;
    await mpage.touchscreen.tap(tx, ty);
    await mpage.waitForTimeout(150);

    await mpage.mouse.move(tx, ty);
    await mpage.mouse.down();
    await mpage.mouse.move(tx + 90, ty + 40, { steps: 8 });
    await mpage.mouse.up();
    await mpage.waitForTimeout(400);

    const afterTouch = (await state(mpage)).camera;
    check(
      dist(beforeTouch.position, afterTouch.position) > 0.05,
      `${name} camera responds to drag`,
      `moved ${dist(beforeTouch.position, afterTouch.position).toFixed(3)}`,
    );

    check(merrors.length === 0, `${name} logs no console errors`, merrors.join(' | '));

    await mpage.close();
    await mobile.close();
  }

  // ------------------------------------------------ honest unavailable state
  console.log('\n=== HONEST STATE WITHOUT A LICENSED ASSET ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);

    const text = await p.locator('body').innerText();
    check(
      /Choose a model|3D model unavailable/i.test(text),
      'workspace reports an honest state rather than rendering stand-in geometry',
    );
    check(
      !/VEO SPATIAL ENGINE TEST/.test(text),
      'diagnostic content never appears on the normal workspace',
    );

    await p.close();
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log('\n' + '='.repeat(64));
console.log(`ENGINE RESULT: ${results.pass} passed, ${results.fail} failed`);
if (results.problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of results.problems) console.log(`  - ${problem}`);
}
console.log('='.repeat(64));

process.exit(results.fail === 0 ? 0 : 1);
