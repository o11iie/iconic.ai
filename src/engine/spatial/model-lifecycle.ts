import type { LoadProgress } from './types';
import { IDLE_PROGRESS } from './types';

/**
 * Model lifecycle
 * ===============
 *
 * A pure state machine, so the hardest part of asset loading — what happens
 * when a learner switches models mid-download — is reasoned about and tested
 * without a network or a GPU.
 *
 *   idle ──load──▶ loading ──loaded──▶ loaded ──unload──▶ idle
 *                    │                    │
 *                    └──fail──▶ failed ◀──┘
 *                                 │
 *                          dispose│ (from any phase)
 *                                 ▼
 *                              disposed
 *
 * `generation` is the important field. It increments on every load, and an
 * async result carrying a stale generation is ignored. Without it, switching
 * from a slow model to a fast one lets the slow response land last and replace
 * the model the learner actually asked for.
 */

export const MODEL_PHASES = ['idle', 'loading', 'loaded', 'failed', 'disposed'] as const;
export type ModelPhase = (typeof MODEL_PHASES)[number];

export interface ModelLifecycleState {
  readonly phase: ModelPhase;
  readonly modelRef: string | null;
  readonly progress: LoadProgress;
  readonly error: string | null;
  /** Incremented per load. Async results from older generations are discarded. */
  readonly generation: number;
}

export const INITIAL_LIFECYCLE: ModelLifecycleState = {
  phase: 'idle',
  modelRef: null,
  progress: IDLE_PROGRESS,
  error: null,
  generation: 0,
};

export type ModelLifecycleEvent =
  | { readonly type: 'load'; readonly modelRef: string }
  | { readonly type: 'progress'; readonly progress: LoadProgress; readonly generation: number }
  | { readonly type: 'loaded'; readonly generation: number }
  | { readonly type: 'fail'; readonly error: string; readonly generation: number }
  | { readonly type: 'unload' }
  | { readonly type: 'reload' }
  | { readonly type: 'dispose' };

export function modelLifecycleReducer(
  state: ModelLifecycleState,
  event: ModelLifecycleEvent,
): ModelLifecycleState {
  switch (event.type) {
    case 'load': {
      // A new load always supersedes whatever came before, including a load
      // already in flight, and bumps the generation to orphan its result.
      return {
        phase: 'loading',
        modelRef: event.modelRef,
        progress: { ...IDLE_PROGRESS, phase: 'downloading' },
        error: null,
        generation: state.generation + 1,
      };
    }

    case 'reload': {
      if (state.modelRef === null) return state;
      return {
        phase: 'loading',
        modelRef: state.modelRef,
        progress: { ...IDLE_PROGRESS, phase: 'downloading' },
        error: null,
        generation: state.generation + 1,
      };
    }

    case 'progress': {
      // Ignore progress from a superseded load, and never resurrect a
      // finished or disposed scene.
      if (event.generation !== state.generation) return state;
      if (state.phase !== 'loading') return state;
      return { ...state, progress: event.progress };
    }

    case 'loaded': {
      if (event.generation !== state.generation) return state;
      if (state.phase !== 'loading') return state;
      return {
        ...state,
        phase: 'loaded',
        progress: { ...state.progress, ratio: 1, phase: 'ready' },
        error: null,
      };
    }

    case 'fail': {
      if (event.generation !== state.generation) return state;
      if (state.phase === 'disposed') return state;
      return {
        ...state,
        phase: 'failed',
        progress: { ...state.progress, phase: 'failed' },
        error: event.error,
      };
    }

    case 'unload': {
      if (state.phase === 'disposed') return state;
      // Unloading bumps the generation too, so a load still in flight cannot
      // complete into an emptied scene.
      return {
        phase: 'idle',
        modelRef: null,
        progress: IDLE_PROGRESS,
        error: null,
        generation: state.generation + 1,
      };
    }

    case 'dispose': {
      return {
        phase: 'disposed',
        modelRef: null,
        progress: IDLE_PROGRESS,
        error: null,
        generation: state.generation + 1,
      };
    }

    default:
      return state;
  }
}

/** True when the scene currently holds renderable content. */
export function hasRenderableModel(state: ModelLifecycleState): boolean {
  return state.phase === 'loaded' && state.modelRef !== null;
}

/** True when a load is in flight and the UI should show progress. */
export function isLoading(state: ModelLifecycleState): boolean {
  return state.phase === 'loading';
}

/** True when an async result belongs to the current load. */
export function isCurrentGeneration(state: ModelLifecycleState, generation: number): boolean {
  return state.generation === generation;
}
