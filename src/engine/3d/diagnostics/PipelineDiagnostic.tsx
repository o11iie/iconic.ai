'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';

/**
 * ============================================================================
 * RENDER PIPELINE DIAGNOSTIC — NOT ANATOMICAL CONTENT
 * ============================================================================
 *
 * This is a calibration target, not a model of anything. Its only job is to
 * prove that the WebGL context, camera rig, lighting, material pipeline and
 * animation loop are all functioning, on a machine where no licensed asset is
 * configured.
 *
 * It is deliberately an abstract wireframe reference object — axes, a unit
 * grid and a marker — so that it can never be mistaken for, or quietly
 * repurposed as, anatomy.
 *
 * Rules:
 *   * It is NEVER rendered inside an anatomy learning surface.
 *   * It is gated behind NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC.
 *   * Every surface that mounts it must label it visibly as a diagnostic.
 *   * VEO does not substitute generated geometry for licensed anatomy. A model
 *     made of primitives would look complete while teaching nothing true.
 * ============================================================================
 */
export function PipelineDiagnostic() {
  const markerRef = useRef<THREE.Mesh>(null);

  // Rotation proves the animation loop and invalidation are alive.
  useFrame((_, delta) => {
    if (markerRef.current) markerRef.current.rotation.y += delta * 0.4;
  });

  return (
    <group>
      {/* Reference grid — establishes scale and confirms depth testing. */}
      <gridHelper args={[4, 16, '#1e293b', '#111827']} position={[0, -1, 0]} />

      {/* World axes — confirms coordinate orientation (Y-up, right-handed). */}
      <axesHelper args={[1.5]} />

      {/* Calibration marker: wireframe only, so it reads as an instrument. */}
      <mesh ref={markerRef}>
        <icosahedronGeometry args={[0.85, 1]} />
        <meshBasicMaterial color="#3b82f6" wireframe />
      </mesh>

      {/* Lit inner surface — confirms the standard material + lighting path. */}
      <mesh scale={0.45}>
        <icosahedronGeometry args={[0.85, 2]} />
        <meshStandardMaterial color="#22d3ee" roughness={0.35} metalness={0.1} />
      </mesh>
    </group>
  );
}
