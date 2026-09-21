import { describe, expect, it } from 'vitest';
import type { SemanticId } from '@/lib/semantic-id';
import {
  computeIsolationSets,
  resolveObjectVisualState,
  resolveVisualState,
  styleFor,
  type VisualStateInput,
} from './visual-state';

const heart = 'veo.anatomy.heart' as SemanticId;
const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
const rv = 'veo.anatomy.heart.right_ventricle' as SemanticId;
const lung = 'veo.anatomy.lung' as SemanticId;

function input(overrides: Partial<VisualStateInput> = {}): VisualStateInput {
  return {
    objectIds: [heart, lv, rv, lung],
    selectedId: null,
    hoveredId: null,
    highlightedIds: new Set(),
    hiddenIds: new Set(),
    ghostedIds: new Set(),
    isolatedId: null,
    hiddenLayerIds: new Set(),
    layerMembership: new Map(),
    ...overrides,
  };
}

describe('resolveVisualState', () => {
  it('defaults every object when nothing is emphasised', () => {
    const scene = resolveVisualState(input());
    expect([...scene.states.values()].every((state) => state === 'default')).toBe(true);
  });

  it('applies selection, hover and highlight', () => {
    const scene = resolveVisualState(
      input({ selectedId: lv, hoveredId: rv, highlightedIds: new Set([lung]) }),
    );
    expect(scene.states.get(lv)).toBe('selected');
    expect(scene.states.get(rv)).toBe('hovered');
    expect(scene.states.get(lung)).toBe('highlighted');
  });
});

describe('precedence', () => {
  it('ranks hidden above selection', () => {
    const state = resolveObjectVisualState(lv, input({ selectedId: lv, hiddenIds: new Set([lv]) }));
    expect(state).toBe('hidden');
  });

  it('ranks selection above hover', () => {
    const state = resolveObjectVisualState(lv, input({ selectedId: lv, hoveredId: lv }));
    expect(state).toBe('selected');
  });

  it('ranks hover above highlight', () => {
    const state = resolveObjectVisualState(
      lv,
      input({ hoveredId: lv, highlightedIds: new Set([lv]) }),
    );
    expect(state).toBe('hovered');
  });

  it('ranks highlight above ghost', () => {
    const state = resolveObjectVisualState(
      lv,
      input({ highlightedIds: new Set([lv]), ghostedIds: new Set([lv]) }),
    );
    expect(state).toBe('highlighted');
  });
});

describe('isolation', () => {
  it('hides everything outside the isolated subtree', () => {
    const scene = resolveVisualState(input({ isolatedId: heart }));

    // The subtree reports `isolated` rather than `default`: being the subject
    // of isolation is a fact about the object, and the renderer and the
    // interface both need to be able to tell.
    expect(scene.states.get(heart)).toBe('isolated');
    expect(scene.states.get(lv)).toBe('isolated');
    expect(scene.states.get(lung)).toBe('hidden');
  });

  it('ghosts context rather than deleting it, preserving orientation', () => {
    const { hidden, ghosted } = computeIsolationSets([heart, lv, lung], heart, true);
    expect(ghosted.has(lung)).toBe(true);
    expect(hidden.size).toBe(0);
    // The isolated subtree itself is never touched.
    expect(ghosted.has(heart)).toBe(false);
    expect(ghosted.has(lv)).toBe(false);
  });

  it('hides context when the provider cannot ghost', () => {
    const { hidden, ghosted } = computeIsolationSets([heart, lung], heart, false);
    expect(hidden.has(lung)).toBe(true);
    expect(ghosted.size).toBe(0);
  });
});

describe('layers', () => {
  it('hides an object only when every layer it belongs to is hidden', () => {
    const membership = new Map<SemanticId, readonly string[]>([[lv, ['muscle', 'conduction']]]);

    const partly = resolveObjectVisualState(
      lv,
      input({ hiddenLayerIds: new Set(['muscle']), layerMembership: membership }),
    );
    expect(partly).toBe('default');

    const fully = resolveObjectVisualState(
      lv,
      input({ hiddenLayerIds: new Set(['muscle', 'conduction']), layerMembership: membership }),
    );
    expect(fully).toBe('hidden');
  });
});

describe('styleFor', () => {
  it('makes ghosted geometry non-occluding', () => {
    const ghost = styleFor('ghosted');
    expect(ghost.transparent).toBe(true);
    expect(ghost.depthWrite).toBe(false);
    expect(ghost.visible).toBe(true);
  });

  it('marks hidden geometry invisible', () => {
    expect(styleFor('hidden').visible).toBe(false);
  });
});

describe('isolation with preserved context', () => {
  it('ghosts an explicitly ghosted object outside the isolated subtree', () => {
    // Regression: the blanket isolation hide used to override the ghost set,
    // so isolating a structure erased the context that orients the learner.
    const { hidden, ghosted } = computeIsolationSets([heart, lv, rv, lung], lv, true);
    const scene = resolveVisualState(
      input({ isolatedId: lv, ghostedIds: ghosted, hiddenIds: hidden }),
    );

    expect(scene.states.get(lv)).toBe('isolated');
    expect(scene.states.get(rv)).toBe('ghosted');
    expect(scene.states.get(lung)).toBe('ghosted');
  });

  it('still hides context when nothing was ghosted', () => {
    const scene = resolveVisualState(input({ isolatedId: lv }));
    expect(scene.states.get(lung)).toBe('hidden');
  });
});
