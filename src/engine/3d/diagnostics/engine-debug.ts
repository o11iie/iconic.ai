import type { SemanticId } from '@/lib/semantic-id';

/**
 * Engine debug bridge.
 *
 * Publishes a read-only view of real engine state — camera pose, GPU resource
 * counts, registry contents, selection and material state — on `window` so
 * automated verification can assert what the engine is actually doing rather
 * than what the DOM happens to say.
 *
 * Without this, a browser test can confirm a canvas element exists but not
 * that orbiting moved the camera, that selection reached the scene, or that
 * replacing a model freed its GPU memory. Those are exactly the claims that
 * matter, and exactly the ones inspection cannot settle.
 *
 * Gated behind the pipeline-diagnostic flag, so it is absent in a normal
 * production deployment.
 */

export interface EngineCameraState {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly distance: number;
  readonly fov: number;
}

export interface EngineMemoryState {
  /** Live geometries on the GPU, as reported by the renderer itself. */
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  readonly drawCalls: number;
}

export interface EngineDebugState {
  readonly ready: boolean;
  readonly camera: EngineCameraState | null;
  readonly memory: EngineMemoryState | null;
  readonly registry: readonly SemanticId[];
  readonly selectedId: SemanticId | null;
  readonly hoveredId: SemanticId | null;
  readonly visualStates: Readonly<Record<string, string>>;
  readonly materialOverrides: number;
  readonly lifecycle: string;
  readonly sceneEpoch: number;
}

export interface EngineDebugHandle {
  /** Current engine state. */
  state: () => EngineDebugState;
  /** Dispose and rebuild the scene, exercising the real replacement path. */
  replaceScene: () => void;
  /** Select by semantic id without a pointer, for deterministic assertions. */
  select: (semanticId: string | null) => void;
  /** Issue camera intents directly. */
  resetCamera: () => void;
  fitModel: () => void;
  fitSelection: () => void;
}

declare global {
  interface Window {
    __VEO_ENGINE__?: EngineDebugHandle;
  }
}

type Source<T> = () => T;

const sources: {
  camera: Source<EngineCameraState | null>;
  memory: Source<EngineMemoryState | null>;
  scene: Source<Omit<EngineDebugState, 'camera' | 'memory' | 'ready'>> | null;
} = {
  camera: () => null,
  memory: () => null,
  scene: null,
};

const actions: {
  replaceScene: () => void;
  select: (id: string | null) => void;
  resetCamera: () => void;
  fitModel: () => void;
  fitSelection: () => void;
} = {
  replaceScene: () => {},
  select: () => {},
  resetCamera: () => {},
  fitModel: () => {},
  fitSelection: () => {},
};

function install(): void {
  if (typeof window === 'undefined') return;

  window.__VEO_ENGINE__ = {
    state: () => {
      const sceneState = sources.scene?.();
      return {
        ready: sceneState !== undefined && sources.camera() !== null,
        camera: sources.camera(),
        memory: sources.memory(),
        registry: sceneState?.registry ?? [],
        selectedId: sceneState?.selectedId ?? null,
        hoveredId: sceneState?.hoveredId ?? null,
        visualStates: sceneState?.visualStates ?? {},
        materialOverrides: sceneState?.materialOverrides ?? 0,
        lifecycle: sceneState?.lifecycle ?? 'idle',
        sceneEpoch: sceneState?.sceneEpoch ?? 0,
      };
    },
    replaceScene: () => actions.replaceScene(),
    select: (id) => actions.select(id),
    resetCamera: () => actions.resetCamera(),
    fitModel: () => actions.fitModel(),
    fitSelection: () => actions.fitSelection(),
  };
}

/** Register the in-canvas sources (camera and renderer memory). */
export function registerCanvasDebug(
  camera: Source<EngineCameraState | null>,
  memory: Source<EngineMemoryState | null>,
): () => void {
  sources.camera = camera;
  sources.memory = memory;
  install();

  return () => {
    sources.camera = () => null;
    sources.memory = () => null;
  };
}

/** Register the scene-level source and actions. */
export function registerSceneDebug(
  scene: Source<Omit<EngineDebugState, 'camera' | 'memory' | 'ready'>>,
  handlers: Partial<typeof actions>,
): () => void {
  sources.scene = scene;
  Object.assign(actions, handlers);
  install();

  return () => {
    sources.scene = null;
  };
}

export function uninstallEngineDebug(): void {
  if (typeof window === 'undefined') return;
  delete window.__VEO_ENGINE__;
}
