import * as THREE from 'three';

/**
 * Renderer configuration.
 *
 * VEO renders scientific and educational content, so the priorities are
 * accuracy and legibility rather than drama. Deliberately absent: bloom,
 * depth of field, colour grading, vignettes and screen-space effects. A
 * learner must be able to trust that what they see is the model's colour and
 * shape, not a post-process interpretation of it.
 *
 * Split into pure helpers so the policy is testable without a GPU.
 */

/**
 * Device pixel ratio policy.
 *
 * Capping at 2 is the single highest-value performance decision in the
 * renderer: a 3x display renders 9x the fragments of a 1x one for a difference
 * almost nobody can see on a 3D model. On low-memory devices we cap harder,
 * because exceeding the GPU's budget causes a context loss, not a slowdown.
 */
export function resolveDevicePixelRatio(
  devicePixelRatio: number,
  options: { readonly max?: number; readonly lowPowerMax?: number; readonly lowPower?: boolean } = {},
): number {
  const max = options.max ?? 2;
  const lowPowerMax = options.lowPowerMax ?? 1.5;
  const ceiling = options.lowPower ? lowPowerMax : max;

  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), ceiling);
}

/**
 * Antialiasing policy.
 *
 * MSAA is cheap at 1x and expensive at high DPR, where it also buys least:
 * the pixels are already small. Above 1.5x we rely on resolution instead.
 */
export function shouldAntialias(pixelRatio: number): boolean {
  return pixelRatio < 1.75;
}

/** Colour space and tone mapping applied to the WebGL renderer. */
export interface ToneMappingPolicy {
  readonly toneMapping: THREE.ToneMapping;
  readonly toneMappingExposure: number;
  readonly outputColorSpace: string;
}

/**
 * Neutral tone mapping.
 *
 * ACES Filmic is the usual default, but it warms mid-tones and rolls off
 * highlights in a way that changes perceived tissue and material colour.
 * `NeutralToneMapping` compresses highlights without shifting hue, which is
 * what an educational renderer needs. Exposure stays at 1: anything else is
 * a global colour lie.
 */
export const TONE_MAPPING_POLICY: ToneMappingPolicy = {
  toneMapping: THREE.NeutralToneMapping,
  toneMappingExposure: 1,
  outputColorSpace: THREE.SRGBColorSpace,
};

/** Apply VEO's rendering policy to a renderer instance. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = TONE_MAPPING_POLICY.toneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_POLICY.toneMappingExposure;
  renderer.outputColorSpace = TONE_MAPPING_POLICY.outputColorSpace as THREE.ColorSpace;

  // Shadows are off by default. On a model being inspected from arbitrary
  // angles they obscure detail more often than they explain form, and they
  // cost a full extra pass.
  renderer.shadowMap.enabled = false;
}

/** Near/far planes derived from model size, to preserve depth precision. */
export function resolveClippingPlanes(modelExtent: number): { near: number; far: number } {
  const extent = Number.isFinite(modelExtent) && modelExtent > 0 ? modelExtent : 1;

  // A near plane too close to zero destroys depth-buffer precision and causes
  // z-fighting on coplanar surfaces, which is common in scanned assets.
  const near = Math.max(extent / 1000, 0.001);
  const far = Math.max(extent * 100, 100);

  return { near, far };
}

/** Frame-loop policy. */
export const FRAMELOOP = {
  /**
   * Render on demand rather than continuously.
   *
   * A static model has no reason to redraw at 60fps, and a laptop fan
   * spinning up is a poor advertisement for a study tool. Interaction and
   * camera transitions invalidate explicitly.
   */
  mode: 'demand' as const,
};
