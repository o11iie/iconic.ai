/**
 * Gate 6 verification: semantic object interaction in a real browser.
 *
 * Gate 5 proved the engine renders, frames and disposes. This proves the layer
 * above it: that what a learner touches resolves to a SEMANTIC OBJECT, that
 * the object drives the interface, and that an object reference can never
 * outlive the model it came from.
 *
 * Every assertion reads engine state through the diagnostic bridge or real
 * DOM, never a mock. Screen positions for each object are discovered by
 * probing the canvas and asking the engine what is under the pointer, so
 * nothing here depends on hard-coded geometry.
 *
 * Requires NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true on the server.
 *
 * Usage: node scripts/verify-semantics.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? process.env.VEO_BASE_URL ?? 'http://127.0.0.1:3410';
const EXPLORE = `${BASE}/explore?diagnostic=1`;

const IGNORED = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /favicon\.ico/i];

const ROOT_ID = 'veo.diagnostic.test_scene';
const SYSTEM_A = 'veo.diagnostic.test_scene.system_a';
const OBJECT_1 = 'veo.diagnostic.test_scene.system_a.object_1';
/** A well-formed id from a model that is not loaded. Must never be trusted. */
const FOREIGN_ID = 'veo.anatomy.heart.left_ventricle';

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

async function waitForEngine(page, timeout = 25000) {
  await page.waitForFunction(
    () => {
      const s = window.__VEO_ENGINE__?.state();
      return Boolean(s && s.ready && s.registry.length > 0);
    },
    { timeout },
  );
}

async function canvasBox(page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Screen point for every hoverable object, found by asking the engine.
 *
 * Sweeping the canvas and reading `hoveredId` keeps this independent of
 * viewport size, camera framing and the diagnostic scene's layout.
 */
async function probeObjectPoints(page, box, steps = 13) {
  const found = new Map();
  for (let ix = 1; ix < steps; ix += 1) {
    for (let iy = 1; iy < steps; iy += 1) {
      const x = box.x + (box.width * ix) / steps;
      const y = box.y + (box.height * iy) / steps;
      await page.mouse.move(x, y);
      const hovered = await page.evaluate(() => window.__VEO_ENGINE__?.state().hoveredId ?? null);
      if (hovered && !found.has(hovered)) found.set(hovered, { x, y });
    }
  }
  await page.mouse.move(2, 2);
  return found;
}

async function runDesktop(page, errors) {
  // ------------------------------------------------ 1-2. open + diagnostic --
  console.log('\n=== 1-2. WORKSPACE OPENS WITH THE DIAGNOSTIC MODEL ===');
  const response = await page.goto(EXPLORE, { waitUntil: 'networkidle' });
  check(response?.status() === 200, 'workspace opens', `status ${response?.status()}`);

  await waitForEngine(page);
  const booted = await state(page);
  check(booted.ready, 'engine reports ready');

  const labelVisible = await page
    .getByText('VEO SPATIAL ENGINE TEST', { exact: false })
    .first()
    .isVisible();
  check(labelVisible, 'diagnostic content is labelled as such in the interface');

  // ------------------------------------------------- 3. the semantic model --
  console.log('\n=== 3. SEMANTIC MODEL ===');
  check(
    booted.registry.length === 5,
    'five objects are backed by live geometry',
    `${booted.registry.length}`,
  );

  const rootHierarchy = await page.evaluate((id) => window.__VEO_ENGINE__.hierarchy(id), ROOT_ID);
  check(
    rootHierarchy.children.length === 3,
    'the model root declares its three systems',
    JSON.stringify(rootHierarchy.children),
  );

  const leafHierarchy = await page.evaluate((id) => window.__VEO_ENGINE__.hierarchy(id), OBJECT_1);
  check(leafHierarchy.parent === SYSTEM_A, 'a leaf knows its parent system', `${leafHierarchy.parent}`);
  check(
    JSON.stringify(leafHierarchy.ancestors) === JSON.stringify([SYSTEM_A, ROOT_ID]),
    'ancestors run nearest-first to the model root',
    JSON.stringify(leafHierarchy.ancestors),
  );

  // ------------------------------------------------------ 4-6. hover state --
  console.log('\n=== 4-6. HOVER RESOLVES, AND CLEARS ===');
  const box = await canvasBox(page);
  const points = await probeObjectPoints(page, box);
  check(points.size >= 2, `pointer probing located ${points.size} distinct objects`);

  const [idA, idB] = [...points.keys()];
  const pointA = points.get(idA);
  const pointB = points.get(idB);

  await page.mouse.move(pointA.x, pointA.y);
  await page.waitForTimeout(120);
  let s = await state(page);
  check(s.hoveredId === idA, 'hovering an object resolves it to its semantic id', `${s.hoveredId}`);
  check(s.visualStates[idA] === 'hovered', 'hover produces a hovered visual state', s.visualStates[idA]);

  await page.mouse.move(pointB.x, pointB.y);
  await page.waitForTimeout(120);
  s = await state(page);
  check(s.hoveredId === idB, 'moving to a second object transfers hover', `${s.hoveredId}`);
  check(
    s.visualStates[idA] === undefined || s.visualStates[idA] === 'default',
    "the first object's hover state clears",
    `${idA} = ${s.visualStates[idA]}`,
  );
  check(
    Object.values(s.visualStates).filter((v) => v === 'hovered').length === 1,
    'exactly one object is hovered at a time',
  );

  await page.mouse.move(2, 2);
  await page.waitForTimeout(150);
  s = await state(page);
  check(s.hoveredId === null, 'hover clears when the pointer leaves the model');

  // ------------------------------------------------- 7. restrained hover ----
  console.log('\n=== 7. HOVER DOES NOT CHURN STATE ===');
  await page.mouse.move(pointA.x, pointA.y);
  await page.waitForTimeout(120);
  const revisionBefore = (await state(page)).revision;

  // Eight moves within the same object. Hover already resolved to it, so the
  // controller must publish nothing further.
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.move(pointA.x + (i % 3) - 1, pointA.y + ((i + 1) % 3) - 1);
  }
  await page.waitForTimeout(150);
  const revisionAfter = (await state(page)).revision;
  check(
    revisionAfter === revisionBefore,
    'pointer movement inside one object publishes no new state',
    `revision ${revisionBefore} -> ${revisionAfter}`,
  );

  // ------------------------------------------------ 8-10. selection + panel --
  console.log('\n=== 8-10. SELECTION DRIVES THE INTERFACE ===');
  await page.mouse.move(pointB.x, pointB.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  s = await state(page);

  check(s.selectedId === idB, 'clicking an object selects it', `${s.selectedId}`);
  check(s.visualStates[idB] === 'selected', 'selection produces a selected visual state');
  check(
    Object.values(s.visualStates).filter((v) => v === 'selected').length === 1,
    'exactly one object is selected at a time',
  );

  const panel = page.locator('aside[aria-label="Structure details"]');
  const panelText = await panel.innerText();

  // The descriptor's name, taken from the engine rather than assumed.
  const descriptorName = await page.evaluate((id) => {
    const hit = window.__VEO_ENGINE__.search(id);
    return hit.length > 0 ? id : null;
  }, idB);

  check(panelText.includes(idB), 'the panel shows the semantic id of the selection');
  check(descriptorName === idB, 'the selected object is reachable by its own id through search');
  check(
    /Object \d/.test(panelText),
    'the panel names the object from its descriptor, not its mesh name',
    panelText.split('\n').slice(0, 4).join(' / '),
  );
  /*
   * `region` appears nowhere in the semantic id, so matching it proves the
   * panel is rendering the model's descriptor rather than prettifying the id.
   */
  check(
    /quadrant_(west|north|east|south)/.test(panelText),
    'the panel reports a fact that exists only in the descriptor',
    panelText.replace(/\n/g, ' / ').slice(0, 140),
  );
  check(
    /\bstructure\b/.test(panelText),
    'the panel reports the object kind from the descriptor',
  );

  const breadcrumb = panel.locator('nav[aria-label="Structure hierarchy"]');
  check(await breadcrumb.isVisible(), 'the panel shows a hierarchy breadcrumb for the selection');
  const crumbLabels = await breadcrumb.locator('button, span').allInnerTexts();
  check(
    crumbLabels.some((t) => /System [AB]/.test(t)),
    'the breadcrumb names the ancestor system',
    crumbLabels.join(' > '),
  );

  // ------------------------------------------- 11. breadcrumb navigation ----
  console.log('\n=== 11. NAVIGATING THE HIERARCHY ===');
  const systemCrumb = breadcrumb.getByRole('button').filter({ hasText: /System [AB]/ }).first();
  await systemCrumb.click();
  await page.waitForTimeout(250);
  s = await state(page);
  check(
    s.selectedId !== null && /\.system_[ab]$/.test(s.selectedId),
    'selecting an ancestor from the breadcrumb selects the grouping structure',
    `${s.selectedId}`,
  );

  const groupPanelText = await panel.innerText();
  check(
    /System [AB]/.test(groupPanelText),
    'a grouping structure with no geometry of its own still has a context panel',
    groupPanelText.split('\n').slice(0, 3).join(' / '),
  );
  check(
    /Object \d/.test(groupPanelText),
    'the grouping structure lists what it contains',
  );

  // ------------------------------------------------- 12. child wins ---------
  console.log('\n=== 12. THE CHILD WINS OVER ITS PARENT GROUP ===');
  const parentOfA = (await page.evaluate((id) => window.__VEO_ENGINE__.hierarchy(id), idA)).parent;
  check(parentOfA !== null, 'the clicked object sits inside a selectable group', `${parentOfA}`);
  check(
    await page.evaluate((id) => window.__VEO_ENGINE__.focusObject(id), parentOfA),
    'the parent group is itself selectable, so it could legitimately win a click',
  );

  /*
   * Selecting from the breadcrumb also frames the camera, so the earlier probe
   * points no longer correspond to the same objects. Probe again against the
   * current view rather than assuming the scene stood still.
   */
  await page.waitForTimeout(700);
  const reprobed = await probeObjectPoints(page, await canvasBox(page));
  const childEntry = [...reprobed.entries()].find(([id]) => id.startsWith(`${parentOfA}.`));
  check(childEntry !== undefined, 'a child of the selected group is visible on screen');

  const [childId, childPoint] = childEntry;
  await page.mouse.move(childPoint.x, childPoint.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  s = await state(page);
  check(
    s.selectedId === childId,
    'a click resolves to the nearest selectable object, not the group above it',
    `${s.selectedId} (group ${parentOfA} was selected before the click)`,
  );

  // ------------------------------------------------ 13-14. camera targeting -
  console.log('\n=== 13-14. CAMERA TARGETING ===');
  const beforeFocus = (await state(page)).camera;
  await page.evaluate((id) => window.__VEO_ENGINE__.focusObject(id), idA);
  await page.waitForTimeout(600);
  const afterFocus = (await state(page)).camera;
  check(
    dist(beforeFocus.position, afterFocus.position) > 0.05 ||
      Math.abs(beforeFocus.distance - afterFocus.distance) > 0.05,
    'focusing an object moves the camera',
    `distance ${beforeFocus.distance.toFixed(2)} -> ${afterFocus.distance.toFixed(2)}`,
  );

  const objectCentre = await page.evaluate((id) => window.__VEO_ENGINE__.bounds(id), idA);
  check(objectCentre !== null, 'the semantic bounds API reports live geometry');
  check(
    dist(afterFocus.target, objectCentre.center) < 0.35,
    'the camera targets the object centre reported by the bounds API',
    `target ${afterFocus.target.map((v) => v.toFixed(2))} vs centre ${objectCentre.center.map((v) => v.toFixed(2))}`,
  );

  // A grouping structure is framed by what it contains.
  const groupBounds = await page.evaluate((id) => window.__VEO_ENGINE__.bounds(id), SYSTEM_A);
  check(
    groupBounds !== null && groupBounds.radius > objectCentre.radius,
    'a grouping structure is framed by the extent of its children',
    JSON.stringify(groupBounds),
  );

  await page.evaluate(() => window.__VEO_ENGINE__.resetCamera());
  await page.waitForTimeout(600);
  const afterReset = (await state(page)).camera;
  check(
    dist(afterReset.position, afterFocus.position) > 0.05,
    'resetting the camera moves it back out',
    `distance ${afterFocus.distance.toFixed(2)} -> ${afterReset.distance.toFixed(2)}`,
  );

  // ------------------------------------------------------- 15-16. search ----
  console.log('\n=== 15-16. SPATIAL SEARCH ===');
  const search = page.getByRole('combobox', { name: 'Search structures' });
  await search.fill('Object 1');
  await page.waitForTimeout(200);
  const options = page.getByRole('option');
  const optionCount = await options.count();
  check(optionCount > 0, 'searching returns results', `${optionCount} results`);
  const firstOptionText = await options.first().innerText();
  check(
    firstOptionText.includes('veo.diagnostic.'),
    'a result carries its semantic id, not a mesh name',
    firstOptionText.replace(/\n/g, ' / '),
  );

  await options.first().click();
  await page.waitForTimeout(400);
  s = await state(page);
  check(s.selectedId === OBJECT_1, 'choosing a search result selects that object', `${s.selectedId}`);

  // A structure with no geometry of its own must still be findable.
  await search.fill('System A');
  await page.waitForTimeout(200);
  const groupOptions = await page.getByRole('option').allInnerTexts();
  check(
    groupOptions.some((t) => t.includes(SYSTEM_A)),
    'a grouping structure is findable by name',
    groupOptions.join(' | ').slice(0, 120),
  );
  await search.fill('');
  await page.keyboard.press('Escape');

  // ---------------------------------------------------- 17. keyboard --------
  console.log('\n=== 17. KEYBOARD ===');
  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), OBJECT_1);
  await page.waitForTimeout(150);

  await search.focus();
  await search.fill('rr');
  await page.waitForTimeout(150);
  s = await state(page);
  check(
    s.selectedId === OBJECT_1 && (await search.inputValue()) === 'rr',
    'typing in a text field is never treated as a shortcut',
    `value "${await search.inputValue()}", selection ${s.selectedId}`,
  );
  await search.fill('');
  await page.keyboard.press('Escape');

  await page.locator('canvas').first().click({ position: { x: 4, y: 4 } });
  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), OBJECT_1);
  await page.waitForTimeout(150);
  await page.locator('body').press('Escape');
  await page.waitForTimeout(200);
  s = await state(page);
  check(s.selectedId === null, 'Escape clears the selection', `${s.selectedId}`);

  await page.evaluate((id) => window.__VEO_ENGINE__.focusObject(id), OBJECT_1);
  await page.waitForTimeout(500);
  const beforeKeyReset = (await state(page)).camera;
  await page.locator('body').press('r');
  await page.waitForTimeout(600);
  const afterKeyReset = (await state(page)).camera;
  check(
    dist(beforeKeyReset.position, afterKeyReset.position) > 0.05,
    'R resets the camera',
    `${beforeKeyReset.distance.toFixed(2)} -> ${afterKeyReset.distance.toFixed(2)}`,
  );

  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), OBJECT_1);
  await page.waitForTimeout(150);
  const beforeKeyFit = (await state(page)).camera;
  await page.locator('body').press('f');
  await page.waitForTimeout(600);
  const afterKeyFit = (await state(page)).camera;
  check(
    dist(beforeKeyFit.position, afterKeyFit.position) > 0.05 ||
      Math.abs(beforeKeyFit.distance - afterKeyFit.distance) > 0.05,
    'F frames the selection',
    `${beforeKeyFit.distance.toFixed(2)} -> ${afterKeyFit.distance.toFixed(2)}`,
  );

  // ------------------------------------------- 18. material integrity -------
  console.log('\n=== 18. MATERIAL INTEGRITY ===');
  await page.evaluate(() => window.__VEO_ENGINE__.select(null));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(250);
  const cleared = await state(page);

  check(
    Object.values(cleared.visualStates).every((v) => v === 'default'),
    'clearing selection leaves no visual residue',
    JSON.stringify(cleared.visualStates),
  );

  /*
   * The engine allocates at most ONE override material per mesh and reuses it,
   * swapping the authored material back by reference when a mesh returns to
   * default. So the count to hold is one per touched mesh, never a count that
   * climbs with interaction. Freeing and rebuilding a material on every hover
   * would be the wrong fix and would churn GPU resources.
   */
  check(
    cleared.materialOverrides <= cleared.materialTracked,
    'never more than one override material per tracked mesh',
    `${cleared.materialOverrides} overrides / ${cleared.materialTracked} meshes`,
  );
  check(
    cleared.materialTracked <= booted.registry.length,
    'no mesh outside the model is being tracked',
    `${cleared.materialTracked} tracked / ${booted.registry.length} objects`,
  );

  const baselineOverrides = cleared.materialOverrides;
  for (let round = 0; round < 3; round += 1) {
    for (const id of booted.registry) {
      await page.evaluate((x) => window.__VEO_ENGINE__.select(x), id);
    }
  }
  await page.evaluate(() => window.__VEO_ENGINE__.select(null));
  await page.waitForTimeout(300);
  const churned = await state(page);

  check(
    churned.materialOverrides <= Math.max(baselineOverrides, booted.registry.length),
    'repeated selection never accumulates override materials',
    `${baselineOverrides} -> ${churned.materialOverrides} after 12 selections`,
  );
  check(
    Object.values(churned.visualStates).every((v) => v === 'default'),
    'repeated selection leaves no highlight behind',
    JSON.stringify(churned.visualStates),
  );

  // ---------------------------------------- 19. selection integrity ---------
  console.log('\n=== 19. SELECTION INTEGRITY ===');
  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), OBJECT_1);
  await page.waitForTimeout(150);
  await page.evaluate((id) => window.__VEO_ENGINE__.hide([id]), OBJECT_1);
  await page.waitForTimeout(250);
  s = await state(page);
  check(
    s.selectedId === null,
    'hiding the selected object invalidates the selection',
    `${s.selectedId}`,
  );
  check(s.visualStates[OBJECT_1] === 'hidden', 'the object is hidden', s.visualStates[OBJECT_1]);

  const emptyPanel = await panel.innerText();
  check(
    /Select a structure/i.test(emptyPanel),
    'the panel returns to its empty state rather than describing a gone object',
    emptyPanel.split('\n')[0],
  );

  await page.evaluate(() => window.__VEO_ENGINE__.resetCamera());
  await page.waitForTimeout(250);

  // ------------------------------------------ 20. untrusted ids -------------
  console.log('\n=== 20. UNTRUSTED IDENTIFIERS ===');
  const foreignAccepted = await page.evaluate(
    (id) => window.__VEO_ENGINE__.focusObject(id),
    FOREIGN_ID,
  );
  check(foreignAccepted === false, 'a well-formed id from another model is refused');
  s = await state(page);
  check(s.selectedId === null, 'a refused id leaves the selection untouched', `${s.selectedId}`);

  const deepLinkForeign = await page.goto(`${BASE}/explore?diagnostic=1&select=${FOREIGN_ID}`, {
    waitUntil: 'networkidle',
  });
  await waitForEngine(page);
  await page.waitForTimeout(500);
  s = await state(page);
  check(
    deepLinkForeign?.status() === 200 && s.selectedId === null,
    'a URL cannot select an object the loaded model does not contain',
    `${s.selectedId}`,
  );

  const deepLinkValid = await page.goto(`${BASE}/explore?diagnostic=1&select=${OBJECT_1}`, {
    waitUntil: 'networkidle',
  });
  await waitForEngine(page);
  await page.waitForTimeout(700);
  s = await state(page);
  check(
    deepLinkValid?.status() === 200 && s.selectedId === OBJECT_1,
    'a URL naming an object in the loaded model does select it',
    `${s.selectedId}`,
  );

  const malformed = await page.goto(`${BASE}/explore?diagnostic=1&select=not-a-semantic-id`, {
    waitUntil: 'networkidle',
  });
  await waitForEngine(page);
  await page.waitForTimeout(400);
  s = await state(page);
  check(
    malformed?.status() === 200 && s.selectedId === null,
    'a malformed id in the URL is ignored without error',
    `${s.selectedId}`,
  );

  // ------------------------------------ 21. stale references ----------------
  console.log('\n=== 21. A STALE OBJECT CAN NEVER RESOLVE ===');
  await page.evaluate((id) => window.__VEO_ENGINE__.select(id), OBJECT_1);
  await page.waitForTimeout(200);

  const captured = await page.evaluate((id) => window.__VEO_ENGINE__.captureNode(id), OBJECT_1);
  check(captured, 'a live render node was captured from the current model');

  const resolvedBefore = await page.evaluate(() => window.__VEO_ENGINE__.resolveCaptured());
  check(
    resolvedBefore === OBJECT_1,
    'while the model is current, that node resolves to its object',
    `${resolvedBefore}`,
  );

  const generationBefore = (await state(page)).generation;
  await page.evaluate(() => window.__VEO_ENGINE__.replaceScene());
  await page.waitForTimeout(700);
  await waitForEngine(page);
  const afterReplace = await state(page);

  check(
    afterReplace.generation > generationBefore,
    'replacing the model advances the registry generation',
    `${generationBefore} -> ${afterReplace.generation}`,
  );

  const resolvedAfter = await page.evaluate(() => window.__VEO_ENGINE__.resolveCaptured());
  check(
    resolvedAfter === null,
    'a node held across the replacement resolves to NOTHING',
    `resolved to ${resolvedAfter}`,
  );

  check(
    afterReplace.registry.length === booted.registry.length,
    'the rebuilt model holds no stale entries',
    `${afterReplace.registry.length}`,
  );
  check(
    afterReplace.selectedId === null || afterReplace.registry.includes(afterReplace.selectedId),
    'any surviving selection names an object in the rebuilt model',
    `${afterReplace.selectedId}`,
  );

  // ------------------------------------------------ 22. console -------------
  console.log('\n=== 22. CONSOLE ===');
  check(errors.length === 0, 'no console errors during the whole sequence', errors.slice(0, 3).join(' | '));

  return { points, idA, idB };
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

    const box = await canvasBox(page);
    const points = await probeObjectPoints(page, box, 9);
    check(points.size > 0, `${width}px: objects are reachable by pointer`, `${points.size} found`);

    if (points.size > 0) {
      const [id] = [...points.keys()];
      const point = points.get(id);
      // Touch, through the same raycast and resolution pipeline as desktop.
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(350);
      const s = await state(page);
      check(s.selectedId === id, `${width}px: tapping selects the same semantic object`, `${s.selectedId}`);

      // The panel is a drawer below xl, opened from the workspace bar.
      const detailsButton = page.getByRole('button', { name: /details/i }).first();
      if (await detailsButton.isVisible()) {
        await detailsButton.click();
        await page.waitForTimeout(400);
      }
      const drawerText = await page.getByRole('dialog').innerText();
      check(
        drawerText.includes(id),
        `${width}px: the details drawer reports the selected semantic id`,
        drawerText.split('\n').slice(0, 3).join(' / '),
      );
    }

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
console.log(`GATE 6 SEMANTIC VERIFICATION: ${results.pass} passed, ${results.fail} failed`);
if (results.problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of results.problems) console.log(`  - ${problem}`);
}
console.log('='.repeat(60));

process.exit(results.fail === 0 ? 0 : 1);
