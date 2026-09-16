'use client';

import dynamic from 'next/dynamic';
import { LoadingState } from '@/components/ui/states';
import type { SpatialViewportProps } from './SpatialViewport';

/**
 * Lazy boundary for the 3D viewport.
 *
 * three.js, React Three Fiber and drei together are the heaviest dependency in
 * the application. Loading them through `next/dynamic` with `ssr: false` keeps
 * them out of the initial bundle entirely, so routes that never mount a
 * viewport pay nothing for it — and large spatial assets are never touched
 * during application boot.
 */
const SpatialViewport = dynamic(
  () => import('./SpatialViewport').then((mod) => mod.SpatialViewport),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-[26rem] place-items-center rounded-xl border border-[--color-hairline]">
        <LoadingState label="Starting 3D engine" />
      </div>
    ),
  },
);

export function ViewportShell(props: SpatialViewportProps) {
  return <SpatialViewport {...props} />;
}
