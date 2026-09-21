'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { SpatialCanvas } from '@/engine/3d/canvas/SpatialCanvas';
import { SpatialCameraRig } from '@/engine/3d/camera/SpatialCameraRig';
import { SpatialSceneRoot } from '@/engine/3d/scene/SpatialSceneRoot';
import { ModelLoader } from '@/engine/3d/scene/ModelLoader';
import {
  buildDiagnosticGraph,
  buildDiagnosticScene,
  DIAGNOSTIC_LABEL,
} from '@/engine/3d/diagnostics/diagnostic-scene';
import { EngineDebugBridge } from '@/engine/3d/diagnostics/EngineDebugBridge';
import { registerSceneDebug } from '@/engine/3d/diagnostics/engine-debug';
import { ErrorState } from '@/components/ui/states';
import type { SceneController } from '@/engine/spatial/scene-controller';
import type { SceneVisualState } from '@/engine/spatial/types';
import { isSemanticId, type SemanticId } from '@/lib/semantic-id';
import type { BoundingBox } from '@/types/domain/spatial';
import type { MaterialStats } from '@/engine/3d/materials/material-state';
import type { TransformReader } from '@/engine/3d/transform-state';

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
  /** Manipulation displacements by semantic id. Empty when nothing is moved. */
  readonly offsets: ReadonlyMap<SemanticId, readonly [number, number, number]>;
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
  offsets,
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

  /** Live material bookkeeping, published by the scene root. */
  const materialStats = useRef<(() => MaterialStats) | null>(null);
  const readMaterialStats = useCallback((read: () => MaterialStats) => {
    materialStats.current = read;
  }, []);

  /** Live transform bookkeeping, published by the scene root. */
  const transforms = useRef<TransformReader | null>(null);
  const readTransformStats = useCallback((reader: TransformReader) => {
    transforms.current = reader;
  }, []);

  /**
   * A render node held across a model replacement.
   *
   * Kept as a real reference so verification can ask the registry to resolve
   * an object from a model that no longer exists. Diagnostic-only.
   */
  const capturedNode = useRef<Parameters<SceneController['registry']['resolve']>[0]>(null);

  // Rebuilt per epoch. Disposed by the scene root like any other content.
  const diagnosticRoot = useMemo(
    () => (diagnostic ? buildDiagnosticScene() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagnostic, sceneEpoch],
  );

  const loadedRoot = loaded && loaded.url === assetUrl ? loaded.root : null;
  const root = diagnostic ? diagnosticRoot : loadedRoot;

  /**
   * Publish the diagnostic model's semantic graph.
   *
   * Goes through the same `setGraph` entry point a manifest-loaded model uses,
   * so hierarchy, relationships, search and labels are exercised by the real
   * code path rather than a parallel one.
   */
  useEffect(() => {
    if (!diagnostic) return;
    controller.setGraph(buildDiagnosticGraph());
    return () => controller.setGraph(null);
  }, [diagnostic, controller, sceneEpoch]);

  /*
   * Camera framing reads bounds through the semantic API, not the registry.
   * The controller is where "what is this object's extent" is answered — it
   * knows that a grouping structure is framed by what it contains — and a
   * second implementation here would drift from it.
   */
  const resolveBox = useCallback(
    (id: string) => (isSemanticId(id) ? controller.getObjectBounds(id) : null),
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
          materialOverrides: materialStats.current?.().overrides ?? 0,
          materialTracked: materialStats.current?.().tracked ?? 0,
          lifecycle: snapshot.lifecycle.phase,
          sceneEpoch,
          generation: controller.registry.generation,
          revision: snapshot.revision,

          transformsTracked: transforms.current?.stats().tracked ?? 0,
          transformsDisplaced: transforms.current?.stats().displaced ?? 0,
          peelLevel: snapshot.manipulation.peelLevel,
          peelSteps: snapshot.peelSteps,
          isolatedId: snapshot.manipulation.isolatedId,
          dissectedIds: [...snapshot.manipulation.dissectedIds],
          hiddenIds: [...snapshot.manipulation.hiddenIds],
          ghostedIds: [...snapshot.manipulation.ghostedIds],
          hiddenLayerIds: [...snapshot.manipulation.hiddenLayerIds],
          ghostedLayerIds: [...snapshot.manipulation.ghostedLayerIds],
          exploded: snapshot.manipulation.exploded,
          capabilities: { ...snapshot.capabilities },
          canUndo: snapshot.canUndo,
          canRedo: snapshot.canRedo,
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

        focusObject: (id) =>
          isSemanticId(id) ? controller.focusObject(id, { durationMs: 0 }) : false,
        hide: (ids) => controller.hide(ids.filter(isSemanticId)),
        hierarchy: (id) => {
          if (!isSemanticId(id)) return { parent: null, ancestors: [], children: [] };
          return {
            parent: controller.registry.getParent(id),
            ancestors: controller.registry.getAncestors(id),
            children: controller.registry.getChildren(id),
          };
        },
        bounds: (id) => {
          if (!isSemanticId(id)) return null;
          const center = controller.getObjectCenter(id);
          const radius = controller.getObjectRadius(id);
          return center && radius !== null ? { center, radius } : null;
        },
        search: (query) => controller.search(query).map((result) => result.semanticId),
        captureNode: (id) => {
          if (!isSemanticId(id)) return false;
          const entry = controller.registry.get(id);
          capturedNode.current = entry ? entry.node : null;
          return entry !== undefined;
        },
        resolveCaptured: () => controller.registry.resolve(capturedNode.current),

        hideObject: (id) => (isSemanticId(id) ? controller.hideObject(id) : false),
        showObject: (id) => (isSemanticId(id) ? controller.showObject(id) : false),
        ghostObject: (id) => (isSemanticId(id) ? controller.ghostObject(id) : false),
        isolateObject: (id) =>
          isSemanticId(id) ? controller.isolateObject(id, { durationMs: 0 }) : false,
        restoreIsolation: () => controller.restoreIsolation(),
        dissect: (id) => (isSemanticId(id) ? controller.dissectObject(id) : false),
        restoreDissection: () => controller.restoreDissection(),
        resetDissection: () => controller.resetDissection(),
        showLayer: (layerId) => controller.showLayer(layerId),
        hideLayer: (layerId) => controller.hideLayer(layerId),
        ghostLayer: (layerId) => controller.ghostLayer(layerId),
        restoreLayer: (layerId) => controller.restoreLayer(layerId),
        layerState: (layerId) => controller.getLayerState(layerId),
        nextPeel: () => controller.nextPeel(),
        previousPeel: () => controller.previousPeel(),
        resetPeel: () => controller.resetPeel(),
        explode: () => controller.enterExplodedView(),
        implode: () => controller.exitExplodedView(),
        reconstructStep: () => controller.reconstructStep(),
        reconstructAll: () => controller.reconstructAll(),
        resetScene: () => controller.resetScene({ durationMs: 0 }),
        undo: () => controller.undoManipulation(),
        redo: () => controller.redoManipulation(),

        nodeTransform: (id) => {
          if (!isSemanticId(id)) return null;
          const entry = controller.registry.get(id);
          if (!entry) return null;

          const node = entry.node as unknown as THREE.Object3D;
          const base = transforms.current?.baseOf(node) ?? null;
          return {
            position: [node.position.x, node.position.y, node.position.z],
            base: base ? [base.x, base.y, base.z] : null,
          };
        },
        visualState: (id) =>
          isSemanticId(id)
            ? (controller.getSnapshot().visual.states.get(id) ?? null)
            : null,
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
        offsets={offsets}
        interactionMode={interactionMode}
        onModelBounds={setModelBox}
        {...(onUnmappedMeshes ? { onUnmappedMeshes } : {})}
        {...(onRegistryReady ? { onRegistryReady } : {})}
        {...(diagnostic
          ? { onMaterialStats: readMaterialStats, onTransformStats: readTransformStats }
          : {})}
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
