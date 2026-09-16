/**
 * WebGL capability detection.
 *
 * A learner on a locked-down machine or an old browser must be told exactly why
 * the viewport is blank, not left staring at an empty box.
 */
export type WebGLSupport =
  | { readonly supported: true; readonly version: 2 | 1 }
  | { readonly supported: false; readonly reason: string };

let cached: WebGLSupport | null = null;

export function detectWebGL(): WebGLSupport {
  if (cached) return cached;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // Server render: assume support and let the client correct it.
    return { supported: true, version: 2 };
  }

  try {
    const canvas = document.createElement('canvas');

    if (canvas.getContext('webgl2')) {
      cached = { supported: true, version: 2 };
      return cached;
    }

    if (canvas.getContext('webgl')) {
      cached = { supported: true, version: 1 };
      return cached;
    }

    cached = {
      supported: false,
      reason:
        'This browser reports no WebGL context. 3D rendering may be disabled in settings, or blocked by hardware acceleration being switched off.',
    };
    return cached;
  } catch (error) {
    cached = {
      supported: false,
      reason: `WebGL detection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    return cached;
  }
}

/** Test helper. */
export function resetWebGLDetection(): void {
  cached = null;
}
