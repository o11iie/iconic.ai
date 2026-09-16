import { VeoError, type ErrorCode } from '@/lib/errors';

/**
 * Failures the spatial layer can produce. These exist so the viewport can show
 * an accurate reason — "no licensed model", "WebGL unavailable", "asset 404" —
 * instead of a blank canvas.
 */
export class SpatialError extends VeoError {
  constructor(message: string, code: ErrorCode, context?: Record<string, unknown>) {
    super(message, { code, context: context ?? {} });
    this.name = 'SpatialError';
  }

  static notConfigured(providerId: string): SpatialError {
    return new SpatialError(
      `Spatial provider "${providerId}" is not configured in this environment.`,
      'provider_not_configured',
      { providerId },
    );
  }

  static modelUnavailable(modelRef: string, reason: string): SpatialError {
    return new SpatialError(
      `Spatial model "${modelRef}" is unavailable: ${reason}`,
      'model_unavailable',
      { modelRef, reason },
    );
  }

  static assetLoadFailed(url: string, cause?: unknown): SpatialError {
    const error = new SpatialError(`Failed to load spatial asset from ${url}.`, 'asset_load_failed', {
      url,
      cause: cause instanceof Error ? cause.message : String(cause ?? ''),
    });
    return error;
  }

  static objectNotFound(semanticId: string): SpatialError {
    return new SpatialError(`No spatial object with semantic id "${semanticId}".`, 'not_found', {
      semanticId,
    });
  }

  static webglUnavailable(): SpatialError {
    return new SpatialError(
      'WebGL2 is not available in this browser or has been disabled.',
      'webgl_unavailable',
    );
  }
}
