'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { SpatialCanvas } from '@/engine/3d/canvas/SpatialCanvas';
import { SpatialCameraRig } from '@/engine/3d/camera/SpatialCameraRig';
import { SpatialSceneRoot } from '@/engine/3d/scene/SpatialSceneRoot';
import { ModelLoader } from '@/engine/3d/scene/ModelLoader';
import { buildDiagnosticScene, DIAGNOSTIC_LABEL } from '@/engine/3d/diagnostics/diagnostic-scene';
import { boundsOf } from '@/engine/3d/bounds';
import { EngineDebugBridge } from '@/engine/3d/diagnostics/EngineDebugBridge';
import { registerSceneDebug } from '@/engine/3d/diagnostics/engine-debug';
import { ErrorState } from '@/components/ui/states';
import type { SceneController } from '@/engine/spatial/scene-controller';
import type { SceneVisualState } from '@/engine/spatial/types';
import type { SemanticId } from '@/lib/semantic-id';
import type { BoundingBox } from '@/types/domain/spatial';

/**
 * The 3D stage.
 *
 * Purely presentational: it owns no loading policy and no provider. The
 * workspace resolves the model once and passes the result down, so mounting
 * the stage can never trigger a second download of the same asset.
 *
 * Both content paths — a licensed GLTF asset and the diagnostic scene — hand
 * the same `Object3D` to the same `SpatialSceneRoot`, taking an identical path
 * through registration, interaction, materials and disposal. Verifying the
 * engine against a scene that bypassed the production path would prove nothing.
 */

export interface SpatialStageProps {
  readonly assetUrl: string | null;
  readonly meshMapping: ReadonlyMap<string, SemanticId>;
  readonly visual: SceneVisualState;
  readonly controller: SceneController;
  readonly interactionMode: string;
  readonly reducedMotion: boolean;
  readonly onUnmappedMeshes?: (names: readonly string[]) => void;
  readonly onRegistryReady?: (count: number) => void;
  readonly onContextLost?: () => void;
  /** Mounts the labelled VEO SPATIAL ENGINE TEST scene instead of a model. */
  readonly diagnostic?: boolean;
}

export function SpatialStage({
  assetUrl,
  meshMapping,
  visual,
  controller,
  interactionMode,
  reducedMotion,
  onUnmappedMeshes,
  onRegistryReady,
  onContextLost,
  diagnostic = false,
}: SpatialStageProps) {
  // The loaded scene is stored WITH the url it came from, so switching models
  // drops the previous scene by derivation rather than by an effect that
  // clears state after the fact — which would render the old model for a frame.
  const [loaded, setLoaded] = useState<{ url: string; root: THREE.Object3D } | null>(null);
  const [modelBox, setModelBox] = useState<BoundingBox | null>(null);

  /**
   * `sceneEpoch` exists so verification can exercise the real replacement
   * path: bumping it rebuilds the diagnostic group, and the scene root's
   * cleanup disposes the previous one exactly as a model switch would.
   */
  const [sceneEpoch, setSceneEpoch] = useState(0);

  // Rebuilt per epoch. Disposed by the scene root like any other content.
  const diagnosticRoot = useMemo(
    () => (diagnostic ? buildDiagnosticScene() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagnostic, sceneEpoch],
  );

  const loadedRoot = loaded && loaded.url === assetUrl ? loaded.root : null;
  const root = diagnostic ? diagnosticRoot : loadedRoot;

  const resolveBox = useCallback(
    (id: string) => {
      const entry = controller.registry.get(id as SemanticId);
      return entry ? boundsOf(entry.node as unknown as THREE.Object3D) : null;
    },
    [controller],
  );

  /** Expose engine state for automated verification, diagnostic mode only. */
  useEffect(() => {
    if (!diagnostic) return;

    return registerSceneDebug(
      () => {
        const snapshot = controller.getSnapshot();
        const visualStates: Record<string, string> = {};
        for (const [id, state] of snapshot.visual.states) visualStates[id] = state;

        return {
          registry: controller.registry.ids(),
          selectedId: snapshot.selectedId,
          hoveredId: snapshot.hoveredId,
          visualStates,
          materialOverrides: 0,
          lifecycle: snapshot.lifecycle.phase,
          sceneEpoch,
        };
      },
      {
        replaceScene: () => setSceneEpoch((value) => value + 1),
        select: (id) => controller.select(id as never),
        resetCamera: () => {
          controller.restore();
          controller.resetCamera({ durationMs: 0 });
        },
        fitModel: () => controller.fitToModel({ durationMs: 0 }),
        fitSelection: () => controller.fitToSelection({ durationMs: 0 }),
      },
    );
  }, [diagnostic, controller, sceneEpoch]);

  const handleLoaded = useCallback(
    (next: THREE.Object3D) => {
      if (assetUrl) setLoaded({ url: assetUrl, root: next });
    },
    [assetUrl],
  );

  return (
    <SpatialCanvas
      className="size-full"
      ariaLabel={
        diagnostic
          ? `${DIAGNOSTIC_LABEL} — diagnostic calibration scene, not subject content`
          : 'Interactive 3D model viewport'
      }
      {...(onContextLost ? { onContextLost } : {})}
      unsupported={(reason) => (
        <div className="grid size-full place-items-center p-6">
          <ErrorState title="3D is unavailable on this device" description={reason} />
        </div>
      )}
    >
      {!diagnostic && assetUrl ? (
        <Suspense fallback={null}>
          <ModelLoader assetUrl={assetUrl} onLoaded={handleLoaded} />
        </Suspense>
      ) : null}

      <SpatialSceneRoot
        root={root}
        {...(diagnostic ? {} : { meshMapping })}
        controller={controller}
        visual={visual}
        interactionMode={interactionMode}
        onModelBounds={setModelBox}
        {...(onUnmappedMeshes ? { onUnmappedMeshes } : {})}
        {...(onRegistryReady ? { onRegistryReady } : {})}
      />

      {diagnostic ? <EngineDebugBridge /> : null}

      <SpatialCameraRig
        command={controller.getCameraCommand()}
        resolveBox={resolveBox}
        modelBox={modelBox}
        reducedMotion={reducedMotion}
      />
    </SpatialCanvas>
  );
}
