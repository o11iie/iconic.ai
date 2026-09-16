import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '@/types/domain/spatial';
import {
  boxCenter,
  boxMaxExtent,
  boxSize,
  easeInOutCubic,
  fitDistance,
  framePosition,
  lerpVec3,
  unionBox,
} from './camera-math';

const unitBox: BoundingBox = { min: [-1, -1, -1], max: [1, 1, 1] };
const offsetBox: BoundingBox = { min: [2, 0, 0], max: [4, 2, 2] };

describe('box maths', () => {
  it('computes centre, size and max extent', () => {
    expect(boxCenter(unitBox)).toEqual([0, 0, 0]);
    expect(boxCenter(offsetBox)).toEqual([3, 1, 1]);
    expect(boxSize(unitBox)).toEqual([2, 2, 2]);
    expect(boxMaxExtent(offsetBox)).toBe(2);
  });

  it('unions two boxes', () => {
    expect(unionBox(unitBox, offsetBox)).toEqual({ min: [-1, -1, -1], max: [4, 2, 2] });
  });
});

describe('fitDistance', () => {
  it('pulls back further for a larger object', () => {
    expect(fitDistance(4, 45)).toBeGreaterThan(fitDistance(2, 45));
  });

  it('pulls back further for a narrower field of view', () => {
    expect(fitDistance(2, 25)).toBeGreaterThan(fitDistance(2, 60));
  });

  it('pulls back further when the viewport is narrower than it is tall', () => {
    // A portrait viewport has a smaller horizontal FOV, so width becomes the
    // binding constraint and the camera must retreat to fit the object.
    expect(fitDistance(2, 45, 1.5, 0.5)).toBeGreaterThan(fitDistance(2, 45, 1.5, 1));
  });

  it('stays height-bound on a wide viewport', () => {
    // Landscape widens the horizontal FOV, so height remains the constraint
    // and the distance matches the square case rather than shrinking.
    expect(fitDistance(2, 45, 1.5, 2)).toBeCloseTo(fitDistance(2, 45, 1.5, 1), 10);
  });

  it('never divides by zero on a degenerate extent', () => {
    expect(Number.isFinite(fitDistance(0, 45))).toBe(true);
  });
});

describe('framePosition', () => {
  it('targets the box centre', () => {
    const { target } = framePosition(offsetBox, [10, 10, 10], 45);
    expect(target).toEqual([3, 1, 1]);
  });

  it('keeps the existing view direction, minimising disorientation', () => {
    const { position, target } = framePosition(unitBox, [0, 0, 5], 45);
    // Camera stays on the +Z axis relative to the target.
    expect(position[0]).toBeCloseTo(target[0], 5);
    expect(position[1]).toBeCloseTo(target[1], 5);
    expect(position[2]).toBeGreaterThan(target[2]);
  });

  it('falls back to a three-quarter view when the camera sits on the target', () => {
    const { position, target } = framePosition(unitBox, [0, 0, 0], 45);
    const distance = Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
    expect(distance).toBeGreaterThan(0);
    expect(Number.isFinite(distance)).toBe(true);
  });
});

describe('easing and interpolation', () => {
  it('eases from 0 to 1 and clamps outside that range', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('interpolates vectors', () => {
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });
});
