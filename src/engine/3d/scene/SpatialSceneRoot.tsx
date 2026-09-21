'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type * as THREE from 'three';
import type { SemanticId } from '@/lib/semantic-id';
import type { SceneController } from '@/engine/spatial/scene-controller';
import { buildRegistryFromMapping, collectMeshes, readTag } from '@/engine/spatial/object-registry';
import type { SceneVisualState } from '@/engine/spatial/types';
import type { BoundingBox } from '@/types/domain/spatial';
import { boundsOf, boundsOfAll } from '../bounds';
import { MaterialStateManager, type MaterialStats } from '../materials/material-state';
import { TransformStateManager, type TransformReader } from '../transform-state';
import { disposeObject3D } from '../disposal';
import { isClick, modeAllowsHover, modeAllowsSelection, type PointerOrigin } from '../interaction/pointer';

/**
 * Spatial Scene Root
 * ==================
 *
 * Where a loaded scene graph becomes an interactive VEO model.
 *
 * Responsibilities, in order:
 *   1. register every selectable node against its semantic identity
 *   2. report the model's real bounding box so the camera can frame it
 *   3. route pointer events through raycast resolution into scene state
 *   4. apply visual state to materials without corrupting the asset
 *   5. dispose every GPU resource when the model is replaced or unmounted
 *
 * It knows nothing about anatomy, chemistry or any other domain. It is handed
 * an `Object3D` and a mapping, and everything after that is semantic ids.
 */

export interface SpatialSceneRootProps {
  /** The loaded scene graph: a GLTF scene, or the diagnostic group. */
  readonly root: THREE.Object3D | null;
  /** Vendor mesh name to semantic id. Empty when nodes are pre-tagged. */
  readonly meshMapping?: ReadonlyMap<string, SemanticId>;
  /** Scene state owner. Selection and hover are written here, not to local state. */
  readonly controller: SceneController;
  readonly visual: SceneVisualState;
  /** Manipulation displacements by semantic id. Empty when nothing is moved. */
  readonly offsets: ReadonlyMap<SemanticId, readonly [number, number, number]>;
  readonly interactionMode: string;
  readonly onModelBounds: (box: BoundingBox | null) => void;
  readonly onUnmappedMeshes?: (names: readonly string[]) => void;
  readonly onRegistryReady?: (count: number) => void;
  /**
   * Publishes a live reader for material bookkeeping.
   *
   * Handed out as a getter rather than a snapshot so diagnostics can sample it
   * at any moment without this component re-rendering on every material
   * change — which would defeat the on-demand frame loop.
   */
  readonly onMaterialStats?: (read: () => MaterialStats) => void;
  /** Publishes a read-only view of transform bookkeeping. Diagnostics only. */
  readonly onTransformStats?: (reader: TransformReader) => void;
}

export function SpatialSceneRoot({
  root,
  meshMapping,
  controller,
  visual,
  offsets,
  interactionMode,
  onModelBounds,
  onUnmappedMeshes,
  onRegistryReady,
  onMaterialStats,
  onTransformStats,
}: SpatialSceneRootProps) {
  const invalidate = useThree((state) => state.invalidate);
  const materials = useMemo(() => new MaterialStateManager(), []);
  const transforms = useMemo(() => new TransformStateManager(), []);
  const pointerOrigin = useRef<PointerOrigin | null>(null);

  /**
   * Register the scene.
   *
   * Runs once per root. When nodes are already tagged (the diagnostic scene)
   * the mapping is empty and identities are read from the nodes themselves.
   */
  useEffect(() => {
    const registry = controller.registry;

    // Through the controller, not the registry: the controller owns the model
    // and re-attaches its descriptors, so this effect and the one publishing
    // the model can commit in either order.
    controller.beginRegistration();

    if (!root) {
      controller.setObjects([]);
      onModelBounds(null);
      return;
    }

    if (meshMapping && meshMapping.size > 0) {
      const built = buildRegistryFromMapping(root as never, meshMapping as never);
      for (const entry of built.all()) {
        registry.register(entry.semanticId, entry.node as never, entry.meshes as never);
      }
      for (const name of built.unmappedNames()) registry.recordUnmapped(name);
    } else {
      // Pre-tagged scene: group meshes by the identity already on them.
      const grouped = new Map<SemanticId, THREE.Object3D[]>();
      for (const mesh of collectMeshes(root as never) as unknown as THREE.Mesh[]) {
        const id = readTag(mesh as never);
        if (!id) {
          registry.recordUnmapped(mesh.name);
          continue;
        }
        const bucket = grouped.get(id) ?? [];
        bucket.push(mesh);
        grouped.set(id, bucket);
      }
      for (const [id, meshes] of grouped) {
        registry.register(id, meshes[0] as never, meshes as never);
      }
    }

    // The controller already holds the graph; registering nodes is what binds
    // those descriptors to real geometry. Re-declaring the universe here
    // narrows it to what actually rendered.
    if (controller.getGraph() === null) controller.setObjects(registry.ids());
    onRegistryReady?.(registry.size);

    const unmapped = registry.unmappedNames();
    if (unmapped.length > 0) onUnmappedMeshes?.(unmapped);

    /**
     * Real bounds from real geometry — never hard-coded coordinates, so the
     * same framing works for a diagnostic node and a licensed asset.
     *
     * Measured across the SELECTABLE objects rather than the whole root.
     * A scene routinely contains things that are not content: grids, axes,
     * lights, cameras and helper nodes. Framing the root would size the view
     * to the largest helper and leave the model small in the middle of it.
     */
    const selectableNodes = registry
      .all()
      .map((entry) => entry.node as unknown as THREE.Object3D);

    const contentBox = boundsOfAll(selectableNodes) ?? boundsOf(root);
    onModelBounds(contentBox);

    // No local state to bump: the controller notified its subscribers when
    // setObjects ran, and the canvas only needs one more frame.
    invalidate();
  }, [root, meshMapping, controller, onModelBounds, onUnmappedMeshes, onRegistryReady, invalidate]);

  /**
   * Install the live bounds resolver.
   *
   * The controller owns meaning and must stay free of three.js; this is the
   * seam through which it reads real geometry. Registered per root so a model
   * swap cannot leave the semantic API measuring disposed nodes.
   */
  useEffect(() => {
    controller.setBoundsResolver((semanticId) => {
      const entry = controller.registry.get(semanticId);
      return entry ? boundsOf(entry.node as unknown as THREE.Object3D) : null;
    });

    return () => controller.setBoundsResolver(null);
  }, [controller, root]);

  useEffect(() => {
    onMaterialStats?.(() => materials.stats);
  }, [materials, onMaterialStats]);

  useEffect(() => {
    onTransformStats?.(transforms.reader);
  }, [transforms, onTransformStats]);

  /**
   * Apply manipulation displacements.
   *
   * The offsets are a semantic answer — which structure moves how far — and
   * this is the only place they touch a transform. Nodes absent from the map
   * are returned to their authored position rather than left where a previous
   * view put them, so leaving an exploded view is a restore, not a second
   * displacement that happens to cancel the first.
   */
  useEffect(() => {
    if (!root) return;

    let changed = false;
    for (const entry of controller.registry.all()) {
      const node = entry.node as unknown as THREE.Object3D;
      const offset = offsets.get(entry.semanticId);

      if (offset) {
        if (transforms.apply(node, offset)) changed = true;
      } else if (transforms.reset(node)) {
        changed = true;
      }
    }

    if (changed) invalidate();
  }, [offsets, root, controller, transforms, invalidate]);

  /** Apply visual state whenever it changes. */
  useEffect(() => {
    if (!root) return;

    let changed = false;
    for (const entry of controller.registry.all()) {
      const state = visual.states.get(entry.semanticId) ?? 'default';
      for (const mesh of entry.meshes as unknown as THREE.Mesh[]) {
        if (materials.apply(mesh, state)) changed = true;
      }
    }

    // Only ask for a frame when something actually changed: under an
    // on-demand frame loop this is the difference between idle and busy.
    if (changed) invalidate();
  }, [visual, root, controller, materials, invalidate]);

  /**
   * Dispose on replacement or unmount.
   *
   * Overrides go first (ours), then the scene's own geometry, materials and
   * textures. Without this, every model switch leaks VRAM until the browser
   * drops the WebGL context.
   */
  useEffect(() => {
    const current = root;
    return () => {
      // Transforms first: disposal should see the geometry where the asset
      // put it, not where a manipulation left it.
      transforms.dispose();
      materials.dispose();
      if (current) disposeObject3D(current);
    };
  }, [root, materials, transforms]);

  const resolve = useCallback(
    (event: ThreeEvent<PointerEvent | MouseEvent>): SemanticId | null => {
      const hit = event.object as unknown as Parameters<typeof controller.registry.resolve>[0];
      return controller.registry.resolve(hit);
    },
    [controller],
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!modeAllowsHover(interactionMode)) return;
      const id = resolve(event);
      if (!id) return;
      event.stopPropagation();
      controller.setHovered(id);
    },
    [controller, interactionMode, resolve],
  );

  const handlePointerOut = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      controller.setHovered(null);
    },
    [controller],
  );

  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    pointerOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  }, []);

  /**
   * Selection happens on pointer-up, and only when the pointer barely moved.
   *
   * Selecting on click alone would mean every camera orbit that happens to end
   * over a structure changes the selection.
   */
  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!modeAllowsSelection(interactionMode)) return;

      const origin = pointerOrigin.current;
      pointerOrigin.current = null;
      if (!isClick(origin, { x: event.clientX, y: event.clientY })) return;

      const id = resolve(event);
      event.stopPropagation();
      controller.select(id);
    },
    [controller, interactionMode, resolve],
  );

  if (!root) return null;

  return (
    <group
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      // A pointer-up on empty space clears selection. Without this a learner
      // has no way to deselect except by reloading.
      onPointerMissed={(event) => {
        if (!modeAllowsSelection(interactionMode)) return;
        if (event.type !== 'pointerup') return;
        controller.select(null);
      }}
    >
      <primitive object={root} />
    </group>
  );
}
