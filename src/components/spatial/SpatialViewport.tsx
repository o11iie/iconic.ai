'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Box3 } from 'three';
import { MappedModel } from '@/engine/3d/scene/MappedModel';
import { SpatialCameraRig } from '@/engine/3d/camera/SpatialCameraRig';
import { SpatialCanvas } from '@/engine/3d/canvas/SpatialCanvas';
import { PipelineDiagnostic } from '@/engine/3d/diagnostics/PipelineDiagnostic';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState, NotConfiguredState } from '@/components/ui/states';
import { useAnatomyModel } from '@/hooks/use-anatomy-model';
import type { SemanticId } from '@/lib/semantic-id';
import type { BoundingBox } from '@/types/domain/spatial';
import { useViewerStore } from '@/store/viewer-store';
import { useReducedMotion } from '@/store/ui-store';
import { ViewportControls } from './ViewportControls';
import { StructureInspector } from './StructureInspector';

/**
 * The VEO spatial viewport.
 *
 * This is the real thing: it loads a licensed asset through the provider layer,
 * maps vendor meshes onto VEO semantic identity, and drives selection,
 * highlighting, isolation, ghosting and camera framing against that identity.
 *
 * When no licensed asset is configured it says exactly that. It does NOT
 * substitute generated geometry — see the note on the diagnostic mode below.
 */

export interface SpatialViewportProps {
  readonly modelRef: string | null;
  /**
   * Renders the isolated render-pipeline diagnostic instead of a model.
   * The caller is responsible for labelling it as a diagnostic; it is an
   * abstract calibration object and is never anatomy.
   */
  readonly diagnostic?: boolean;
  readonly className?: string;
}

export function SpatialViewport({ modelRef, diagnostic = false, className }: SpatialViewportProps) {
  const { provider, status, snapshot, progress, error, assetUrl, meshMapping, retry } =
    useAnatomyModel(diagnostic ? null : modelRef);

  const reducedMotion = useReducedMotion();
  const showLabels = useViewerStore((s) => s.showLabels);
  const setShowLabels = useViewerStore((s) => s.setShowLabels);
  const setSelectedInStore = useViewerStore((s) => s.select);
  const [modelBox, setModelBox] = useState<BoundingBox | null>(null);
  const [unmapped, setUnmapped] = useState<readonly string[]>([]);

  const selectedId = snapshot?.selectedId ?? null;
  const isIsolated = snapshot?.visual.isolatedId != null;
  const capabilities = provider?.getStatus().capabilities;

  const handleSelect = useCallback(
    (semanticId: SemanticId | null) => {
      provider?.select(semanticId);
      setSelectedInStore(semanticId);
    },
    [provider, setSelectedInStore],
  );

  const handleHover = useCallback(
    (semanticId: SemanticId | null) => {
      // setHovered lives on the scene-graph base class, not the public
      // provider interface, so it is called through a narrow guard.
      const hoverable = provider as { setHovered?: (id: SemanticId | null) => void } | null;
      hoverable?.setHovered?.(semanticId);
    },
    [provider],
  );

  const resolveBox = useCallback(
    (id: string) => provider?.getBoundingBox(id as SemanticId) ?? null,
    [provider],
  );

  const handleModelBounds = useCallback((box: Box3) => {
    setModelBox({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    });
  }, []);

  const relationships = useMemo(
    () => (selectedId && provider ? provider.getRelatedStructures(selectedId) : []),
    [provider, selectedId],
  );

  const metadata = useMemo(
    () => (selectedId && provider ? provider.getStructureMetadata(selectedId) : null),
    [provider, selectedId],
  );

  // ---- diagnostic mode ------------------------------------------------------
  if (diagnostic) {
    return (
      <div className={className}>
        <div className="relative h-full w-full overflow-hidden rounded-xl border border-[--color-hairline] bg-[--color-obsidian]">
          <SpatialCanvas
            className="h-full w-full"
            ariaLabel="Render pipeline diagnostic — abstract calibration object, not anatomical content"
            unsupported={(reason) => (
              <ErrorState title="3D is unavailable on this device" description={reason} />
            )}
          >
            <PipelineDiagnostic />
            <SpatialCameraRig
              command={null}
              resolveBox={() => null}
              modelBox={null}
              reducedMotion={reducedMotion}
            />
          </SpatialCanvas>

          <p className="veo-glass absolute left-3 top-3 max-w-xs rounded-lg px-3 py-2 text-[11px] leading-relaxed text-[--color-warning]">
            Render pipeline diagnostic. This is an abstract calibration object used to verify WebGL,
            lighting, materials and the camera rig. It is not anatomical content.
          </p>
        </div>
      </div>
    );
  }

  // ---- honest non-ready states ---------------------------------------------
  if (status === 'idle') {
    return (
      <div className={className}>
        <div className="grid h-full place-items-center rounded-xl border border-dashed border-[--color-hairline-strong]">
          <p className="p-8 text-center text-sm text-[--color-ink-muted]">
            Select a model to begin exploring.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'not_configured') {
    return (
      <div className={className}>
        <NotConfiguredState
          title="No licensed spatial model is configured"
          description={
            error?.message ??
            'VEO renders licensed anatomy assets through its provider layer. This environment has no asset source attached, and VEO does not substitute generated geometry for real anatomy.'
          }
          requirement="NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL"
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={className}>
        <ErrorState
          title="This model could not be loaded"
          description={error?.userMessage ?? 'The spatial model failed to load.'}
          detail={error?.message}
          action={
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (status === 'initialising' || status === 'loading' || !assetUrl) {
    const percent = progress.ratio === null ? null : Math.round(progress.ratio * 100);
    return (
      <div className={className}>
        <div className="grid h-full place-items-center rounded-xl border border-[--color-hairline]">
          <LoadingState
            label={
              percent === null
                ? `Loading model (${progress.phase})`
                : `Loading model — ${percent}%`
            }
          />
        </div>
      </div>
    );
  }

  // ---- ready ----------------------------------------------------------------
  return (
    <div className={className}>
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="relative min-h-[26rem] overflow-hidden rounded-xl border border-[--color-hairline] bg-[--color-obsidian]">
          <SpatialCanvas
            className="h-full w-full"
            unsupported={(reason) => (
              <div className="grid h-full place-items-center p-6">
                <ErrorState title="3D is unavailable on this device" description={reason} />
              </div>
            )}
          >
            <MappedModel
              assetUrl={assetUrl}
              meshMapping={meshMapping}
              visual={
                snapshot?.visual ?? {
                  states: new Map(),
                  isolatedId: null,
                  hiddenLayerIds: new Set(),
                }
              }
              onSelect={handleSelect}
              onHover={handleHover}
              onUnmappedMeshes={setUnmapped}
              onModelBounds={handleModelBounds}
            />
            <SpatialCameraRig
              command={snapshot?.camera ?? null}
              resolveBox={resolveBox}
              modelBox={modelBox}
              reducedMotion={reducedMotion}
            />
          </SpatialCanvas>

          <ViewportControls
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
            onReset={() => provider?.resetCamera({ reducedMotion })}
            onFit={() => provider?.fitToSelection({ reducedMotion })}
            onIsolate={() => selectedId && provider?.isolate(selectedId)}
            onRestore={() => provider?.restore()}
            onToggleLabels={() => setShowLabels(!showLabels)}
            showLabels={showLabels}
            hasSelection={selectedId !== null}
            isIsolated={isIsolated}
            canIsolate={capabilities?.supportsIsolation ?? false}
          />

          {unmapped.length > 0 ? (
            <p className="veo-glass absolute right-3 top-3 max-w-xs rounded-lg px-3 py-2 text-[11px] leading-relaxed text-[--color-warning]">
              {unmapped.length} mesh{unmapped.length === 1 ? '' : 'es'} in this asset have no
              semantic mapping and cannot be selected. Update the model manifest to address them.
            </p>
          ) : null}
        </div>

        <aside
          aria-label="Structure inspector"
          className="veo-panel overflow-y-auto rounded-xl"
        >
          <StructureInspector
            selectedId={selectedId}
            metadata={metadata}
            relationships={relationships}
            onSelectRelated={(id) => {
              handleSelect(id);
              provider?.flyTo(id, { reducedMotion });
            }}
          />
        </aside>
      </div>
    </div>
  );
}
