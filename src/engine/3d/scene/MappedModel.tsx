'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { SemanticId } from '@/lib/semantic-id';
import type { SceneVisualState, VisualState } from '@/engine/spatial/types';
import {
  applyVisualState,
  disposeClonedMaterials,
  type VisualColorPalette,
} from '../materials/visual-materials';

/**
 * Renders a loaded GLB/GLTF asset and binds it to VEO semantic identity.
 *
 * The important work here is the mapping pass: every mesh in the vendor asset
 * is tagged with the VEO semantic id declared for it in the model manifest.
 * After that pass, nothing downstream — selection, highlighting, questions,
 * memory state — ever refers to a vendor mesh name again.
 *
 * Meshes with no mapping stay visible but inert: they cannot be selected, and
 * they are reported through `onUnmappedMeshes` so gaps in a manifest surface
 * during authoring instead of silently swallowing clicks.
 */

export interface MappedModelProps {
  readonly assetUrl: string;
  readonly meshMapping: ReadonlyMap<string, SemanticId>;
  readonly visual: SceneVisualState;
  readonly palette?: VisualColorPalette;
  readonly onSelect?: (semanticId: SemanticId | null) => void;
  readonly onHover?: (semanticId: SemanticId | null) => void;
  readonly onUnmappedMeshes?: (meshNames: readonly string[]) => void;
  readonly onModelBounds?: (box: THREE.Box3) => void;
}

const SEMANTIC_KEY = 'veoSemanticId';

export function MappedModel({
  assetUrl,
  meshMapping,
  visual,
  palette,
  onSelect,
  onHover,
  onUnmappedMeshes,
  onModelBounds,
}: MappedModelProps) {
  const { scene } = useGLTF(assetUrl);
  const rootRef = useRef<THREE.Group>(null);

  // Clone per mount: useGLTF caches by URL, and two viewports must not fight
  // over one scene graph's materials and visibility.
  const model = useMemo(() => scene.clone(true), [scene]);

  // Tag meshes with semantic identity before the first paint.
  useLayoutEffect(() => {
    const unmapped: string[] = [];

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const semanticId = meshMapping.get(child.name) ?? null;
      child.userData[SEMANTIC_KEY] = semanticId;
      if (semanticId === null) unmapped.push(child.name);
    });

    if (unmapped.length > 0) onUnmappedMeshes?.(unmapped);

    const box = new THREE.Box3().setFromObject(model);
    if (!box.isEmpty()) onModelBounds?.(box);
  }, [model, meshMapping, onUnmappedMeshes, onModelBounds]);

  // Apply visual state whenever it changes.
  useEffect(() => {
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const semanticId = child.userData[SEMANTIC_KEY] as SemanticId | null;
      const state: VisualState = semanticId ? (visual.states.get(semanticId) ?? 'default') : 'default';
      applyVisualState(child, state, palette);
    });
  }, [model, visual, palette]);

  // Release cloned materials so repeated model switches do not leak GPU memory.
  useEffect(() => {
    const current = model;
    return () => {
      disposeClonedMaterials(current);
    };
  }, [model]);

  const semanticIdFor = (event: ThreeEvent<PointerEvent | MouseEvent>): SemanticId | null => {
    const object = event.object;
    if (!(object instanceof THREE.Mesh)) return null;
    return (object.userData[SEMANTIC_KEY] as SemanticId | null) ?? null;
  };

  return (
    <group ref={rootRef}>
      <primitive
        object={model}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          const semanticId = semanticIdFor(event);
          if (!semanticId) return;
          event.stopPropagation();
          onHover?.(semanticId);
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover?.(null);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          const semanticId = semanticIdFor(event);
          // A click that hits no mapped structure clears selection rather than
          // leaving a stale one highlighted.
          event.stopPropagation();
          onSelect?.(semanticId);
        }}
      />
    </group>
  );
}

/** Warm the GLTF cache ahead of mounting a viewport. */
export function preloadModel(assetUrl: string): void {
  useGLTF.preload(assetUrl);
}
