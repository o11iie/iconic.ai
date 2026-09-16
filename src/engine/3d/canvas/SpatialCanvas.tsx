'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { detectWebGL } from '../webgl';

/**
 * The VEO 3D surface.
 *
 * Responsibilities kept deliberately narrow: detect WebGL, establish a
 * colour-correct render context, provide neutral studio lighting, and suspend
 * cleanly while assets stream. It knows nothing about anatomy or any other
 * domain.
 */

export interface SpatialCanvasProps {
  readonly children: ReactNode;
  /** Rendered while suspended children load. */
  readonly fallback?: ReactNode;
  /** Rendered instead of the canvas when WebGL is unavailable. */
  readonly unsupported?: (reason: string) => ReactNode;
  readonly className?: string;
  /** Cap device pixel ratio; high-DPI displays otherwise cost 4x fill rate. */
  readonly maxDpr?: number;
  readonly cameraFov?: number;
  readonly ariaLabel?: string;
}

export function SpatialCanvas({
  children,
  fallback = null,
  unsupported,
  className,
  maxDpr = 2,
  cameraFov = 45,
  ariaLabel = 'Interactive 3D model viewport',
}: SpatialCanvasProps) {
  const support = useMemo(() => detectWebGL(), []);

  if (!support.supported) {
    return <>{unsupported?.(support.reason) ?? null}</>;
  }

  return (
    <div className={className} role="region" aria-label={ariaLabel}>
      <Canvas
        dpr={[1, maxDpr]}
        camera={{ position: [0, 0.6, 3.2], fov: cameraFov, near: 0.01, far: 1000 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          // Keep the buffer for screenshot/export features later.
          preserveDrawingBuffer: false,
        }}
        // Render on demand: a static model should not burn a laptop battery at
        // 60fps. Interaction and animation invalidate explicitly.
        frameloop="demand"
      >
        <StudioLighting />
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
      {fallback}
    </div>
  );
}

/**
 * Neutral three-point lighting. Scientific models must read accurately, so this
 * avoids coloured key lights that would tint tissue or material colour.
 */
function StudioLighting() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <directionalLight position={[-4, 2, -3]} intensity={0.55} />
      <directionalLight position={[0, -3, 2]} intensity={0.3} />
    </>
  );
}
