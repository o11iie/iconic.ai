'use client';

import dynamic from 'next/dynamic';
import { LoadingState } from '@/components/ui/states';
import type { SpatialStageProps } from './SpatialStage';

/**
 * Lazy boundary for the 3D engine.
 *
 * three.js, React Three Fiber and drei together are the heaviest dependency in
 * the application. Loading them through `next/dynamic` with `ssr: false` keeps
 * them out of the initial bundle, so the dashboard, library and recall routes
 * pay nothing for a viewport they never mount — and no spatial asset is
 * touched during application boot.
 */
const SpatialStage = dynamic(() => import('./SpatialStage').then((mod) => mod.SpatialStage), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center">
      <LoadingState label="Starting 3D engine" />
    </div>
  ),
});

export function ViewportShell(props: SpatialStageProps) {
  return <SpatialStage {...props} />;
}
