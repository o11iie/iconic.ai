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

/** What the semantic layer reports for one object. */
export interface EngineHierarchyState {
  readonly parent: string | null;
  readonly ancestors: readonly string[];
  readonly children: readonly string[];
}

export interface EngineBoundsState {
  readonly center: readonly [number, number, number];
  readonly radius: number;
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
  /** Meshes whose authored material the engine is tracking. */
  readonly materialTracked: number;
  readonly lifecycle: string;
  readonly sceneEpoch: number;
  /** Registry generation. Bumped whenever the model is replaced. */
  readonly generation: number;
  /**
   * Controller revision. Advances only when scene state actually changed, so
   * a test can prove that pointer movement inside one object is not
   * repeatedly waking the React tree.
   */
  readonly revision: number;
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

  // ---- semantic layer (Gate 6) --------------------------------------------

  /** Select and frame in one step, through the semantic API. */
  focusObject: (semanticId: string) => boolean;
  /** Hide structures, to prove selection cannot survive its own object. */
  hide: (semanticIds: readonly string[]) => void;
  /** Hierarchy as the registry reports it. */
  hierarchy: (semanticId: string) => EngineHierarchyState;
  /** Live geometry through the semantic bounds API. */
  bounds: (semanticId: string) => EngineBoundsState | null;
  /** Semantic search, returning ids in rank order. */
  search: (query: string) => readonly string[];

  /**
   * Hold on to the render node currently backing a semantic id.
   *
   * Paired with `resolveCaptured`, this is how a browser test proves the
   * central Gate 6 rule: after the model is replaced, the node kept here is a
   * real object reference from the previous model, and resolving it must
   * yield nothing rather than silently pointing at the new scene.
   */
  captureNode: (semanticId: string) => boolean;
  /** Resolve the captured node against the CURRENT registry. */
  resolveCaptured: () => string | null;
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

const EMPTY_HIERARCHY: EngineHierarchyState = { parent: null, ancestors: [], children: [] };

const actions: {
  replaceScene: () => void;
  select: (id: string | null) => void;
  resetCamera: () => void;
  fitModel: () => void;
  fitSelection: () => void;
  focusObject: (id: string) => boolean;
  hide: (ids: readonly string[]) => void;
  hierarchy: (id: string) => EngineHierarchyState;
  bounds: (id: string) => EngineBoundsState | null;
  search: (query: string) => readonly string[];
  captureNode: (id: string) => boolean;
  resolveCaptured: () => string | null;
} = {
  replaceScene: () => {},
  select: () => {},
  resetCamera: () => {},
  fitModel: () => {},
  fitSelection: () => {},
  focusObject: () => false,
  hide: () => {},
  hierarchy: () => EMPTY_HIERARCHY,
  bounds: () => null,
  search: () => [],
  captureNode: () => false,
  resolveCaptured: () => null,
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
        materialTracked: sceneState?.materialTracked ?? 0,
        lifecycle: sceneState?.lifecycle ?? 'idle',
        sceneEpoch: sceneState?.sceneEpoch ?? 0,
        generation: sceneState?.generation ?? 0,
        revision: sceneState?.revision ?? 0,
      };
    },
    replaceScene: () => actions.replaceScene(),
    select: (id) => actions.select(id),
    resetCamera: () => actions.resetCamera(),
    fitModel: () => actions.fitModel(),
    fitSelection: () => actions.fitSelection(),
    focusObject: (id) => actions.focusObject(id),
    hide: (ids) => actions.hide(ids),
    hierarchy: (id) => actions.hierarchy(id),
    bounds: (id) => actions.bounds(id),
    search: (query) => actions.search(query),
    captureNode: (id) => actions.captureNode(id),
    resolveCaptured: () => actions.resolveCaptured(),
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
