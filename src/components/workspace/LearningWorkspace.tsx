'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Overlay';
import { IconButton } from '@/components/ui/IconButton';
import { ErrorState, LoadingState, NotConfiguredState } from '@/components/ui/states';
import { ViewportShell } from '@/components/spatial/ViewportShell';
import { useAnatomyModel } from '@/hooks/use-anatomy-model';
import { DIAGNOSTIC_LABEL } from '@/engine/3d/diagnostics/diagnostic-scene';
import { isSemanticId, semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import type { InteractionMode, SceneVisualState } from '@/engine/spatial/types';
import { NO_CAPABILITIES as NO_MODEL_CAPABILITIES } from '@/engine/spatial/capabilities';
import type { SpatialCapabilities } from '@/types/domain/spatial';
import { useReducedMotion } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { AIStudyPanel } from './AIStudyPanel';
import {
  ContextPanel,
  type ContextActionPayload,
  type ManipulateAction,
} from './ContextPanel';
import { SpatialSearch } from './SpatialSearch';
import type { BreadcrumbNode } from './ObjectBreadcrumb';
import { useSpatialKeyboard } from '@/hooks/use-spatial-keyboard';
import { LayersPanel } from './LayersPanel';
import { ModelSwitcher } from './ModelSwitcher';
import { SpatialToolbar, type WorkspaceTool } from './SpatialToolbar';
import { ViewportControls } from './ViewportControls';

/**
 * The VEO learning workspace.
 *
 * Layout priority is the whole design: the viewport takes every pixel the
 * chrome does not need. Tools are a 52px rail, the context panel is a fixed
 * column that collapses to a bottom sheet below `xl`, and the study bar is a
 * single row. Nothing scrolls the page — the model never becomes a thumbnail
 * inside a document.
 *
 * Scene state has ONE owner: the provider's `SceneController`. Selection and
 * hover are read from its snapshot and written through its methods; they are
 * never mirrored into component state. The viewer store keeps only session
 * concerns — which model is open, which tool is active — and receives the
 * selected id through a single one-way sync so non-3D surfaces can read it.
 */
export function LearningWorkspace({
  diagnostic = false,
  aiConfigured,
}: {
  readonly diagnostic?: boolean;
  /**
   * Resolved on the server: OPENAI_API_KEY is server-only and must never be
   * readable from the browser, so the page passes the boolean down.
   */
  readonly aiConfigured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();

  const modelRef = useViewerStore((s) => s.modelRef);
  const setModelRef = useViewerStore((s) => s.setModelRef);
  const interactionMode = useViewerStore((s) => s.interactionMode);
  const setInteractionMode = useViewerStore((s) => s.setInteractionMode);
  const syncSelection = useViewerStore((s) => s.select);

  // The URL is the source of truth for which model is open, so the workspace
  // is linkable and survives a refresh.
  const urlModel = searchParams.get('model');
  const activeModel = diagnostic ? null : (urlModel ?? modelRef);

  const { provider, controller, status, snapshot, progress, error, assetUrl, meshMapping, retry } =
    useAnatomyModel(activeModel);

  const [unmapped, setUnmapped] = useState<readonly string[]>([]);
  const [registrySize, setRegistrySize] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);

  const selectedId = snapshot?.selectedId ?? null;
  const graph = snapshot?.graph ?? null;

  /*
   * What the tools may offer comes from the loaded model, narrowed by what the
   * provider can drive. Neither alone is enough: a model may declare layers a
   * provider cannot address, and a provider may support isolation on a model
   * with nothing to isolate.
   */
  const providerCapabilities = provider?.getStatus().capabilities;
  const modelCapabilities = snapshot?.capabilities ?? NO_MODEL_CAPABILITIES;
  const capabilities = useMemo<SpatialCapabilities>(
    () => ({
      ...modelCapabilities,
      supportsIsolation:
        modelCapabilities.supportsIsolation && (providerCapabilities?.supportsIsolation ?? true),
    }),
    [modelCapabilities, providerCapabilities],
  );

  const manipulationState = snapshot?.manipulation ?? null;
  const peeledLayerIds = useMemo(
    () => controller?.getPeeledLayerIds() ?? EMPTY_PEELED,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, manipulationState],
  );
  const offsets = useMemo(
    () => (manipulationState?.exploded ? (controller?.getExplodedOffsets() ?? EMPTY_OFFSETS) : EMPTY_OFFSETS),
    [controller, manipulationState],
  );

  /** One-way sync so navigation and other non-3D surfaces can read selection. */
  useEffect(() => {
    syncSelection(selectedId);
  }, [selectedId, syncSelection]);

  /**
   * Reveal the detail panel on narrow screens when something is selected.
   *
   * Driven by a subscription to the scene controller rather than by reacting
   * to rendered state: a selection is an event from an external store, and
   * handling it in the callback avoids a cascading render on every snapshot.
   */
  /** Live selection for the keyboard handler, which must not re-bind per change. */
  const selectedIdRef = useRef<SemanticId | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const previousSelection = useRef<SemanticId | null>(null);
  useEffect(() => {
    if (!controller) return;

    return controller.subscribe(() => {
      const next = controller.getSnapshot().selectedId;
      const became = next !== null && previousSelection.current === null;
      previousSelection.current = next;

      if (became && window.matchMedia('(max-width: 1279px)').matches) {
        setContextOpen(true);
      }
    });
  }, [controller]);

  const sceneReady = diagnostic ? registrySize > 0 : status === 'ready';

  /**
   * Deep link to a structure: /explore?model=heart&select=veo.anatomy.heart
   *
   * The id is NEVER trusted. It is parsed for shape and then validated against
   * the current model's object set, so a crafted or stale link cannot select
   * something that does not exist, reach into another model, or mutate any
   * state beyond selection. An invalid id is ignored silently — it is a bad
   * link, not an error the learner caused.
   */
  const selectParam = searchParams.get('select');
  useEffect(() => {
    if (!controller || !sceneReady || !selectParam) return;
    if (!isSemanticId(selectParam)) return;
    controller.focusObject(selectParam, { reducedMotion });
  }, [controller, sceneReady, selectParam, reducedMotion]);

  /**
   * Keyboard accelerators. Every one is also a visible control, and none fire
   * while the learner is typing.
   */
  useSpatialKeyboard({
    enabled: sceneReady,
    onEscape: () => {
      if (contextOpen) {
        setContextOpen(false);
        return;
      }
      if (layersOpen) {
        setLayersOpen(false);
        return;
      }
      controller?.select(null);
    },
    onReset: () => {
      controller?.restore();
      controller?.resetCamera({ reducedMotion });
    },
    onFocus: () => {
      if (selectedIdRef.current) controller?.flyTo(selectedIdRef.current, { reducedMotion });
    },
  });

  /**
   * Everything the panel shows is resolved through the registry, so a mesh
   * name never reaches the interface. `revision` is in the dependency list
   * because the controller is an external store: without it these would go
   * stale the moment selection or the model changed.
   */
  const revision = snapshot?.revision ?? 0;

  /*
   * `revision` is listed deliberately and is NOT unused.
   *
   * The controller is an external mutable store: `getObject`, `getRelationships`
   * and the registry queries return different results as it changes, without
   * any of their arguments changing. `revision` is the store's change counter,
   * so including it is what keeps these memos correct. The exhaustive-deps rule
   * cannot see through an external store, so it reports the dependency as
   * unnecessary; removing it would silently stale every panel field.
   */
  /* eslint-disable react-hooks/exhaustive-deps */
  const selectedObject = useMemo(
    () => (selectedId && controller ? controller.getObject(selectedId) : null),
    [controller, selectedId, revision],
  );

  const relationships = useMemo(
    () => (selectedId && controller ? controller.getRelationships(selectedId) : []),
    [controller, selectedId, revision],
  );

  const trail = useMemo<BreadcrumbNode[]>(() => {
    if (!selectedId || !controller) return [];
    const ancestors = [...controller.registry.getAncestors(selectedId)].reverse();
    return [...ancestors, selectedId].map((id) => ({
      semanticId: id,
      name: controller.getObject(id)?.name ?? null,
    }));
  }, [controller, selectedId, revision]);

  const childNodes = useMemo<BreadcrumbNode[]>(() => {
    if (!selectedId || !controller) return [];
    return controller.registry.getChildren(selectedId).map((id) => ({
      semanticId: id,
      name: controller.getObject(id)?.name ?? null,
    }));
  }, [controller, selectedId, revision]);

  const runSearch = useCallback(
    (query: string) => controller?.search(query) ?? [],
    [controller, revision],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  /** One entry point for every route to a structure: click, search, related. */
  const focusObject = useCallback(
    (id: SemanticId) => {
      controller?.focusObject(id, { reducedMotion });
    },
    [controller, reducedMotion],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      setModelRef(nextModel);
      router.replace(`/explore?model=${encodeURIComponent(nextModel)}`, { scroll: false });
    },
    [router, setModelRef],
  );

  /**
   * Study actions.
   *
   * Implemented in the gate that builds generation and scheduling. The full
   * semantic payload is already assembled and passed, so wiring them later is
   * a change of handler rather than a change of architecture. Nothing here
   * fabricates a result.
   */
  const handleAction = useCallback((payload: ContextActionPayload) => {
    setContextOpen(false);
    void payload;
  }, []);

  /**
   * Manipulating the selected structure.
   *
   * Every one of these is an intent dispatched to the controller, which owns
   * the resulting state. Nothing here keeps a parallel copy of what is hidden,
   * ghosted or dissected — that is exactly the second source of truth a
   * viewport cannot survive.
   */
  const handleManipulate = useCallback(
    (action: ManipulateAction, semanticId: SemanticId) => {
      if (!controller) return;

      switch (action) {
        case 'isolate':
          controller.isolateObject(semanticId, { reducedMotion });
          break;
        case 'hide':
          controller.hideObject(semanticId);
          break;
        case 'ghost':
          controller.ghostObject(semanticId);
          break;
        case 'dissect':
          controller.dissectObject(semanticId);
          break;
        case 'restore':
          controller.reconstructStep();
          break;
      }
    },
    [controller, reducedMotion],
  );

  const handleTool = useCallback(
    (tool: WorkspaceTool) => {
      if (!controller) return;

      switch (tool) {
        case 'layers':
          setLayersOpen((value) => !value);
          break;
        case 'isolate':
          if (controller.getIsolatedId() !== null) {
            controller.restoreIsolation();
          } else if (selectedId) {
            controller.isolateObject(selectedId, { reducedMotion });
          }
          break;
        case 'peel':
          // One button walks the sequence and wraps back to whole, so a peel
          // needs no second control to undo it on a narrow screen.
          if (!controller.nextPeel()) controller.resetPeel();
          break;
        case 'dissect':
          if (selectedId) controller.dissectObject(selectedId);
          break;
        case 'explode':
          if (controller.isExploded()) {
            controller.exitExplodedView();
          } else {
            controller.enterExplodedView();
          }
          break;
        case 'reset':
          controller.resetScene({ reducedMotion });
          break;
        default:
          break;
      }
    },
    [controller, selectedId, reducedMotion],
  );

  const contextPanel = (
    <ContextPanel
      selectedId={selectedId}
      object={selectedObject}
      trail={trail}
      childObjects={childNodes}
      relationships={relationships}
      onSelectObject={focusObject}
      onAction={handleAction}
      onManipulate={handleManipulate}
      manipulation={{
        isolate: capabilities.supportsIsolation,
        hide: sceneReady,
        ghost: capabilities.supportsGhosting,
        dissect: capabilities.supportsDissection,
        restore: (snapshot?.manipulation && controller?.getNextReconstructionStage() !== null) ?? false,
      }}
      actionsEnabled={sceneReady}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ---- workspace bar ---- */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-2 py-1.5">
        {diagnostic ? (
          <span className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="font-mono text-xs font-medium tracking-wide text-warning">
              {DIAGNOSTIC_LABEL}
            </span>
            <Badge tone="warning">Diagnostic content</Badge>
          </span>
        ) : (
          <ModelSwitcher modelRef={activeModel} onSelect={handleModelChange} />
        )}

        <SpatialSearch
          onSearch={runSearch}
          onSelect={focusObject}
          disabled={!sceneReady}
          className="ml-2 w-full max-w-[13rem] sm:max-w-xs"
        />

        <div className="ml-auto flex items-center gap-1">
          {snapshot?.canUndo || snapshot?.canRedo ? (
            <>
              <IconButton
                icon="undo"
                label="Undo manipulation"
                disabled={!snapshot?.canUndo}
                onClick={() => controller?.undoManipulation()}
              />
              <IconButton
                icon="redo"
                label="Redo manipulation"
                disabled={!snapshot?.canRedo}
                onClick={() => controller?.redoManipulation()}
              />
            </>
          ) : null}
          <IconButton
            icon="layers"
            label={layersOpen ? 'Hide layers' : 'Show layers'}
            active={layersOpen}
            onClick={() => setLayersOpen((value) => !value)}
            className="xl:hidden"
          />
          <IconButton
            icon="info"
            label={contextOpen ? 'Hide details' : 'Show details'}
            active={contextOpen}
            onClick={() => setContextOpen((value) => !value)}
            className="xl:hidden"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SpatialToolbar
          state={{
            mode: interactionMode,
            capabilities,
            hasSelection: selectedId !== null,
            layersOpen,
            isolated: snapshot?.manipulation.isolatedId !== null,
            exploded: snapshot?.manipulation.exploded ?? false,
            peelLevel: snapshot?.manipulation.peelLevel ?? 0,
            peelSteps: snapshot?.peelSteps ?? 0,
          }}
          onModeChange={(mode: InteractionMode) => setInteractionMode(mode)}
          onAction={handleTool}
          disabled={!sceneReady}
        />

        {/* ---- canvas column ---- */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-[16rem] flex-1 bg-obsidian">
            {controller ? (
              <WorkspaceCanvas
                diagnostic={diagnostic}
                status={status}
                error={error}
                progress={progress}
                activeModel={activeModel}
                assetUrl={assetUrl}
                meshMapping={meshMapping}
                controller={controller}
                visual={snapshot?.visual ?? EMPTY_VISUAL}
                offsets={offsets}
                interactionMode={interactionMode}
                reducedMotion={reducedMotion}
                onUnmappedMeshes={setUnmapped}
                onRegistryReady={setRegistrySize}
                onContextLost={() => setContextLost(true)}
                onRetry={retry}
              />
            ) : (
              <CanvasMessage>
                <ErrorState
                  className="max-w-lg"
                  title="Spatial engine unavailable"
                  description="No spatial provider is registered for this environment, so the engine cannot start."
                />
              </CanvasMessage>
            )}

            {diagnostic ? (
              <p className="veo-glass pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg px-3 py-2 text-[11px] leading-relaxed text-warning">
                <strong className="font-semibold">{DIAGNOSTIC_LABEL}</strong> — an abstract
                calibration scene used to verify the renderer, camera, registry, selection and
                disposal. It is diagnostic content, not a subject model.
              </p>
            ) : null}

            {unmapped.length > 0 ? (
              <p className="veo-glass pointer-events-none absolute right-3 top-3 max-w-xs rounded-lg px-3 py-2 text-[11px] leading-relaxed text-warning">
                {unmapped.length} mesh{unmapped.length === 1 ? '' : 'es'} have no semantic mapping
                and cannot be selected. Update the model manifest to address them.
              </p>
            ) : null}

            {contextLost ? (
              <div className="absolute inset-0 grid place-items-center bg-obsidian/85 p-6">
                <ErrorState
                  className="max-w-md"
                  title="3D rendering was interrupted"
                  description="The browser released the WebGL context, usually because the device ran short of graphics memory. Reloading the model restarts the renderer."
                  action={
                    <Button
                      size="sm"
                      onClick={() => {
                        setContextLost(false);
                        retry();
                      }}
                    >
                      Restart renderer
                    </Button>
                  }
                />
              </div>
            ) : null}

            {/* Keyboard-accessible camera controls, outside the canvas. */}
            {sceneReady && controller ? (
              <ViewportControls
                className="absolute bottom-3 left-1/2 -translate-x-1/2"
                onResetView={() => controller.resetScene({ reducedMotion })}
                onFitModel={() => controller.fitToModel({ reducedMotion })}
                onFitSelection={() => controller.fitToSelection({ reducedMotion })}
                onClearSelection={() => controller.select(null)}
                hasSelection={selectedId !== null}
              />
            ) : null}

            {layersOpen ? (
              <div className="veo-glass absolute bottom-16 left-3 right-3 z-10 max-h-[55%] overflow-y-auto rounded-xl p-3 sm:right-auto sm:w-64">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                    Layers
                  </h2>
                  <IconButton
                    icon="close"
                    label="Close layers"
                    size="sm"
                    onClick={() => setLayersOpen(false)}
                  />
                </div>
                <LayersPanel
                  layers={graph?.layers ?? []}
                  stateOf={(layerId) => controller?.getLayerState(layerId) ?? 'visible'}
                  peeledLayerIds={peeledLayerIds}
                  onShow={(layerId) => controller?.showLayer(layerId)}
                  onHide={(layerId) => controller?.hideLayer(layerId)}
                  onGhost={(layerId) => controller?.ghostLayer(layerId)}
                />
              </div>
            ) : null}
          </div>

          {/*
            Selection feedback outside the canvas.
            The canvas is aria-hidden, so this live region is how a screen
            reader learns that the selection changed.
          */}
          <p aria-live="polite" className="veo-sr-only">
            {selectedId ? `Selected ${semanticIdToLabel(selectedId)}` : 'No structure selected'}
          </p>

          <AIStudyPanel
            selectedId={selectedId}
            modelName={diagnostic ? DIAGNOSTIC_LABEL : (provider?.getModel()?.name ?? null)}
            aiConfigured={aiConfigured}
            hasModel={sceneReady && !diagnostic}
            className="shrink-0"
          />
        </div>

        {/* ---- context panel: column at xl, drawer below ---- */}
        <aside
          aria-label="Structure details"
          className="hidden w-80 shrink-0 border-l border-hairline p-4 xl:block"
        >
          {contextPanel}
        </aside>
      </div>

      <Drawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        title="Structure details"
        side="bottom"
        className="xl:hidden"
      >
        {contextPanel}
      </Drawer>
    </div>
  );
}

const EMPTY_LAYER_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_OFFSETS: ReadonlyMap<SemanticId, readonly [number, number, number]> = new Map();
const EMPTY_PEELED: readonly string[] = [];
const EMPTY_VISUAL: SceneVisualState = {
  states: new Map(),
  isolatedId: null,
  hiddenLayerIds: EMPTY_LAYER_SET,
  ghostedLayerIds: EMPTY_LAYER_SET,
  peelLevel: 0,
  dissectedIds: [],
  exploded: false,
};

/**
 * Canvas region.
 *
 * Every non-ready state is explicit. There is no path here that renders
 * substitute geometry: when no licensed asset exists, VEO says so.
 */
function WorkspaceCanvas({
  diagnostic,
  offsets,
  status,
  error,
  progress,
  activeModel,
  assetUrl,
  meshMapping,
  controller,
  visual,
  interactionMode,
  reducedMotion,
  onUnmappedMeshes,
  onRegistryReady,
  onContextLost,
  onRetry,
}: {
  readonly diagnostic: boolean;
  readonly status: ReturnType<typeof useAnatomyModel>['status'];
  readonly error: ReturnType<typeof useAnatomyModel>['error'];
  readonly progress: ReturnType<typeof useAnatomyModel>['progress'];
  readonly activeModel: string | null;
  readonly assetUrl: string | null;
  readonly meshMapping: ReadonlyMap<string, SemanticId>;
  readonly controller: NonNullable<ReturnType<typeof useAnatomyModel>['controller']>;
  readonly visual: SceneVisualState;
  readonly offsets: ReadonlyMap<SemanticId, readonly [number, number, number]>;
  readonly interactionMode: string;
  readonly reducedMotion: boolean;
  readonly onUnmappedMeshes: (names: readonly string[]) => void;
  readonly onRegistryReady: (count: number) => void;
  readonly onContextLost: () => void;
  readonly onRetry: () => void;
}) {
  const stage = (
    <ViewportShell
      assetUrl={assetUrl}
      meshMapping={meshMapping}
      visual={visual}
      offsets={offsets}
      controller={controller}
      interactionMode={interactionMode}
      reducedMotion={reducedMotion}
      onUnmappedMeshes={onUnmappedMeshes}
      onRegistryReady={onRegistryReady}
      onContextLost={onContextLost}
      diagnostic={diagnostic}
    />
  );

  if (diagnostic) return stage;

  if (!activeModel) {
    return (
      <CanvasMessage>
        <div className="max-w-sm text-center">
          <h2 className="text-sm font-semibold text-ink">Choose a model to explore</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Pick a model from the switcher above. VEO loads it through the provider layer and maps
            it onto permanent semantic identity before you interact with it.
          </p>
        </div>
      </CanvasMessage>
    );
  }

  if (status === 'not_configured') {
    return (
      <CanvasMessage>
        <NotConfiguredState
          className="max-w-lg"
          title="3D model unavailable"
          description={
            error?.message ??
            'VEO renders licensed spatial assets through its provider layer. This environment has no asset source attached. VEO does not substitute generated geometry for real anatomy, so nothing is shown here.'
          }
          requirement="NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL"
        />
      </CanvasMessage>
    );
  }

  if (status === 'error') {
    return (
      <CanvasMessage>
        <ErrorState
          className="max-w-lg"
          title="3D model unavailable"
          description={error?.userMessage ?? 'The spatial model could not be loaded.'}
          detail={error?.message}
          action={
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      </CanvasMessage>
    );
  }

  if (status === 'initialising' || status === 'loading' || !assetUrl) {
    const percent = progress.ratio === null ? null : Math.round(progress.ratio * 100);
    return (
      <CanvasMessage>
        <LoadingState
          label={percent === null ? `Loading model (${progress.phase})` : `Loading model — ${percent}%`}
        />
      </CanvasMessage>
    );
  }

  return stage;
}

function CanvasMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="grid size-full place-items-center p-6">
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}
