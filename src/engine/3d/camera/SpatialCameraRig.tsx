'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type * as THREE from 'three';
import type { CameraCommand } from '@/engine/spatial/base-provider';
import type { CameraPose } from '@/engine/spatial/types';
import type { BoundingBox, Vec3 } from '@/types/domain/spatial';
import { easeInOutCubic, framePosition, lerpVec3 } from './camera-math';

/**
 * Camera rig: orbit, pan, zoom, reset, fit-to-selection and animated fly-to.
 *
 * The provider issues camera *intents*; this component owns the actual camera.
 * That split lets an SDK-backed provider (which owns its own camera) and an
 * asset-backed provider (which does not) expose the same API upward.
 */

export interface SpatialCameraRigProps {
  /** Latest camera intent from the provider. */
  readonly command: CameraCommand | null;
  /** Resolve a bounding box for a semantic id. */
  readonly resolveBox: (id: string) => BoundingBox | null;
  /** Box enclosing the whole model, used by reset. */
  readonly modelBox: BoundingBox | null;
  readonly home?: CameraPose;
  /** Snap instead of animating, for prefers-reduced-motion. */
  readonly reducedMotion?: boolean;
  readonly enabled?: boolean;
}

interface Tween {
  readonly fromPosition: Vec3;
  readonly toPosition: Vec3;
  readonly fromTarget: Vec3;
  readonly toTarget: Vec3;
  readonly durationMs: number;
  startedAt: number;
}

const DEFAULT_HOME: CameraPose = {
  position: [0, 0.6, 3.2],
  target: [0, 0, 0],
  fov: 45,
};

type OrbitControlsRef = React.ComponentRef<typeof OrbitControls>;

export function SpatialCameraRig({
  command,
  resolveBox,
  modelBox,
  home = DEFAULT_HOME,
  reducedMotion = false,
  enabled = true,
}: SpatialCameraRigProps) {
  const controlsRef = useRef<OrbitControlsRef>(null);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const tween = useRef<Tween | null>(null);
  const lastVersion = useRef<number>(-1);

  useEffect(() => {
    if (!command || command.version === lastVersion.current) return;
    lastVersion.current = command.version;

    const controls = controlsRef.current;
    if (!controls) return;

    const aspect = size.height === 0 ? 1 : size.width / size.height;
    const fov = camera.fov ?? home.fov;
    const currentPosition: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    const currentTarget: Vec3 = [controls.target.x, controls.target.y, controls.target.z];

    let destination: { position: Vec3; target: Vec3 } | null = null;

    if (command.kind === 'reset') {
      destination = modelBox
        ? framePosition(modelBox, currentPosition, fov, command.options.padding ?? 1.6, aspect)
        : { position: home.position, target: home.target };
    } else if (command.targetId) {
      const box = resolveBox(command.targetId);
      if (box) {
        destination = framePosition(
          box,
          currentPosition,
          fov,
          command.options.padding ?? 2.2,
          aspect,
        );
      }
    }

    // No geometry to frame: leave the camera exactly where it is rather than
    // jumping somewhere arbitrary.
    if (!destination) return;

    const snap = reducedMotion || command.options.reducedMotion || command.options.durationMs === 0;
    const durationMs = snap ? 0 : (command.options.durationMs ?? 700);

    if (durationMs === 0) {
      camera.position.set(...destination.position);
      controls.target.set(...destination.target);
      controls.update();
      tween.current = null;
      return;
    }

    tween.current = {
      fromPosition: currentPosition,
      toPosition: destination.position,
      fromTarget: currentTarget,
      toTarget: destination.target,
      durationMs,
      startedAt: performance.now(),
    };
  }, [command, camera, controlsRef, home, modelBox, reducedMotion, resolveBox, size]);

  useFrame(() => {
    const active = tween.current;
    const controls = controlsRef.current;
    if (!active || !controls) return;

    const elapsed = performance.now() - active.startedAt;
    const t = easeInOutCubic(elapsed / active.durationMs);

    const position = lerpVec3(active.fromPosition, active.toPosition, t);
    const target = lerpVec3(active.fromTarget, active.toTarget, t);

    camera.position.set(...position);
    controls.target.set(...target);
    controls.update();

    if (elapsed >= active.durationMs) tween.current = null;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={enabled}
      enablePan
      enableZoom
      enableRotate
      // Damping makes manual inspection feel controlled rather than twitchy.
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      makeDefault
      minDistance={0.05}
      maxDistance={500}
    />
  );
}
