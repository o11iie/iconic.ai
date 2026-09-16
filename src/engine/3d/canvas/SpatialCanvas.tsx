'use client';

import { Suspense, useCallback, useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import type * as THREE from 'three';
import { detectWebGL } from '../webgl';
import {
  FRAMELOOP,
  configureRenderer,
  resolveDevicePixelRatio,
  shouldAntialias,
} from '../renderer/renderer-config';

/**
 * The VEO 3D surface.
 *
 * Responsibilities kept deliberately narrow: detect WebGL, establish a
 * colour-correct render context, provide neutral studio lighting, and suspend
 * cleanly while assets stream. It knows nothing about anatomy or any other
 * domain.
 *
 * Renders on demand rather than continuously. A static model has no reason to
 * redraw at 60fps; interaction, camera transitions and state changes call
 * `invalidate()` explicitly.
 */

export interface SpatialCanvasProps {
  readonly children: ReactNode;
  /** Rendered while suspended children load. */
  readonly fallback?: ReactNode;
  /** Rendered instead of the canvas when WebGL is unavailable. */
  readonly unsupported?: (reason: string) => ReactNode;
  readonly className?: string;
  readonly cameraFov?: number;
  readonly ariaLabel: string;
  /** Called if the WebGL context is lost, so the UI can recover honestly. */
  readonly onContextLost?: () => void;
}

export function SpatialCanvas({
  children,
  fallback = null,
  unsupported,
  className,
  cameraFov = 45,
  ariaLabel,
  onContextLost,
}: SpatialCanvasProps) {
  const support = useMemo(() => detectWebGL(), []);

  const pixelRatio = useMemo(
    () =>
      resolveDevicePixelRatio(
        typeof window === 'undefined' ? 1 : window.devicePixelRatio,
        // Treat few-core devices as low power: they are also the devices most
        // likely to lose a WebGL context under memory pressure.
        { lowPower: typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4 },
      ),
    [],
  );

  const handleCreated = useCallback(
    ({ gl }: { gl: THREE.WebGLRenderer }) => {
      configureRenderer(gl);

      const canvas = gl.domElement;
      const onLost = (event: Event) => {
        // Preventing default lets the browser attempt restoration instead of
        // leaving a permanently dead canvas.
        event.preventDefault();
        onContextLost?.();
      };
      canvas.addEventListener('webglcontextlost', onLost, false);
    },
    [onContextLost],
  );

  if (!support.supported) {
    return <>{unsupported?.(support.reason) ?? null}</>;
  }

  return (
    <div className={className} role="region" aria-label={ariaLabel}>
      <Canvas
        dpr={pixelRatio}
        camera={{ position: [0, 0.6, 3.2], fov: cameraFov, near: 0.01, far: 1000 }}
        gl={{
          antialias: shouldAntialias(pixelRatio),
          alpha: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
        }}
        frameloop={FRAMELOOP.mode}
        onCreated={handleCreated}
        // The canvas is decorative to assistive technology: the surrounding
        // interface carries the information. Claiming otherwise would be a
        // false accessibility promise.
        aria-hidden="true"
      >
        <StudioLighting />
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
      {fallback}
    </div>
  );
}

/**
 * Neutral three-point lighting.
 *
 * Scientific models must read accurately, so this avoids coloured key lights
 * that would tint tissue or material colour, and avoids dramatic contrast that
 * would hide detail in shadow.
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
