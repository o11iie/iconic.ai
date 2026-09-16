import type { BoundingBox, Vec3 } from '@/types/domain/spatial';

/**
 * Pure camera framing maths.
 *
 * Kept free of three.js and React so it can be unit-tested without a WebGL
 * context — camera framing is exactly the kind of code that silently breaks.
 */

export function boxCenter(box: BoundingBox): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

export function boxSize(box: BoundingBox): Vec3 {
  return [
    Math.abs(box.max[0] - box.min[0]),
    Math.abs(box.max[1] - box.min[1]),
    Math.abs(box.max[2] - box.min[2]),
  ];
}

/** Largest edge of the box; the dimension that must fit in frame. */
export function boxMaxExtent(box: BoundingBox): number {
  const [x, y, z] = boxSize(box);
  return Math.max(x, y, z);
}

/**
 * Distance at which a box of the given extent exactly fills the vertical field
 * of view, scaled by `padding` (1.0 = tight, 1.5 = comfortable breathing room).
 */
export function fitDistance(
  extent: number,
  fovDegrees: number,
  padding = 1.5,
  aspect = 1,
): number {
  const safeExtent = Math.max(extent, 1e-4);
  const vFov = (fovDegrees * Math.PI) / 180;
  const distanceForHeight = safeExtent / (2 * Math.tan(vFov / 2));

  // When the viewport is narrower than it is tall, width becomes the binding
  // constraint and the camera must pull further back.
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-4));
  const distanceForWidth = safeExtent / (2 * Math.tan(hFov / 2));

  return Math.max(distanceForHeight, distanceForWidth) * padding;
}

/**
 * Camera position that frames `box`, approached from the current camera
 * direction so the view rotates as little as possible — abrupt reframing is
 * disorienting when you are trying to learn where something sits.
 */
export function framePosition(
  box: BoundingBox,
  from: Vec3,
  fovDegrees: number,
  padding = 1.5,
  aspect = 1,
): { position: Vec3; target: Vec3 } {
  const target = boxCenter(box);
  const distance = fitDistance(boxMaxExtent(box), fovDegrees, padding, aspect);

  let dir: Vec3 = [from[0] - target[0], from[1] - target[1], from[2] - target[2]];
  const length = Math.hypot(dir[0], dir[1], dir[2]);

  // Degenerate case: camera sits exactly on the target. Fall back to a
  // three-quarter view, which reads better than a flat axis-aligned one.
  dir = length < 1e-6 ? [0.6, 0.4, 1] : [dir[0] / length, dir[1] / length, dir[2] / length];
  const norm = Math.hypot(dir[0], dir[1], dir[2]);

  return {
    target,
    position: [
      target[0] + (dir[0] / norm) * distance,
      target[1] + (dir[1] / norm) * distance,
      target[2] + (dir[2] / norm) * distance,
    ],
  };
}

/** Cubic ease-in-out. Smooth acceleration reads as deliberate, not floaty. */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Union of two boxes. Used to frame multi-object selections. */
export function unionBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/**
 * Zoom limits derived from the model itself.
 *
 * Hard-coded min/max distances only work for one model size. A molecule and a
 * cathedral need wildly different limits, so both are expressed as multiples
 * of the model's own extent:
 *
 *   min — close enough to inspect a small feature, far enough that the near
 *         plane does not clip through the surface
 *   max — far enough to see the whole thing with room around it, near enough
 *         that the model never becomes an unusable speck
 */
export function zoomLimitsFor(
  extent: number,
  fovDegrees = 45,
  aspect = 1,
): { min: number; max: number } {
  const safeExtent = Number.isFinite(extent) && extent > 0 ? extent : 1;
  const fitted = fitDistance(safeExtent, fovDegrees, 1, aspect);

  return {
    min: Math.max(safeExtent * 0.05, 1e-3),
    max: fitted * 6,
  };
}

/** Clamp a distance into the model's zoom range. */
export function clampDistance(distance: number, limits: { min: number; max: number }): number {
  if (!Number.isFinite(distance)) return limits.min;
  return Math.min(Math.max(distance, limits.min), limits.max);
}

/**
 * The opening view.
 *
 * A three-quarter view from slightly above reads as a considered presentation
 * rather than an accidental one, and it reveals depth immediately — a
 * straight-on axis view makes a 3D model look like a picture of itself.
 */
export function initialFraming(
  box: BoundingBox,
  fovDegrees = 45,
  aspect = 1,
  padding = 1.6,
): { position: Vec3; target: Vec3 } {
  const target = boxCenter(box);
  const distance = fitDistance(boxMaxExtent(box), fovDegrees, padding, aspect);

  // Normalised three-quarter direction: right, above, and in front.
  const dir: Vec3 = [0.55, 0.42, 0.72];
  const length = Math.hypot(dir[0], dir[1], dir[2]);

  return {
    target,
    position: [
      target[0] + (dir[0] / length) * distance,
      target[1] + (dir[1] / length) * distance,
      target[2] + (dir[2] / length) * distance,
    ],
  };
}

/** True when a box has real volume; guards fitting against degenerate input. */
export function isUsableBox(box: BoundingBox | null): box is BoundingBox {
  if (!box) return false;
  const [x, y, z] = boxSize(box);
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    Math.max(x, y, z) > 1e-6
  );
}

/**
 * Expand a box by a uniform margin.
 *
 * Framing a structure exactly to its bounds leaves it touching the edge of the
 * viewport, which reads as cramped. A small margin makes framing feel composed.
 */
export function expandBox(box: BoundingBox, factor: number): BoundingBox {
  const center = boxCenter(box);
  const [sx, sy, sz] = boxSize(box);
  const half: Vec3 = [(sx * factor) / 2, (sy * factor) / 2, (sz * factor) / 2];

  return {
    min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
    max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
  };
}
