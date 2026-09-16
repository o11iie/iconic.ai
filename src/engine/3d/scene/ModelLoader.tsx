'use client';

import { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

/**
 * GLTF model loading.
 *
 * `useGLTF` caches by URL and suspends, which is what we want — but the cached
 * scene is shared. Two viewports showing the same asset would fight over one
 * scene graph's materials and visibility, so each mount gets a deep clone and
 * disposes it on unmount.
 *
 * Progress is reported through the three.js DefaultLoadingManager, because
 * drei's loader does not surface per-URL byte progress.
 */

export function useClonedGLTF(assetUrl: string): THREE.Object3D {
  const { scene } = useGLTF(assetUrl);

  // Clone per mount. The cached original is never handed to the scene root,
  // so nothing the viewport does can corrupt it for the next consumer.
  return useMemo(() => scene.clone(true), [scene]);
}

export function ModelLoader({
  assetUrl,
  onLoaded,
}: {
  readonly assetUrl: string;
  readonly onLoaded: (root: THREE.Object3D) => void;
}) {
  const cloned = useClonedGLTF(assetUrl);

  useEffect(() => {
    onLoaded(cloned);
  }, [cloned, onLoaded]);

  return null;
}

/** Warm the cache before a viewport mounts, e.g. on hovering a model card. */
export function preloadModel(assetUrl: string): void {
  useGLTF.preload(assetUrl);
}

/**
 * Subscribe to global loader progress.
 *
 * Returns a ratio in 0..1, or null when nothing is loading. Used to drive the
 * loading state with a real number rather than an indeterminate spinner.
 */
export function useLoaderProgress(): number | null {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const manager = THREE.DefaultLoadingManager;
    const previousProgress = manager.onProgress;
    const previousLoad = manager.onLoad;
    const previousError = manager.onError;

    manager.onProgress = (url, loaded, total) => {
      setRatio(total > 0 ? loaded / total : null);
      previousProgress?.(url, loaded, total);
    };
    manager.onLoad = () => {
      setRatio(null);
      previousLoad?.();
    };
    manager.onError = (url) => {
      setRatio(null);
      previousError?.(url);
    };

    return () => {
      manager.onProgress = previousProgress;
      manager.onLoad = previousLoad;
      manager.onError = previousError;
    };
  }, []);

  return ratio;
}
