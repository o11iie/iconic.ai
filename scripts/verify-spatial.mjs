/**
 * Gate 7 verification: spatial manipulation in a real browser.
 *
 * Gate 6 proved that what a learner touches resolves to a semantic object.
 * This proves they can take the model apart and put it back: that every
 * manipulation is a change of presentation, that no semantic object is
 * destroyed by any of them, that an exploded part returns to the exact
 * coordinates the asset shipped, and that a reset run twice differs in no way
 * from a reset run once.
 *
 * Requires NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true on the server.
 *
 * Usage: node scripts/verify-spatial.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3410';
const EXPLORE = `${BASE}/explore?diagnostic=1`;

const IGNORED = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /favicon\.ico/i];

const SCENE = 'veo.diagnostic.test_scene';
const SYS_A = `${SCENE}.system_a`;
const OBJ_1 = `${SCENE}.system_a.object_1`;
const OBJ_2 = `${SCENE}.system_a.object_2`;
const OBJ_3 = `${SCENE}.system_b.object_3`;
const OBJ_4 = `${SCENE}.system_b.object_4`;
const OBJ_5 = `${SCENE}.system_c.object_5`;

const LAYER_SHELL = 'shell';
const LAYER_FRAME = 'frame';


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
const visual = (page, id) => page.evaluate((x) => window.__VEO_ENGINE__.visualState(x), id);
const transform = (page, id) => page.evaluate((x) => window.__VEO_ENGINE__.nodeTransform(x), id);

async function waitForEngine(page, timeout = 25000) {
  await page.waitForFunction(
    () => {
      const s = window.__VEO_ENGINE__?.state();
      return Boolean(s && s.ready && s.registry.length > 0);
    },
    { timeout },
  );
}

/** Run an engine action by name, then let the frame settle. */
async function act(page, name, arg) {
  const value = await page.evaluate(
    ([fn, a]) => (a === undefined ? window.__VEO_ENGINE__[fn]() : window.__VEO_ENGINE__[fn](a)),
    [name, arg],
  );
  await page.waitForTimeout(120);
  return value;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Every object still resolves to its full semantic identity. */
async function semanticsIntact(page, label) {
  const report = await page.evaluate(
    (ids) => {
      const engine = window.__VEO_ENGINE__;
      return ids.map((id) => {
        const hierarchy = engine.hierarchy(id);
        return {
          id,
          registered: engine.state().registry.includes(id),
          parent: hierarchy.parent,
          ancestors: hierarchy.ancestors.length,
          found: engine.search(id).includes(id),
        };
      });
    },
    [OBJ_1, OBJ_2, OBJ_3, OBJ_4, OBJ_5],
  );

  const broken = report.filter((r) => !r.registered || r.parent === null || !r.found);
  check(
    broken.length === 0,
    `${label}: every semantic object survives, registered and searchable`,
    broken.map((r) => r.id).join(', '),
  );
}

async function runDesktop(page, errors) {
  // ------------------------------------------------------- 1-2. open -------
  console.log('\n=== 1-2. WORKSPACE AND DIAGNOSTIC MODEL ===');
  const response = await page.goto(EXPLORE, { waitUntil: 'networkidle' });
  check(response?.status() === 200, 'workspace opens', `status ${response?.status()}`);

  await waitForEngine(page);
  const booted = await state(page);
  check(booted.ready, 'engine reports ready');
  check(booted.registry.length === 5, 'five objects are backed by geometry', `${booted.registry.length}`);
  check(
    await page.getByText('VEO SPATIAL ENGINE TEST', { exact: false }).first().isVisible(),
    'diagnostic content is labelled as such',
  );

  // ------------------------------------------------ capability discovery ---
  console.log('\n=== CAPABILITY DISCOVERY ===');
  const caps = booted.capabilities;
  check(caps.supportsLayers === true, 'layers reported from the model, not assumed');
  check(caps.supportsPeeling === true, 'peeling reported', `steps ${booted.peelSteps}`);
  check(booted.peelSteps === 2, 'peel steps come from the model layer sequence', `${booted.peelSteps}`);
  check(caps.supportsDissection === true, 'dissection reported');
  check(caps.supportsExplosion === true, 'explosion reported');
  check(caps.supportsReconstruction === true, 'reconstruction reported');

  const toolbar = page.getByRole('toolbar', { name: 'Spatial tools' });
  const toolNames = await toolbar.getByRole('button').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute('aria-label') ?? n.textContent?.trim() ?? ''),
  );
  check(
    ['Layers', 'Isolate', 'Dissect', 'Explode'].every((t) => toolNames.some((n) => n.includes(t))),
    'the toolbar offers exactly what the model supports',
    toolNames.join(', '),
  );

  // ----------------------------------------------------- 3-6. isolate ------
  console.log('\n=== 3-6. ISOLATION ===');
  await act(page, 'select', OBJ_1);
  check((await state(page)).selectedId === OBJ_1, 'object A is selected');

  const beforeIsolate = (await state(page)).camera;
  check(await act(page, 'isolateObject', SYS_A), 'isolate accepted');
  await page.waitForTimeout(500);

  let s = await state(page);
  check(s.isolatedId === SYS_A, 'isolation state is held on the controller', `${s.isolatedId}`);
  check(
    (await visual(page, SYS_A)) === 'selected',
    'selection outranks isolation on the object that carries both',
    `${await visual(page, SYS_A)}`,
  );
  check(
    (await visual(page, OBJ_1)) === 'isolated',
    'a member of the isolated subtree reports its own state',
    `${await visual(page, OBJ_1)}`,
  );
  check(await visual(page, OBJ_3) === 'ghosted', 'unrelated objects are de-emphasised, not deleted');
  check(s.selectedId === SYS_A, 'the selection survives isolation', `${s.selectedId}`);
  await semanticsIntact(page, 'isolated');

  const afterIsolate = (await state(page)).camera;
  check(
    dist(beforeIsolate.position, afterIsolate.position) > 0.05,
    'the camera frames the isolated content',
    `${beforeIsolate.distance.toFixed(2)} -> ${afterIsolate.distance.toFixed(2)}`,
  );

  await act(page, 'restoreIsolation');
  s = await state(page);
  check(s.isolatedId === null, 'isolation is restored');
  check(await visual(page, OBJ_3) === 'default', 'context returns to normal');
  check(s.selectedId === SYS_A, 'restoring isolation keeps the selection', `${s.selectedId}`);

  // ------------------------------------------------------ 7-9. ghost -------
  console.log('\n=== 7-9. GHOSTING ===');
  check(await act(page, 'ghostObject', OBJ_3), 'ghost accepted');
  check(await visual(page, OBJ_3) === 'ghosted', 'object B is ghosted');

  const ghostedNode = await transform(page, OBJ_3);
  check(ghostedNode !== null, 'a ghosted object remains spatially present');
  check((await state(page)).registry.includes(OBJ_3), 'a ghosted object stays registered');

  await act(page, 'showObject', OBJ_3);
  check(await visual(page, OBJ_3) === 'default', 'ghosting is reversed');

  // ---------------------------------------------------- 10-12. hide --------
  console.log('\n=== 10-12. HIDE AND SHOW ===');
  await act(page, 'hideObject', OBJ_3);
  check(await visual(page, OBJ_3) === 'hidden', 'object B disappears');
  check((await state(page)).registry.includes(OBJ_3), 'a hidden object is never unregistered');
  check(
    (await page.evaluate((id) => window.__VEO_ENGINE__.hierarchy(id), OBJ_3)).parent !== null,
    'a hidden object keeps its place in the hierarchy',
  );

  await act(page, 'showObject', OBJ_3);
  check(await visual(page, OBJ_3) === 'default', 'object B comes back');

  // -------------------------------------------------- 13-16. layers --------
  console.log('\n=== 13-16. LAYERS ===');
  await page.getByRole('button', { name: /^Layers$/ }).click();
  await page.waitForTimeout(250);

  const layerRows = page.locator('[data-layer]');
  check(await layerRows.count() === 3, 'the panel lists the layers the model declares', `${await layerRows.count()}`);

  await page.getByRole('button', { name: `Hide ${'Shell'}` }).click();
  await page.waitForTimeout(250);

  check(await act(page, 'layerState', LAYER_SHELL) === 'hidden', 'the layer reports hidden');
  check(await visual(page, OBJ_1) === 'hidden', 'its objects stop rendering');
  check(await visual(page, OBJ_3) === 'hidden', 'across the hierarchy, not down it');
  check(await visual(page, OBJ_2) === 'default', 'another layer is unaffected');
  await semanticsIntact(page, 'layer hidden');

  await page.getByRole('button', { name: 'Ghost Shell' }).click();
  await page.waitForTimeout(250);
  check(await act(page, 'layerState', LAYER_SHELL) === 'ghosted', 'a layer can be ghosted instead');
  check(await visual(page, OBJ_1) === 'ghosted', 'its objects become faint rather than gone');

  await page.getByRole('button', { name: 'Show Shell' }).click();
  await page.waitForTimeout(250);
  check(await act(page, 'layerState', LAYER_SHELL) === 'visible', 'the layer is restored');
  check(await visual(page, OBJ_1) === 'default', 'its objects render normally again');

  await page.getByRole('button', { name: 'Close layers' }).click();

  // --------------------------------------------------- 17-21. peel ---------
  console.log('\n=== 17-21. PEEL ===');
  check(await act(page, 'nextPeel'), 'the first peel step runs');
  check(await visual(page, OBJ_1) === 'peeled', 'the outermost layer is taken away');
  check(await visual(page, OBJ_2) === 'default', 'the next layer is revealed');
  check(await visual(page, OBJ_5) === 'default', 'the core is untouched');

  check(await act(page, 'nextPeel'), 'the second peel step runs');
  check(await visual(page, OBJ_2) === 'peeled', 'the second layer is taken away');
  check(await visual(page, OBJ_5) === 'default', 'the core is revealed and never peeled');
  check((await act(page, 'nextPeel')) === false, 'peeling stops before emptying the viewport');

  check(await act(page, 'previousPeel'), 'peel reverses');
  check(await visual(page, OBJ_2) === 'default', 'the reversed layer comes back');

  await act(page, 'resetPeel');
  s = await state(page);
  check(s.peelLevel === 0, 'peel resets to whole', `level ${s.peelLevel}`);

  // Repeated: next, next, previous, reset, next, reset.
  for (const step of ['nextPeel', 'nextPeel', 'previousPeel', 'resetPeel', 'nextPeel', 'resetPeel']) {
    await act(page, step);
  }
  s = await state(page);
  const residue = await page.evaluate(
    (ids) => ids.map((id) => window.__VEO_ENGINE__.visualState(id)),
    [OBJ_1, OBJ_2, OBJ_3, OBJ_4, OBJ_5],
  );
  check(s.peelLevel === 0, 'peel level is zero after the cycle');
  check(
    residue.every((v) => v === 'default'),
    'no visual residue after next/next/previous/reset/next/reset',
    residue.join(', '),
  );
  await semanticsIntact(page, 'after peel cycle');

  // ------------------------------------------------ 22-26. dissection ------
  console.log('\n=== 22-26. DISSECTION ===');
  check(await act(page, 'dissect', OBJ_1), 'object A is dissected');
  check(await visual(page, OBJ_1) === 'dissected', 'it stops obstructing the view');
  check(await visual(page, OBJ_5) === 'default', 'underlying context stays visible');
  check(
    (await page.evaluate((id) => window.__VEO_ENGINE__.hierarchy(id), OBJ_1)).parent === SYS_A,
    'a dissected structure is still queryable',
  );
  await semanticsIntact(page, 'dissected');

  await act(page, 'dissect', OBJ_2);
  s = await state(page);
  check(
    JSON.stringify(s.dissectedIds) === JSON.stringify([OBJ_1, OBJ_2]),
    'dissections stack in order',
    s.dissectedIds.join(', '),
  );

  const undone = await act(page, 'restoreDissection');
  check(undone === OBJ_2, 'the last dissection is undone first', `${undone}`);
  check(await visual(page, OBJ_2) === 'default', 'the restored structure renders again');

  await act(page, 'resetDissection');
  s = await state(page);
  check(s.dissectedIds.length === 0, 'every dissection is restored');
  check(await visual(page, OBJ_1) === 'default', 'the first dissection is restored too');

  // ------------------------------------------- 27-30. exploded view --------
  console.log('\n=== 27-30. EXPLODED VIEW ===');
  const restBefore = {};
  for (const id of [OBJ_1, OBJ_3, OBJ_5]) restBefore[id] = await transform(page, id);

  check(await act(page, 'explode'), 'the exploded view is entered');
  await page.waitForTimeout(250);
  s = await state(page);
  check(s.exploded, 'the controller holds the exploded state');
  check(s.transformsDisplaced > 0, 'parts are displaced', `${s.transformsDisplaced} displaced`);

  const explodedA = await transform(page, OBJ_1);
  check(
    Math.abs(explodedA.position[0] - (restBefore[OBJ_1].position[0] - 1.3)) < 1e-6,
    'a declared offset moves the part exactly as declared',
    `${restBefore[OBJ_1].position[0]} -> ${explodedA.position[0]}`,
  );

  const explodedB = await transform(page, OBJ_3);
  check(
    explodedB.position[0] > restBefore[OBJ_3].position[0] + 0.5,
    'a group-derived offset moves the part away from the centre',
    `${restBefore[OBJ_3].position[0]} -> ${explodedB.position[0]}`,
  );

  const explodedCore = await transform(page, OBJ_5);
  check(
    dist(explodedCore.position, restBefore[OBJ_5].position) < 1e-9,
    'a part with no declared displacement does not move',
    `${explodedCore.position.join(', ')}`,
  );
  await semanticsIntact(page, 'exploded');

  await act(page, 'implode');
  await page.waitForTimeout(250);
  s = await state(page);
  check(!s.exploded, 'the exploded view is left');
  check(s.transformsDisplaced === 0, 'nothing remains displaced', `${s.transformsDisplaced}`);

  for (const id of [OBJ_1, OBJ_3, OBJ_5]) {
    const now = await transform(page, id);
    check(
      now.position[0] === restBefore[id].position[0] &&
        now.position[1] === restBefore[id].position[1] &&
        now.position[2] === restBefore[id].position[2],
      `${id.split('.').pop()} returns to its authored position exactly`,
      `${now.position.join(', ')} vs ${restBefore[id].position.join(', ')}`,
    );
  }

  // Repeat the cycle: an offset added and subtracted would drift.
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await act(page, 'explode');
    await act(page, 'implode');
  }
  const afterCycles = await transform(page, OBJ_3);
  check(
    afterCycles.position[0] === restBefore[OBJ_3].position[0],
    'five explode/implode cycles leave no drift',
    `${afterCycles.position[0]} vs ${restBefore[OBJ_3].position[0]}`,
  );

  // ------------------------------------------- reconstruction --------------
  console.log('\n=== RECONSTRUCTION ===');
  await act(page, 'select', OBJ_5);
  await act(page, 'hideObject', OBJ_4);
  await act(page, 'dissect', OBJ_1);
  await act(page, 'nextPeel');

  check(await act(page, 'reconstructStep'), 'reconstruction undoes the dissection first');
  /*
   * Object 1 sits in the peeled layer, so undoing its dissection reveals the
   * peel rather than returning it to normal. That is the point: the removal
   * states are independent axes, and putting one back does not silently put
   * back another the learner did not ask about.
   */
  check(
    (await visual(page, OBJ_1)) === 'peeled',
    'undoing the dissection reveals the peel still in force beneath it',
    `${await visual(page, OBJ_1)}`,
  );

  check(await act(page, 'reconstructStep'), 'then the hidden structure');
  check(await visual(page, OBJ_4) === 'default', 'the hidden structure is back');

  check(await act(page, 'reconstructStep'), 'then the peel');
  check(await visual(page, OBJ_1) === 'default', 'and now the model is whole again');

  await act(page, 'reconstructAll');
  s = await state(page);
  check(s.peelLevel === 0 && s.dissectedIds.length === 0, 'reconstructAll makes the model whole');
  check(s.selectedId === OBJ_5, 'reconstruction keeps the learner\'s place', `${s.selectedId}`);

  // ------------------------------------------- history ---------------------
  console.log('\n=== MANIPULATION HISTORY ===');
  await act(page, 'hideObject', OBJ_3);
  await act(page, 'ghostObject', OBJ_4);
  s = await state(page);
  check(s.canUndo, 'history records semantic intents');

  await act(page, 'undo');
  check(await visual(page, OBJ_4) === 'default', 'undo reverses the last manipulation');
  check(await visual(page, OBJ_3) === 'hidden', 'and leaves the one before it');

  await act(page, 'redo');
  check(await visual(page, OBJ_4) === 'ghosted', 'redo reapplies it');

  // ------------------------------------------- 31-34. reset ----------------
  console.log('\n=== 31-34. RESET, TWICE ===');
  await act(page, 'select', OBJ_1);
  await act(page, 'hideObject', OBJ_3);
  await act(page, 'ghostObject', OBJ_4);
  await act(page, 'dissect', OBJ_2);
  await act(page, 'isolateObject', OBJ_1);
  await act(page, 'hideLayer', LAYER_FRAME);
  await act(page, 'nextPeel');
  await act(page, 'explode');
  await page.waitForTimeout(300);

  await act(page, 'resetScene');
  await page.waitForTimeout(600);
  const firstReset = await state(page);
  const firstStates = await page.evaluate(
    (ids) => ids.map((id) => window.__VEO_ENGINE__.visualState(id)),
    [OBJ_1, OBJ_2, OBJ_3, OBJ_4, OBJ_5],
  );

  check(firstStates.every((v) => v === 'default'), 'reset returns every object to normal', firstStates.join(', '));
  check(firstReset.isolatedId === null, 'isolation is cleared');
  check(firstReset.peelLevel === 0, 'peel is cleared');
  check(firstReset.dissectedIds.length === 0, 'dissection is cleared');
  check(firstReset.hiddenIds.length === 0 && firstReset.ghostedIds.length === 0, 'visibility is cleared');
  check(firstReset.hiddenLayerIds.length === 0, 'layers are cleared');
  check(!firstReset.exploded && firstReset.transformsDisplaced === 0, 'the exploded view is cleared');
  check(!firstReset.canUndo && !firstReset.canRedo, 'history is cleared, because a reset is a fresh start');

  await act(page, 'resetScene');
  await page.waitForTimeout(600);
  const secondReset = await state(page);

  const comparable = (x) => ({
    isolatedId: x.isolatedId,
    peelLevel: x.peelLevel,
    dissectedIds: x.dissectedIds,
    hiddenIds: x.hiddenIds,
    ghostedIds: x.ghostedIds,
    hiddenLayerIds: x.hiddenLayerIds,
    ghostedLayerIds: x.ghostedLayerIds,
    exploded: x.exploded,
    selectedId: x.selectedId,
    transformsDisplaced: x.transformsDisplaced,
  });
  check(
    JSON.stringify(comparable(secondReset)) === JSON.stringify(comparable(firstReset)),
    'reset is idempotent: twice is the same as once',
    JSON.stringify(comparable(secondReset)),
  );
  await semanticsIntact(page, 'after reset');

  // ------------------------------------- GPU / resource stability ----------
  console.log('\n=== GPU AND RESOURCE STABILITY ===');
  const baseline = await state(page);

  for (let cycle = 0; cycle < 6; cycle += 1) {
    await act(page, 'ghostObject', OBJ_1);
    await act(page, 'showObject', OBJ_1);
    await act(page, 'hideObject', OBJ_3);
    await act(page, 'showObject', OBJ_3);
    await act(page, 'isolateObject', OBJ_2);
    await act(page, 'restoreIsolation');
    await act(page, 'dissect', OBJ_4);
    await act(page, 'restoreDissection');
    await act(page, 'explode');
    await act(page, 'implode');
  }
  await page.waitForTimeout(400);
  const after = await state(page);

  check(
    after.memory.geometries === baseline.memory.geometries,
    'geometry count is unchanged after 60 manipulations',
    `${baseline.memory.geometries} -> ${after.memory.geometries}`,
  );
  check(
    after.materialOverrides <= baseline.registry.length,
    'override materials never exceed one per mesh',
    `${after.materialOverrides} overrides / ${after.materialTracked} meshes`,
  );
  check(
    after.transformsDisplaced === 0,
    'no node is left displaced',
    `${after.transformsDisplaced}`,
  );
  check(
    after.registry.length === baseline.registry.length,
    'no stale or duplicated scene-graph nodes',
    `${baseline.registry.length} -> ${after.registry.length}`,
  );

  const staleCaptured = await page.evaluate((id) => {
    window.__VEO_ENGINE__.captureNode(id);
    return window.__VEO_ENGINE__.resolveCaptured();
  }, OBJ_1);
  check(staleCaptured === OBJ_1, 'live object references still resolve', `${staleCaptured}`);

  await act(page, 'resetScene');
  await page.waitForTimeout(400);

  // ------------------------------------------- console ---------------------
  console.log('\n=== CONSOLE ===');
  check(errors.length === 0, 'no console errors during the whole sequence', errors.slice(0, 3).join(' | '));
}

async function runMobile(browser, width) {
  console.log(`\n=== MOBILE ${width}px ===`);
  const context = await browser.newContext({
    viewport: { width, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = captureConsole(page);

  try {
    await page.goto(EXPLORE, { waitUntil: 'networkidle' });
    await waitForEngine(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(overflow <= 0, `${width}px: no horizontal overflow`, `${overflow}px`);

    const toolbar = page.getByRole('toolbar', { name: 'Spatial tools' });
    for (const tool of ['Layers', 'Isolate', 'Dissect', 'Explode', 'Reset']) {
      const button = toolbar.getByRole('button', { name: new RegExp(tool) }).first();
      check(await button.isVisible(), `${width}px: ${tool} is reachable`);
    }

    // Layers open as a sheet over the canvas, without shrinking the viewport.
    const canvasBefore = await page.locator('canvas').first().boundingBox();
    await toolbar.getByRole('button', { name: /^Layers$/ }).click();
    await page.waitForTimeout(300);

    const sheet = page.locator('[data-layer]').first();
    check(await sheet.isVisible(), `${width}px: the layers sheet opens`);
    const sheetBox = await sheet.boundingBox();
    check(
      sheetBox !== null && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= width + 1,
      `${width}px: the layers sheet fits the viewport`,
      sheetBox ? `${sheetBox.x.toFixed(0)}..${(sheetBox.x + sheetBox.width).toFixed(0)}` : 'no box',
    );

    await page.getByRole('button', { name: 'Hide Shell' }).click();
    await page.waitForTimeout(250);
    check(
      (await page.evaluate((id) => window.__VEO_ENGINE__.layerState(id), LAYER_SHELL)) === 'hidden',
      `${width}px: hiding a layer works by touch`,
    );

    await page.getByRole('button', { name: 'Show Shell' }).click();
    await page.waitForTimeout(250);
    check(
      (await page.evaluate((id) => window.__VEO_ENGINE__.layerState(id), LAYER_SHELL)) === 'visible',
      `${width}px: restoring a layer works by touch`,
    );

    await page.getByRole('button', { name: 'Close layers' }).click();
    await page.waitForTimeout(200);

    const canvasAfter = await page.locator('canvas').first().boundingBox();
    check(
      canvasAfter !== null && Math.abs(canvasAfter.height - canvasBefore.height) < 2,
      `${width}px: the viewport is not shrunk by the sheet`,
      `${canvasBefore?.height.toFixed(0)} -> ${canvasAfter?.height.toFixed(0)}`,
    );

    /*
     * Manipulating on a narrow screen happens in the details sheet, not the
     * toolbar: selecting something opens the sheet over the viewport, which is
     * the point — the controls for the selected structure come to the thumb
     * rather than the learner reaching past the model for them.
     */
    await page.evaluate((id) => window.__VEO_ENGINE__.select(id), OBJ_1);
    await page.waitForTimeout(400);

    const sheetPanel = page.getByRole('dialog', { name: 'Structure details' });
    check(await sheetPanel.isVisible(), `${width}px: selecting opens the manipulation sheet`);

    const isolateButton = sheetPanel.getByRole('button', { name: 'Isolate' });
    check(await isolateButton.isVisible(), `${width}px: Isolate is reachable in the sheet`);
    await isolateButton.click();
    await page.waitForTimeout(500);

    check(
      (await page.evaluate(() => window.__VEO_ENGINE__.state().isolatedId)) === OBJ_1,
      `${width}px: isolate works from the sheet`,
    );

    const ghostButton = sheetPanel.getByRole('button', { name: 'Ghost' });
    await ghostButton.click();
    await page.waitForTimeout(300);
    check(
      (await page.evaluate((id) => window.__VEO_ENGINE__.state().ghostedIds.includes(id), OBJ_1)),
      `${width}px: ghost works from the sheet`,
    );

    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(300);

    await toolbar.getByRole('button', { name: /^Reset$/ }).click();
    await page.waitForTimeout(600);
    const resetState = await page.evaluate(() => window.__VEO_ENGINE__.state());
    check(
      resetState.isolatedId === null &&
        resetState.hiddenLayerIds.length === 0 &&
        resetState.ghostedIds.length === 0,
      `${width}px: reset restores the scene`,
      JSON.stringify({
        isolated: resetState.isolatedId,
        layers: resetState.hiddenLayerIds.length,
        ghosted: resetState.ghostedIds.length,
      }),
    );

    check(errors.length === 0, `${width}px: no console errors`, errors.slice(0, 2).join(' | '));
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = captureConsole(page);

  await runDesktop(page, errors);
  await context.close();

  for (const width of [360, 390, 430]) {
    await runMobile(browser, width);
  }
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`GATE 7 MANIPULATION VERIFICATION: ${results.pass} passed, ${results.fail} failed`);
if (results.problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of results.problems) console.log(`  - ${problem}`);
}
console.log('='.repeat(60));

process.exit(results.fail === 0 ? 0 : 1);
