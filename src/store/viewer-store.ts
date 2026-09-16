import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SemanticId } from '@/lib/semantic-id';
import type { InteractionMode } from '@/engine/spatial/types';
import type { LoadProgress } from '@/engine/spatial/types';
import { IDLE_PROGRESS } from '@/engine/spatial/types';
import type { Vec3 } from '@/types/domain/spatial';

/**
 * Viewer store — everything about *looking at* a spatial model.
 *
 * Deliberately separate from learning state: you can change what you are
 * looking at without touching which course you are in, and vice versa. Mixing
 * them is what turns a viewport into an unmaintainable god-object.
 *
 * Components subscribe to narrow slices via the exported hooks below so that
 * hovering one structure does not re-render the whole application.
 */

export interface ViewerState {
  // ---- what is loaded ----
  modelRef: string | null;
  loading: boolean;
  progress: LoadProgress;
  error: string | null;

  // ---- selection + emphasis ----
  selectedObject: SemanticId | null;
  hoveredObject: SemanticId | null;
  highlightedObjects: readonly SemanticId[];
  isolatedObject: SemanticId | null;
  hiddenObjects: readonly SemanticId[];

  // ---- layers + camera ----
  visibleLayers: readonly string[];
  hiddenLayers: readonly string[];
  cameraTarget: Vec3 | null;

  // ---- interaction ----
  interactionMode: InteractionMode;
  showLabels: boolean;
  ghostContext: boolean;
}

export interface ViewerActions {
  setModelRef: (modelRef: string | null) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: LoadProgress) => void;
  setError: (error: string | null) => void;

  select: (semanticId: SemanticId | null) => void;
  hover: (semanticId: SemanticId | null) => void;
  setHighlighted: (ids: readonly SemanticId[]) => void;
  isolate: (semanticId: SemanticId | null) => void;
  hide: (semanticId: SemanticId) => void;
  show: (semanticId: SemanticId) => void;

  setLayers: (layerIds: readonly string[]) => void;
  toggleLayer: (layerId: string) => void;
  setCameraTarget: (target: Vec3 | null) => void;

  setInteractionMode: (mode: InteractionMode) => void;
  setShowLabels: (show: boolean) => void;
  setGhostContext: (ghost: boolean) => void;

  /** Clear emphasis but keep the loaded model. */
  resetView: () => void;
  /** Full reset, used when switching models. */
  reset: () => void;
}

const initialState: ViewerState = {
  modelRef: null,
  loading: false,
  progress: IDLE_PROGRESS,
  error: null,
  selectedObject: null,
  hoveredObject: null,
  highlightedObjects: [],
  isolatedObject: null,
  hiddenObjects: [],
  visibleLayers: [],
  hiddenLayers: [],
  cameraTarget: null,
  interactionMode: 'inspect',
  showLabels: true,
  ghostContext: true,
};

export const useViewerStore = create<ViewerState & ViewerActions>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    setModelRef: (modelRef) => set({ modelRef }),
    setLoading: (loading) => set({ loading }),
    setProgress: (progress) => set({ progress }),
    setError: (error) => set({ error, loading: false }),

    select: (selectedObject) => set({ selectedObject }),
    hover: (hoveredObject) => set({ hoveredObject }),
    setHighlighted: (highlightedObjects) => set({ highlightedObjects }),
    isolate: (isolatedObject) => set({ isolatedObject }),

    hide: (semanticId) =>
      set((state) =>
        state.hiddenObjects.includes(semanticId)
          ? state
          : { hiddenObjects: [...state.hiddenObjects, semanticId] },
      ),

    show: (semanticId) =>
      set((state) => ({
        hiddenObjects: state.hiddenObjects.filter((id) => id !== semanticId),
      })),

    setLayers: (visibleLayers) => set({ visibleLayers, hiddenLayers: [] }),

    toggleLayer: (layerId) =>
      set((state) => {
        const hidden = new Set(state.hiddenLayers);
        if (hidden.has(layerId)) {
          hidden.delete(layerId);
        } else {
          hidden.add(layerId);
        }
        return { hiddenLayers: [...hidden] };
      }),

    setCameraTarget: (cameraTarget) => set({ cameraTarget }),
    setInteractionMode: (interactionMode) => set({ interactionMode }),
    setShowLabels: (showLabels) => set({ showLabels }),
    setGhostContext: (ghostContext) => set({ ghostContext }),

    resetView: () =>
      set({
        selectedObject: null,
        hoveredObject: null,
        highlightedObjects: [],
        isolatedObject: null,
        hiddenObjects: [],
        hiddenLayers: [],
        cameraTarget: null,
      }),

    reset: () => set(initialState),
  })),
);

// ---- narrow selectors: subscribe to one field, re-render on one field -------
export const useSelectedObject = () => useViewerStore((s) => s.selectedObject);
export const useHoveredObject = () => useViewerStore((s) => s.hoveredObject);
export const useIsolatedObject = () => useViewerStore((s) => s.isolatedObject);
export const useInteractionMode = () => useViewerStore((s) => s.interactionMode);
export const useViewerLoading = () => useViewerStore((s) => s.loading);
export const useViewerError = () => useViewerStore((s) => s.error);
export const useViewerProgress = () => useViewerStore((s) => s.progress);
export const useShowLabels = () => useViewerStore((s) => s.showLabels);
