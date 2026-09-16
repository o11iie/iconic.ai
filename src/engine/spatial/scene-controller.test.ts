import { describe, expect, it, vi } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import { SceneController } from './scene-controller';

const heart = 'veo.anatomy.heart' as SemanticId;
const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
const rv = 'veo.anatomy.heart.right_ventricle' as SemanticId;
const lung = 'veo.anatomy.lung' as SemanticId;

function controllerWithObjects() {
  const controller = new SceneController();
  controller.setObjects([heart, lv, rv, lung]);
  return controller;
}

describe('selection', () => {
  it('tracks selection and hover independently', () => {
    const controller = controllerWithObjects();

    controller.select(lv);
    controller.setHovered(rv);

    const snapshot = controller.getSnapshot();
    expect(snapshot.selectedId).toBe(lv);
    expect(snapshot.hoveredId).toBe(rv);
    expect(snapshot.visual.states.get(lv)).toBe('selected');
    expect(snapshot.visual.states.get(rv)).toBe('hovered');
  });

  it('clears selection when passed null', () => {
    const controller = controllerWithObjects();
    controller.select(lv);
    controller.select(null);

    expect(controller.getSnapshot().selectedId).toBeNull();
    expect(controller.getSnapshot().visual.states.get(lv)).toBe('default');
  });

  it('does not notify when selecting what is already selected', () => {
    const controller = controllerWithObjects();
    controller.select(lv);

    const listener = vi.fn();
    controller.subscribe(listener);
    controller.select(lv);

    // Re-selecting must not churn: under an on-demand frame loop every
    // notification costs a render.
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('snapshot stability', () => {
  it('returns the same object until something changes', () => {
    const controller = controllerWithObjects();
    const first = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(first);

    controller.select(lv);
    expect(controller.getSnapshot()).not.toBe(first);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const controller = controllerWithObjects();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.select(lv);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    controller.select(rv);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('visibility', () => {
  it('hides and shows objects', () => {
    const controller = controllerWithObjects();

    controller.hide([lung]);
    expect(controller.getSnapshot().visual.states.get(lung)).toBe('hidden');

    controller.show([lung]);
    expect(controller.getSnapshot().visual.states.get(lung)).toBe('default');
  });

  it('treats hide and ghost as mutually exclusive', () => {
    const controller = controllerWithObjects();

    controller.ghost([lung]);
    expect(controller.getSnapshot().visual.states.get(lung)).toBe('ghosted');

    controller.hide([lung]);
    expect(controller.getSnapshot().visual.states.get(lung)).toBe('hidden');

    controller.ghost([lung]);
    expect(controller.getSnapshot().visual.states.get(lung)).toBe('ghosted');
  });

  it('toggles layer visibility', () => {
    const controller = new SceneController();
    controller.setObjects([lv], new Map([[lv, ['muscle']]]));

    expect(controller.isLayerVisible('muscle')).toBe(true);

    controller.setLayerVisible('muscle', false);
    expect(controller.isLayerVisible('muscle')).toBe(false);
    expect(controller.getSnapshot().visual.states.get(lv)).toBe('hidden');
  });
});

describe('isolation', () => {
  it('ghosts context rather than deleting it', () => {
    const controller = controllerWithObjects();
    controller.isolate(heart);

    const states = controller.getSnapshot().visual.states;
    expect(states.get(heart)).toBe('default');
    expect(states.get(lv)).toBe('default');
    expect(states.get(lung)).toBe('ghosted');
  });

  it('hides context when ghosting is disabled', () => {
    const controller = new SceneController({ ghostContextOnIsolate: false });
    controller.setObjects([heart, lv, lung]);
    controller.isolate(heart);

    expect(controller.getSnapshot().visual.states.get(lung)).toBe('hidden');
  });

  it('restore clears every emphasis at once', () => {
    const controller = controllerWithObjects();
    controller.select(lv);
    controller.isolate(lv);
    controller.setLayerVisible('muscle', false);

    controller.restore();

    const snapshot = controller.getSnapshot();
    expect(snapshot.selectedId).toBeNull();
    expect(snapshot.visual.isolatedId).toBeNull();
    expect(snapshot.visual.states.get(lung)).toBe('default');
    expect(controller.isLayerVisible('muscle')).toBe(true);
  });

  it('lists descendants of a structure', () => {
    const controller = controllerWithObjects();
    expect(controller.descendantsOf(heart).sort()).toEqual([lv, rv].sort());
  });
});

describe('model replacement', () => {
  it('drops emphasis pointing at objects that no longer exist', () => {
    // Without this, switching models leaves a selection referring to geometry
    // that has been disposed.
    const controller = controllerWithObjects();
    controller.select(lv);
    controller.ghost([lung]);
    controller.isolate(heart);

    controller.setObjects(['veo.anatomy.skull' as SemanticId]);

    const snapshot = controller.getSnapshot();
    expect(snapshot.selectedId).toBeNull();
    expect(snapshot.visual.isolatedId).toBeNull();
    expect(snapshot.visual.states.has(lung)).toBe(false);
  });

  it('keeps emphasis that is still valid', () => {
    const controller = controllerWithObjects();
    controller.select(lv);

    controller.setObjects([heart, lv]);

    expect(controller.getSnapshot().selectedId).toBe(lv);
  });

  it('clears the registry and emphasis when a new load starts', () => {
    const controller = controllerWithObjects();
    controller.select(lv);
    controller.registry.register(lv, { name: 'LV', parent: null, children: [], userData: {} });

    controller.dispatchLifecycle({ type: 'load', modelRef: 'skull' });

    expect(controller.getSnapshot().selectedId).toBeNull();
    expect(controller.registry.size).toBe(0);
    expect(controller.getObjectIds()).toEqual([]);
  });
});

describe('camera intents', () => {
  it('issues each intent with an incrementing version', () => {
    const controller = controllerWithObjects();

    controller.resetCamera();
    const first = controller.getCameraCommand();
    expect(first?.kind).toBe('reset');

    controller.fitToModel();
    const second = controller.getCameraCommand();
    expect(second?.kind).toBe('fit_model');
    expect(second?.version).toBeGreaterThan(first?.version ?? 0);

    controller.flyTo(lv, { durationMs: 0 });
    const third = controller.getCameraCommand();
    expect(third?.kind).toBe('fly_to');
    expect(third?.targetId).toBe(lv);
    expect(third?.options.durationMs).toBe(0);
  });

  it('targets the current selection when fitting to it', () => {
    const controller = controllerWithObjects();
    controller.select(rv);
    controller.fitToSelection();

    expect(controller.getCameraCommand()?.targetId).toBe(rv);
  });

  it('issues a fit-to-selection with no target when nothing is selected', () => {
    const controller = controllerWithObjects();
    controller.fitToSelection();

    // The rig treats a null target as "nothing to frame" and leaves the camera
    // alone, rather than jumping to the origin.
    expect(controller.getCameraCommand()?.targetId).toBeNull();
  });
});

describe('lifecycle integration', () => {
  it('exposes lifecycle phase through the snapshot', () => {
    const controller = new SceneController();
    expect(controller.getSnapshot().lifecycle.phase).toBe('idle');

    controller.dispatchLifecycle({ type: 'load', modelRef: 'heart' });
    expect(controller.getSnapshot().lifecycle.phase).toBe('loading');

    const generation = controller.getLifecycle().generation;
    controller.dispatchLifecycle({ type: 'loaded', generation });
    expect(controller.getSnapshot().lifecycle.phase).toBe('loaded');
  });

  it('disposes into a terminal state and clears listeners', () => {
    const controller = controllerWithObjects();
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.dispose();

    expect(controller.getSnapshot().lifecycle.phase).toBe('disposed');
    listener.mockClear();
    controller.select(lv);
    expect(listener).not.toHaveBeenCalled();
  });
});
