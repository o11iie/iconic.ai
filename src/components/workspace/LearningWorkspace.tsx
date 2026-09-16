'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Overlay';
import { IconButton } from '@/components/ui/IconButton';
import { ErrorState, LoadingState, NotConfiguredState } from '@/components/ui/states';
import { ViewportShell } from '@/components/spatial/ViewportShell';
import { useAnatomyModel } from '@/hooks/use-anatomy-model';
import { cn } from '@/lib/cn';
import type { SemanticId } from '@/lib/semantic-id';
import type { BoundingBox } from '@/types/domain/spatial';
import type { InteractionMode } from '@/engine/spatial/types';
import { useReducedMotion } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { AIStudyPanel } from './AIStudyPanel';
import { ContextPanel, type ContextAction } from './ContextPanel';
import { LayersPanel } from './LayersPanel';
import { ModelSwitcher } from './ModelSwitcher';
import { SpatialToolbar } from './SpatialToolbar';

/**
 * The VEO learning workspace.
 *
 * Layout priority is the whole design: the viewport takes every pixel the
 * chrome does not need. Tools are a 52px rail, the context panel is a fixed
 * 20rem column that collapses to a drawer below `xl`, and the study bar is a
 * single row. Nothing scrolls the page — the model never becomes a thumbnail
 * inside a document.
 *
 * The model is resolved exactly once here and passed down, so mounting the
 * stage can never trigger a second download of the same asset.
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
  const selectInStore = useViewerStore((s) => s.select);

  // The URL is the source of truth for which model is open, so the workspace
  // is linkable and survives a refresh.
  const urlModel = searchParams.get('model');
  const activeModel = diagnostic ? null : (urlModel ?? modelRef);

  const { provider, status, snapshot, progress, error, assetUrl, meshMapping, retry } =
    useAnatomyModel(activeModel);

  const [modelBox, setModelBox] = useState<BoundingBox | null>(null);
  const [unmapped, setUnmapped] = useState<readonly string[]>([]);
  const [layersOpen, setLayersOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);

  const selectedId = snapshot?.selectedId ?? null;
  const providerCapabilities = provider?.getStatus().capabilities;
  const graph = snapshot?.graph ?? null;
  const hiddenLayerIds = snapshot?.visual.hiddenLayerIds ?? new Set<string>();

  const handleSelect = useCallback(
    (id: SemanticId | null) => {
      provider?.select(id);
      selectInStore(id);
      // On narrow screens a selection is worthless if the panel describing it
      // is off-screen, so reveal it.
      if (id && window.matchMedia('(max-width: 1279px)').matches) setContextOpen(true);
    },
    [provider, selectInStore],
  );

  const handleHover = useCallback(
    (id: SemanticId | null) => {
      (provider as { setHovered?: (value: SemanticId | null) => void } | null)?.setHovered?.(id);
    },
    [provider],
  );

  const resolveBox = useCallback(
    (id: string) => provider?.getBoundingBox(id as SemanticId) ?? null,
    [provider],
  );

  const relationships = useMemo(
    () => (selectedId && provider ? provider.getRelatedStructures(selectedId) : []),
    [provider, selectedId],
  );

  const metadata = useMemo(
    () => (selectedId && provider ? provider.getStructureMetadata(selectedId) : null),
    [provider, selectedId],
  );

  const selectedObject = useMemo(
    () => (selectedId && provider ? provider.getStructure(selectedId) : null),
    [provider, selectedId],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      setModelRef(nextModel);
      router.replace(`/explore?model=${encodeURIComponent(nextModel)}`, { scroll: false });
    },
    [router, setModelRef],
  );

  const handleAction = useCallback((action: ContextAction) => {
    // Study actions are implemented in the gate that builds generation and
    // scheduling. They are surfaced here because the context panel must be
    // able to accept real SpatialObject data now; each reports honestly
    // rather than appearing to succeed.
    setContextOpen(false);
    void action;
  }, []);

  const contextPanel = (
    <ContextPanel
      selectedId={selectedId}
      object={selectedObject}
      metadata={metadata}
      relationships={relationships}
      onSelectRelated={(id) => {
        handleSelect(id);
        provider?.flyTo(id, { reducedMotion });
      }}
      onAction={handleAction}
      actionsEnabled={status === 'ready'}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ---- workspace bar ---- */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-2 py-1.5">
        <ModelSwitcher modelRef={activeModel} onSelect={handleModelChange} />

        {diagnostic ? <Badge tone="warning">Pipeline diagnostic</Badge> : null}

        <div className="ml-auto flex items-center gap-1">
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
          mode={interactionMode}
          onModeChange={(mode: InteractionMode) => setInteractionMode(mode)}
          onIsolate={() => selectedId && provider?.isolate(selectedId)}
          onReset={() => {
            provider?.restore();
            provider?.resetCamera({ reducedMotion });
          }}
          onToggleLayers={() => setLayersOpen((value) => !value)}
          layersOpen={layersOpen}
          canIsolate={providerCapabilities?.supportsIsolation ?? false}
          hasSelection={selectedId !== null}
          disabled={status !== 'ready' && !diagnostic}
        />

        {/* ---- canvas column ---- */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-[16rem] flex-1 bg-obsidian">
            <WorkspaceCanvas
              diagnostic={diagnostic}
              status={status}
              error={error}
              progress={progress}
              activeModel={activeModel}
              assetUrl={assetUrl}
              meshMapping={meshMapping}
              snapshot={snapshot}
              modelBox={modelBox}
              reducedMotion={reducedMotion}
              selectable={interactionMode !== 'orbit'}
              resolveBox={resolveBox}
              onSelect={handleSelect}
              onHover={handleHover}
              onModelBounds={setModelBox}
              onUnmappedMeshes={setUnmapped}
              onRetry={retry}
            />

            {diagnostic ? (
              <p className="veo-glass pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg px-3 py-2 text-[11px] leading-relaxed text-warning">
                Render pipeline diagnostic. An abstract calibration object used to verify WebGL,
                lighting, materials and the camera rig. It is not anatomical content.
              </p>
            ) : null}

            {unmapped.length > 0 ? (
              <p className="veo-glass pointer-events-none absolute right-3 top-3 max-w-xs rounded-lg px-3 py-2 text-[11px] leading-relaxed text-warning">
                {unmapped.length} mesh{unmapped.length === 1 ? '' : 'es'} have no semantic mapping
                and cannot be selected. Update the model manifest to address them.
              </p>
            ) : null}

            {layersOpen ? (
              <div className="veo-glass absolute bottom-3 left-3 z-10 max-h-[60%] w-64 overflow-y-auto rounded-xl p-3">
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
                  hiddenLayerIds={hiddenLayerIds}
                  onToggle={(layerId) =>
                    (
                      provider as { setLayerVisible?: (id: string, visible: boolean) => void } | null
                    )?.setLayerVisible?.(layerId, hiddenLayerIds.has(layerId))
                  }
                />
              </div>
            ) : null}
          </div>

          <AIStudyPanel
            selectedId={selectedId}
            modelName={provider?.getModel()?.name ?? null}
            aiConfigured={aiConfigured}
            hasModel={status === 'ready'}
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

/**
 * Canvas region.
 *
 * Every non-ready state is explicit. There is no path here that renders
 * substitute geometry: when no licensed asset exists, VEO says so.
 */
function WorkspaceCanvas({
  diagnostic,
  status,
  error,
  progress,
  activeModel,
  assetUrl,
  meshMapping,
  snapshot,
  modelBox,
  reducedMotion,
  selectable,
  resolveBox,
  onSelect,
  onHover,
  onModelBounds,
  onUnmappedMeshes,
  onRetry,
}: {
  readonly diagnostic: boolean;
  readonly status: ReturnType<typeof useAnatomyModel>['status'];
  readonly error: ReturnType<typeof useAnatomyModel>['error'];
  readonly progress: ReturnType<typeof useAnatomyModel>['progress'];
  readonly activeModel: string | null;
  readonly assetUrl: string | null;
  readonly meshMapping: ReadonlyMap<string, SemanticId>;
  readonly snapshot: ReturnType<typeof useAnatomyModel>['snapshot'];
  readonly modelBox: BoundingBox | null;
  readonly reducedMotion: boolean;
  readonly selectable: boolean;
  readonly resolveBox: (id: string) => BoundingBox | null;
  readonly onSelect: (id: SemanticId | null) => void;
  readonly onHover: (id: SemanticId | null) => void;
  readonly onModelBounds: (box: BoundingBox) => void;
  readonly onUnmappedMeshes: (names: readonly string[]) => void;
  readonly onRetry: () => void;
}) {
  const emptyVisual = useMemo(
    () => ({ states: new Map(), isolatedId: null, hiddenLayerIds: new Set<string>() }),
    [],
  );

  const stage = (
    <ViewportShell
      assetUrl={assetUrl}
      meshMapping={meshMapping}
      visual={snapshot?.visual ?? emptyVisual}
      camera={snapshot?.camera ?? null}
      modelBox={modelBox}
      reducedMotion={reducedMotion}
      selectable={selectable}
      resolveBox={resolveBox}
      onSelect={onSelect}
      onHover={onHover}
      onModelBounds={onModelBounds}
      onUnmappedMeshes={onUnmappedMeshes}
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
    <div className={cn('grid size-full place-items-center p-6')}>
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}
