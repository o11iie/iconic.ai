import { describe, expect, it } from 'vitest';
import {
  INITIAL_LIFECYCLE,
  hasRenderableModel,
  isCurrentGeneration,
  isLoading,
  modelLifecycleReducer,
  type ModelLifecycleState,
} from './model-lifecycle';

const progress = { ratio: 0.5, loadedBytes: 50, totalBytes: 100, phase: 'downloading' as const };

function load(state: ModelLifecycleState, modelRef: string) {
  return modelLifecycleReducer(state, { type: 'load', modelRef });
}

describe('model lifecycle', () => {
  it('starts idle', () => {
    expect(INITIAL_LIFECYCLE.phase).toBe('idle');
    expect(hasRenderableModel(INITIAL_LIFECYCLE)).toBe(false);
  });

  it('moves idle -> loading -> loaded', () => {
    const loading = load(INITIAL_LIFECYCLE, 'heart');
    expect(loading.phase).toBe('loading');
    expect(isLoading(loading)).toBe(true);

    const loaded = modelLifecycleReducer(loading, {
      type: 'loaded',
      generation: loading.generation,
    });
    expect(loaded.phase).toBe('loaded');
    expect(hasRenderableModel(loaded)).toBe(true);
    expect(loaded.progress.ratio).toBe(1);
  });

  it('moves loading -> failed and keeps the reason', () => {
    const loading = load(INITIAL_LIFECYCLE, 'heart');
    const failed = modelLifecycleReducer(loading, {
      type: 'fail',
      error: 'HTTP 404',
      generation: loading.generation,
    });

    expect(failed.phase).toBe('failed');
    expect(failed.error).toBe('HTTP 404');
    expect(hasRenderableModel(failed)).toBe(false);
  });

  it('unloads back to idle and forgets the model', () => {
    const loaded = modelLifecycleReducer(load(INITIAL_LIFECYCLE, 'heart'), {
      type: 'loaded',
      generation: 1,
    });

    const idle = modelLifecycleReducer(loaded, { type: 'unload' });
    expect(idle.phase).toBe('idle');
    expect(idle.modelRef).toBeNull();
  });

  it('replaces one model with another', () => {
    const first = modelLifecycleReducer(load(INITIAL_LIFECYCLE, 'heart'), {
      type: 'loaded',
      generation: 1,
    });
    const second = load(first, 'skull');

    expect(second.phase).toBe('loading');
    expect(second.modelRef).toBe('skull');
    expect(second.generation).toBeGreaterThan(first.generation);
  });

  it('reloads the current model', () => {
    const loaded = modelLifecycleReducer(load(INITIAL_LIFECYCLE, 'heart'), {
      type: 'loaded',
      generation: 1,
    });
    const reloading = modelLifecycleReducer(loaded, { type: 'reload' });

    expect(reloading.phase).toBe('loading');
    expect(reloading.modelRef).toBe('heart');
    expect(reloading.generation).toBe(loaded.generation + 1);
  });

  it('ignores reload when nothing is loaded', () => {
    expect(modelLifecycleReducer(INITIAL_LIFECYCLE, { type: 'reload' })).toBe(INITIAL_LIFECYCLE);
  });
});

describe('generation guarding', () => {
  it('discards a result from a superseded load', () => {
    // The defect this prevents: switching from a slow model to a fast one,
    // then having the slow response land last and replace the fast model.
    const slow = load(INITIAL_LIFECYCLE, 'slow-model');
    const fast = load(slow, 'fast-model');

    const stale = modelLifecycleReducer(fast, { type: 'loaded', generation: slow.generation });

    expect(stale).toBe(fast);
    expect(stale.modelRef).toBe('fast-model');
    expect(stale.phase).toBe('loading');
  });

  it('discards progress from a superseded load', () => {
    const first = load(INITIAL_LIFECYCLE, 'a');
    const second = load(first, 'b');

    const unchanged = modelLifecycleReducer(second, {
      type: 'progress',
      progress,
      generation: first.generation,
    });

    expect(unchanged).toBe(second);
  });

  it('discards a failure from a superseded load', () => {
    const first = load(INITIAL_LIFECYCLE, 'a');
    const second = load(first, 'b');

    const unchanged = modelLifecycleReducer(second, {
      type: 'fail',
      error: 'stale failure',
      generation: first.generation,
    });

    expect(unchanged).toBe(second);
    expect(unchanged.error).toBeNull();
  });

  it('accepts a result from the current generation', () => {
    const loading = load(INITIAL_LIFECYCLE, 'a');
    expect(isCurrentGeneration(loading, loading.generation)).toBe(true);

    const withProgress = modelLifecycleReducer(loading, {
      type: 'progress',
      progress,
      generation: loading.generation,
    });
    expect(withProgress.progress.ratio).toBe(0.5);
  });

  it('bumps the generation on unload, so an in-flight load cannot land after it', () => {
    const loading = load(INITIAL_LIFECYCLE, 'a');
    const unloaded = modelLifecycleReducer(loading, { type: 'unload' });

    const late = modelLifecycleReducer(unloaded, {
      type: 'loaded',
      generation: loading.generation,
    });

    expect(late.phase).toBe('idle');
  });
});

describe('disposal', () => {
  it('is terminal from any phase', () => {
    for (const state of [
      INITIAL_LIFECYCLE,
      load(INITIAL_LIFECYCLE, 'a'),
      modelLifecycleReducer(load(INITIAL_LIFECYCLE, 'a'), { type: 'loaded', generation: 1 }),
    ]) {
      expect(modelLifecycleReducer(state, { type: 'dispose' }).phase).toBe('disposed');
    }
  });

  it('cannot be resurrected by a late async result', () => {
    const loading = load(INITIAL_LIFECYCLE, 'a');
    const disposed = modelLifecycleReducer(loading, { type: 'dispose' });

    const late = modelLifecycleReducer(disposed, { type: 'loaded', generation: loading.generation });
    expect(late.phase).toBe('disposed');

    const lateFailure = modelLifecycleReducer(disposed, {
      type: 'fail',
      error: 'x',
      generation: disposed.generation,
    });
    expect(lateFailure.phase).toBe('disposed');
  });
});
