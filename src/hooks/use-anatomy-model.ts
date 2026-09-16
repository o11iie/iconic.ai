'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getAnatomyProvider } from '@/anatomy/providers/registry';
import type { AnatomyProvider } from '@/anatomy/providers/anatomy-provider';
import {
  isObservableProvider,
  type ProviderSnapshot,
} from '@/engine/spatial/base-provider';
import { isSceneGraphProvider } from '@/engine/spatial/provider';
import type { SceneController } from '@/engine/spatial/scene-controller';
import type { SpatialError } from '@/engine/spatial/errors';
import { IDLE_PROGRESS, type LoadProgress } from '@/engine/spatial/types';
import type { SemanticId } from '@/lib/semantic-id';
import { useViewerStore } from '@/store/viewer-store';

/**
 * Binds an anatomy provider to React.
 *
 * Handles the full honest lifecycle: not-configured, loading (with progress),
 * failed (with the provider's real reason), and ready. Nothing here invents a
 * model — if the provider cannot supply one, that fact is returned.
 */

export type ModelStatus = 'idle' | 'initialising' | 'not_configured' | 'loading' | 'ready' | 'error';

export interface AnatomyModelResult {
  readonly provider: AnatomyProvider | null;
  /**
   * The provider's scene controller, when it renders into VEO's own scene.
   *
   * Surfaced here rather than reached for through the provider so the
   * renderer binds to a typed handle, and so an SDK-backed provider that owns
   * its renderer correctly returns null.
   */
  readonly controller: SceneController | null;
  readonly status: ModelStatus;
  readonly snapshot: ProviderSnapshot | null;
  readonly progress: LoadProgress;
  readonly error: SpatialError | null;
  readonly assetUrl: string | null;
  readonly meshMapping: ReadonlyMap<string, SemanticId>;
  readonly retry: () => void;
}

const EMPTY_MAPPING: ReadonlyMap<string, SemanticId> = new Map();

export function useAnatomyModel(modelRef: string | null): AnatomyModelResult {
  // Only the *asynchronous* phases live in state. "idle" is derived below from
  // the absence of a provider or a model, so entering it never needs a
  // synchronous setState inside an effect (which would cascade renders).
  const [phase, setStatus] = useState<ModelStatus>('idle');
  const [error, setError] = useState<SpatialError | null>(null);
  const [progress, setProgress] = useState<LoadProgress>(IDLE_PROGRESS);
  const [attempt, setAttempt] = useState(0);
  const setViewerError = useViewerStore((s) => s.setError);

  // Provider construction can throw on misconfiguration (unknown provider id).
  // That is a deployment bug and must surface, not crash the render.
  const provider = useMemo<AnatomyProvider | null>(() => {
    try {
      return getAnatomyProvider();
    } catch {
      return null;
    }
  }, []);

  const observable = provider && isObservableProvider(provider) ? provider : null;

  const subscribe = useCallback(
    (listener: () => void) => observable?.subscribe(listener) ?? (() => {}),
    [observable],
  );
  const getSnapshot = useCallback(() => observable?.getSnapshot() ?? null, [observable]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Nothing to load: the derived status below already reports 'idle'.
    if (!provider || !modelRef) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    let cancelled = false;

    async function load(activeProvider: AnatomyProvider, ref: string) {
      setStatus('initialising');
      setError(null);
      setViewerError(null);

      const initialised = await activeProvider.initialize();
      if (cancelled) return;

      if (!initialised.ok) {
        setError(initialised.error);
        setStatus(
          initialised.error.code === 'provider_not_configured' ? 'not_configured' : 'error',
        );
        setViewerError(initialised.error.userMessage);
        return;
      }

      setStatus('loading');

      const result = await activeProvider.loadModel(ref, {
        signal: controller.signal,
        onProgress: (next) => {
          if (!cancelled) setProgress(next);
        },
      });
      if (cancelled) return;

      if (!result.ok) {
        setError(result.error);
        setStatus('error');
        setViewerError(result.error.userMessage);
        return;
      }

      setStatus('ready');
    }

    void load(provider, modelRef);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [provider, modelRef, attempt, setViewerError]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const status: ModelStatus = !provider || !modelRef ? 'idle' : phase;

  // Only a scene-graph provider exposes an asset URL; an SDK-backed one renders
  // itself and correctly reports null here.
  const sceneGraph =
    provider && 'getAssetUrl' in provider
      ? (provider as AnatomyProvider & {
          getAssetUrl: () => string | null;
          getMeshMapping: () => ReadonlyMap<string, SemanticId>;
        })
      : null;

  const controller = provider && isSceneGraphProvider(provider) ? provider.scene : null;

  return {
    provider,
    controller,
    status,
    snapshot,
    progress,
    error,
    assetUrl: status === 'ready' ? (sceneGraph?.getAssetUrl() ?? null) : null,
    meshMapping: sceneGraph?.getMeshMapping() ?? EMPTY_MAPPING,
    retry,
  };
}
