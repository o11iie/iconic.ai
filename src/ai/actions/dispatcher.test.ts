import { describe, expect, it } from 'vitest';
import { SceneController } from '@/engine/spatial/scene-controller';
import type { SceneNode } from '@/engine/spatial/object-registry';
import type { SemanticId } from '@/lib/semantic-id';
import {
  buildTutorFixtureGraph,
  TUTOR_FIXTURE_IDS,
  TUTOR_FIXTURE_LAYERS,
} from '../fixtures/tutor-fixture';
import type { ValidatedSpatialAction } from '../tutor/tutor-types';
import { canDispatch, dispatchSpatialAction } from './dispatcher';

/**
 * The seam between the tutor and the scene.
 *
 * Tested against a REAL SceneController, not a mock. A mock would prove that
 * the dispatcher calls methods with the right names; only the real controller
 * proves the scene actually ends up in the state the learner was promised —
 * and that an action it refuses is refused rather than silently dropped.
 */

function node(name: string, isMesh = false): SceneNode {
  return { name, parent: null, children: [], userData: {}, isMesh };
}

/** A controller carrying the fixture graph with every structure registered. */
function loadedController(): SceneController {
  const controller = new SceneController();
  const graph = buildTutorFixtureGraph();
  controller.setGraph(graph);

  const root = node('Root');
  controller.registry.register(TUTOR_FIXTURE_IDS.root, root);

  for (const id of graph.objects.keys()) {
    if (id === TUTOR_FIXTURE_IDS.root) continue;
    const child = node(id, true);
    (root.children as SceneNode[]).push(child);
    child.parent = root;
    controller.registry.register(id, child);
  }

  return controller;
}

function action(overrides: Partial<ValidatedSpatialAction>): ValidatedSpatialAction {
  return {
    kind: 'SELECT_STRUCTURE',
    semanticId: null,
    layerId: null,
    label: 'Do it',
    ...overrides,
  };
}

describe('performing an action', () => {
  it('selects a structure through the controller', () => {
    const controller = loadedController();

    const result = dispatchSpatialAction(
      controller,
      action({ kind: 'SELECT_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit }),
    );

    expect(result.ok).toBe(true);
    // Assert the SCENE changed, not that a method was called.
    expect(controller.getSelectedObject()?.semanticId).toBe(TUTOR_FIXTURE_IDS.coreUnit);
  });

  it('selects as well as flies when focusing', () => {
    // Focusing without selecting would leave the context panel describing a
    // structure the camera has left behind.
    const controller = loadedController();

    dispatchSpatialAction(
      controller,
      action({ kind: 'FOCUS_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.outerShell }),
    );

    expect(controller.getSelectedObject()?.semanticId).toBe(TUTOR_FIXTURE_IDS.outerShell);
    expect(controller.getSnapshot().camera?.targetId).toBe(TUTOR_FIXTURE_IDS.outerShell);
  });

  it('isolates a structure', () => {
    const controller = loadedController();

    const result = dispatchSpatialAction(
      controller,
      action({ kind: 'ISOLATE_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit }),
    );

    expect(result.ok).toBe(true);
    expect(controller.getIsolatedId()).toBe(TUTOR_FIXTURE_IDS.coreUnit);
  });

  it('hides and shows a layer', () => {
    const controller = loadedController();

    dispatchSpatialAction(
      controller,
      action({ kind: 'HIDE_LAYER', layerId: TUTOR_FIXTURE_LAYERS.shell }),
    );
    expect(controller.isLayerVisible(TUTOR_FIXTURE_LAYERS.shell)).toBe(false);

    dispatchSpatialAction(
      controller,
      action({ kind: 'SHOW_LAYER', layerId: TUTOR_FIXTURE_LAYERS.shell }),
    );
    expect(controller.isLayerVisible(TUTOR_FIXTURE_LAYERS.shell)).toBe(true);
  });

  it('resets the scene', () => {
    const controller = loadedController();
    controller.isolateObject(TUTOR_FIXTURE_IDS.coreUnit);
    expect(controller.getIsolatedId()).not.toBeNull();

    const result = dispatchSpatialAction(controller, action({ kind: 'RESET_VIEW' }));

    expect(result.ok).toBe(true);
    expect(controller.getIsolatedId()).toBeNull();
  });
});

describe('refusing an action', () => {
  it('refuses when no model is open', () => {
    const result = dispatchSpatialAction(
      null,
      action({ kind: 'SELECT_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_controller');
  });

  it('refuses a structure the live registry does not hold', () => {
    // The second check that matters: the server validated against the graph as
    // it was when the answer was generated. This validates against the scene
    // as it is NOW, which is what a learner switching models changes.
    const controller = loadedController();

    const result = dispatchSpatialAction(
      controller,
      action({ kind: 'SELECT_STRUCTURE', semanticId: 'veo.anatomy.heart' as SemanticId }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown_structure');
    expect(controller.getSelectedObject()).toBeNull();
  });

  it('refuses a layer the model does not have', () => {
    const controller = loadedController();

    const result = dispatchSpatialAction(
      controller,
      action({ kind: 'SHOW_LAYER', layerId: 'invented_layer' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown_layer');
  });

  it('refuses a layer action with no layer named', () => {
    const controller = loadedController();

    const result = dispatchSpatialAction(controller, action({ kind: 'HIDE_LAYER' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing_target');
  });

  it('refuses an action the model does not support', () => {
    const controller = new SceneController();
    // No graph: nothing is selectable, so capability is genuinely absent.
    const result = dispatchSpatialAction(
      controller,
      action({ kind: 'ISOLATE_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['unsupported_capability', 'unknown_structure']).toContain(result.reason);
  });

  it('carries a message safe to show a learner', () => {
    const result = dispatchSpatialAction(null, action({ kind: 'RESET_VIEW' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).toBe('No model is open.');
    expect(result.message).not.toContain('undefined');
    expect(result.message).not.toContain('Error');
  });
});

describe('predicting availability', () => {
  it('agrees with the dispatcher on what will work', () => {
    const controller = loadedController();
    const good = action({ kind: 'SELECT_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit });
    const bad = action({ kind: 'SELECT_STRUCTURE', semanticId: 'veo.anatomy.heart' as SemanticId });

    expect(canDispatch(controller, good)).toBe(true);
    expect(canDispatch(controller, bad)).toBe(false);

    // The prediction must match the outcome, or the UI enables a dead button.
    expect(dispatchSpatialAction(controller, good).ok).toBe(true);
    expect(dispatchSpatialAction(controller, bad).ok).toBe(false);
  });

  it('reports false with no controller', () => {
    expect(canDispatch(null, action({ kind: 'RESET_VIEW' }))).toBe(false);
  });

  it('predicts layer availability correctly', () => {
    const controller = loadedController();

    expect(
      canDispatch(controller, action({ kind: 'SHOW_LAYER', layerId: TUTOR_FIXTURE_LAYERS.core })),
    ).toBe(true);
    expect(canDispatch(controller, action({ kind: 'SHOW_LAYER', layerId: 'nope' }))).toBe(false);
  });
});

describe('the controller remains the only authority', () => {
  it('leaves undo working after a tutor-driven action', () => {
    // If the tutor mutated scene state directly, the manipulation history
    // would not know it happened and undo would restore the wrong state.
    const controller = loadedController();

    dispatchSpatialAction(
      controller,
      action({ kind: 'ISOLATE_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit }),
    );
    expect(controller.getIsolatedId()).toBe(TUTOR_FIXTURE_IDS.coreUnit);
    expect(controller.canUndo()).toBe(true);

    controller.undoManipulation();
    expect(controller.getIsolatedId()).toBeNull();
  });

  it('notifies subscribers, so every surface updates together', () => {
    const controller = loadedController();
    let notified = 0;
    const unsubscribe = controller.subscribe(() => {
      notified += 1;
    });

    dispatchSpatialAction(
      controller,
      action({ kind: 'SELECT_STRUCTURE', semanticId: TUTOR_FIXTURE_IDS.coreUnit }),
    );

    expect(notified).toBeGreaterThan(0);
    unsubscribe();
  });
});
