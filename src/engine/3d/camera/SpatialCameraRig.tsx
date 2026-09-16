'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraCommand } from '@/engine/spatial/scene-controller';
import type { CameraPose } from '@/engine/spatial/types';
import type { BoundingBox, Vec3 } from '@/types/domain/spatial';
import {
  boxMaxExtent,
  clampDistance,
  easeInOutCubic,
  expandBox,
  framePosition,
  initialFraming,
  isUsableBox,
  lerpVec3,
  zoomLimitsFor,
} from './camera-math';

/**
 * Camera rig: orbit, pan, zoom, reset, fit-to-model, fit-to-selection and
 * animated fly-to.
 *
 * The scene controller issues camera *intents*; this component owns the actual
 * camera. That split is what lets an SDK-backed provider (which owns its own
 * camera) and an asset-backed provider (which does not) expose one API upward.
 *
 * Zoom limits are derived from the loaded model rather than hard-coded, so the
 * same rig works for a molecule and a building. Transitions run entirely inside
 * `useFrame` and never call `setState`, so animating the camera causes zero
 * React re-renders.
 */

export interface SpatialCameraRigProps {
  readonly command: CameraCommand | null;
  /** Resolve a bounding box for a semantic id. */
  readonly resolveBox: (id: string) => BoundingBox | null;
  /** Box enclosing the whole model, used by reset and fit-to-model. */
  readonly modelBox: BoundingBox | null;
  readonly home?: CameraPose;
  /** Snap instead of animating, for prefers-reduced-motion. */
  readonly reducedMotion?: boolean;
  readonly enabled?: boolean;
  /** Fired once the rig has framed a newly loaded model. */
  readonly onInitialFraming?: () => void;
}

interface Tween {
  readonly fromPosition: Vec3;
  readonly toPosition: Vec3;
  readonly fromTarget: Vec3;
  readonly toTarget: Vec3;
  readonly durationMs: number;
  readonly startedAt: number;
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
  onInitialFraming,
}: SpatialCameraRigProps) {
  const controlsRef = useRef<OrbitControlsRef>(null);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  const tween = useRef<Tween | null>(null);
  const lastVersion = useRef<number>(-1);
  const framedBox = useRef<BoundingBox | null>(null);

  const aspect = size.height === 0 ? 1 : size.width / size.height;

  /** Zoom limits track the model, so they change when the model changes. */
  const zoomLimits = useMemo(() => {
    const extent = isUsableBox(modelBox) ? boxMaxExtent(modelBox) : 2;
    return zoomLimitsFor(extent, camera.fov ?? home.fov, aspect);
  }, [modelBox, camera.fov, home.fov, aspect]);

  const applyPose = useCallback(
    (position: Vec3, target: Vec3) => {
      const controls = controlsRef.current;
      if (!controls) return;
      camera.position.set(...position);
      controls.target.set(...target);
      controls.update();
      invalidate();
    },
    [camera, invalidate],
  );

  const startTween = useCallback(
    (destination: { position: Vec3; target: Vec3 }, options: CameraCommand['options']) => {
      const controls = controlsRef.current;
      if (!controls) return;

      const snap =
        reducedMotion || options.reducedMotion === true || options.durationMs === 0;

      if (snap) {
        applyPose(destination.position, destination.target);
        tween.current = null;
        return;
      }

      tween.current = {
        fromPosition: [camera.position.x, camera.position.y, camera.position.z],
        toPosition: destination.position,
        fromTarget: [controls.target.x, controls.target.y, controls.target.z],
        toTarget: destination.target,
        durationMs: options.durationMs ?? 700,
        startedAt: performance.now(),
      };
      invalidate();
    },
    [applyPose, camera, invalidate, reducedMotion],
  );

  /**
   * Frame a newly loaded model automatically.
   *
   * Without this the learner opens a model and sees either the inside of it or
   * an empty view, depending on how the asset was authored.
   */
  useEffect(() => {
    if (!isUsableBox(modelBox)) return;
    if (framedBox.current === modelBox) return;
    framedBox.current = modelBox;

    const destination = initialFraming(modelBox, camera.fov ?? home.fov, aspect);
    applyPose(destination.position, destination.target);
    onInitialFraming?.();
  }, [modelBox, camera.fov, home.fov, aspect, applyPose, onInitialFraming]);

  /** Execute camera intents. */
  useEffect(() => {
    if (!command || command.version === lastVersion.current) return;
    lastVersion.current = command.version;

    const controls = controlsRef.current;
    if (!controls) return;

    const fov = camera.fov ?? home.fov;
    const currentPosition: Vec3 = [camera.position.x, camera.position.y, camera.position.z];

    let destination: { position: Vec3; target: Vec3 } | null = null;

    if (command.kind === 'reset' || command.kind === 'fit_model') {
      destination = isUsableBox(modelBox)
        ? framePosition(modelBox, currentPosition, fov, command.options.padding ?? 1.6, aspect)
        : { position: home.position, target: home.target };

      // Reset returns to the considered opening view rather than merely
      // re-fitting from wherever the learner happens to be orbiting.
      if (command.kind === 'reset' && isUsableBox(modelBox)) {
        destination = initialFraming(modelBox, fov, aspect, command.options.padding ?? 1.6);
      }
    } else if (command.targetId) {
      const box = resolveBox(command.targetId);
      if (isUsableBox(box)) {
        destination = framePosition(
          expandBox(box, 1.25),
          currentPosition,
          fov,
          command.options.padding ?? 1.9,
          aspect,
        );
      }
    }

    // Nothing to frame: leave the camera exactly where it is rather than
    // jumping somewhere arbitrary.
    if (!destination) return;

    startTween(destination, command.options);
  }, [command, camera, home, modelBox, aspect, resolveBox, startTween]);

  /**
   * Advance the transition.
   *
   * Deliberately mutates the camera directly. Driving a camera tween through
   * React state would re-render the tree on every frame.
   */
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

    if (elapsed >= active.durationMs) {
      tween.current = null;
    } else {
      invalidate();
    }
  });

  // Keep the camera inside the model's zoom range when the model changes.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const offset = camera.position.clone().sub(controls.target);
    const clamped = clampDistance(offset.length(), zoomLimits);

    if (Math.abs(clamped - offset.length()) > 1e-4) {
      offset.setLength(clamped);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      invalidate();
    }
  }, [zoomLimits, camera, invalidate]);

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={enabled}
      enablePan
      enableZoom
      enableRotate
      // Damping makes inspection feel controlled rather than twitchy, but it
      // requires a frame after each input, so it is paired with invalidate().
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      makeDefault
      minDistance={zoomLimits.min}
      maxDistance={zoomLimits.max}
      // Touch: one finger orbits, two fingers pinch-zoom and pan — the gesture
      // vocabulary of every map and model viewer, so it needs no explanation.
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      onChange={() => invalidate()}
    />
  );
}
