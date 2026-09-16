'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { registerCanvasDebug } from './engine-debug';

/**
 * Publishes live camera and GPU-memory state for automated verification.
 *
 * Mounted inside the Canvas only when the diagnostic flag is enabled. Reads
 * `gl.info.memory`, which is the renderer's own accounting of live geometries
 * and textures — the only trustworthy way to assert that replacing a model
 * actually freed its GPU resources.
 *
 * Contains no `useFrame` and no state: it exposes getters, so observing the
 * engine cannot itself cause renders.
 */
export function EngineDebugBridge() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3 }
    | null;

  useEffect(() => {
    return registerCanvasDebug(
      () => {
        const target = controls?.target;
        const position: [number, number, number] = [
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ];
        const targetVec: [number, number, number] = target
          ? [target.x, target.y, target.z]
          : [0, 0, 0];

        return {
          position,
          target: targetVec,
          distance: Math.hypot(
            position[0] - targetVec[0],
            position[1] - targetVec[1],
            position[2] - targetVec[2],
          ),
          fov: camera.fov ?? 45,
        };
      },
      () => ({
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        drawCalls: gl.info.render.calls,
      }),
    );
  }, [gl, camera, controls]);

  return null;
}
