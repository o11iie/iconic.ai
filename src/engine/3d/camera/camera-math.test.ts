import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '@/types/domain/spatial';
import {
  boxCenter,
  boxMaxExtent,
  boxSize,
  clampDistance,
  easeInOutCubic,
  expandBox,
  fitDistance,
  framePosition,
  initialFraming,
  isUsableBox,
  lerpVec3,
  unionBox,
  zoomLimitsFor,
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

describe('zoom limits', () => {
  it('derives limits from the model, so one rig serves any scale', () => {
    const small = zoomLimitsFor(0.01);
    const large = zoomLimitsFor(1000);

    expect(small.min).toBeLessThan(large.min);
    expect(large.max).toBeGreaterThan(small.max);
    // Always a usable range, never inverted.
    expect(small.max).toBeGreaterThan(small.min);
    expect(large.max).toBeGreaterThan(large.min);
  });

  it('never returns a zero or negative minimum, which would clip through geometry', () => {
    for (const extent of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const limits = zoomLimitsFor(extent);
      expect(limits.min).toBeGreaterThan(0);
      expect(Number.isFinite(limits.min)).toBe(true);
      expect(Number.isFinite(limits.max)).toBe(true);
    }
  });

  it('clamps a distance into range', () => {
    const limits = { min: 1, max: 10 };
    expect(clampDistance(0.1, limits)).toBe(1);
    expect(clampDistance(50, limits)).toBe(10);
    expect(clampDistance(5, limits)).toBe(5);
    expect(clampDistance(Number.NaN, limits)).toBe(1);
  });
});

describe('initial framing', () => {
  it('frames the model from a three-quarter view rather than flat on an axis', () => {
    const { position, target } = initialFraming(unitBox, 45, 1.6);

    expect(target).toEqual([0, 0, 0]);
    // Offset on all three axes: a straight-on view makes a 3D model read as a
    // picture of itself.
    expect(Math.abs(position[0])).toBeGreaterThan(0.1);
    expect(Math.abs(position[1])).toBeGreaterThan(0.1);
    expect(Math.abs(position[2])).toBeGreaterThan(0.1);
  });

  it('places the camera outside the model', () => {
    const { position, target } = initialFraming(unitBox);
    const distance = Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
    expect(distance).toBeGreaterThan(boxMaxExtent(unitBox) / 2);
  });

  it('scales with the model', () => {
    const big: BoundingBox = { min: [-50, -50, -50], max: [50, 50, 50] };
    const near = initialFraming(unitBox);
    const far = initialFraming(big);

    expect(Math.hypot(...far.position)).toBeGreaterThan(Math.hypot(...near.position));
  });
});

describe('box guards', () => {
  it('rejects degenerate boxes that would break framing', () => {
    expect(isUsableBox(null)).toBe(false);
    expect(isUsableBox({ min: [0, 0, 0], max: [0, 0, 0] })).toBe(false);
    expect(isUsableBox({ min: [0, 0, 0], max: [Number.NaN, 1, 1] })).toBe(false);
    expect(isUsableBox(unitBox)).toBe(true);
  });

  it('expands a box about its centre', () => {
    const expanded = expandBox(unitBox, 2);
    expect(expanded.min).toEqual([-2, -2, -2]);
    expect(expanded.max).toEqual([2, 2, 2]);
    // Centre is preserved, so framing does not drift.
    expect(boxCenter(expanded)).toEqual(boxCenter(unitBox));
  });
});
