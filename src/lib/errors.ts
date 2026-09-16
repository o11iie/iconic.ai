/**
 * VEO error taxonomy.
 *
 * Every failure surfaced to a user is one of these codes, which lets the UI
 * choose an honest message and a real recovery action instead of a generic
 * "something went wrong".
 */
export const ERROR_CODES = [
  'unknown',
  'not_found',
  'unauthorized',
  'forbidden',
  'validation_failed',
  'network_failed',
  'provider_not_configured',
  'provider_unavailable',
  'model_unavailable',
  'asset_load_failed',
  'webgl_unavailable',
  'rate_limited',
  'entitlement_required',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface VeoErrorOptions {
  /** Machine-readable cause, used for UI branching and telemetry. */
  readonly code?: ErrorCode;
  /** Message safe to show a user. Falls back to a generic line per code. */
  readonly userMessage?: string;
  /** Structured context for logs. Must never contain secrets. */
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

const DEFAULT_USER_MESSAGE: Record<ErrorCode, string> = {
  unknown: 'Something went wrong. Please try again.',
  not_found: "We couldn't find what you were looking for.",
  unauthorized: 'Please sign in to continue.',
  forbidden: "You don't have access to this.",
  validation_failed: 'Some of the information provided was not valid.',
  network_failed: 'We could not reach the server. Check your connection and try again.',
  provider_not_configured: 'This capability has not been configured for this environment yet.',
  provider_unavailable: 'This capability is temporarily unavailable.',
  model_unavailable: 'No licensed spatial model is available for this subject yet.',
  asset_load_failed: 'The spatial model could not be loaded.',
  webgl_unavailable: 'Your browser or device could not start 3D rendering.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  entitlement_required: 'This is part of a VEO plan you do not currently have.',
};

export class VeoError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(message: string, options: VeoErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'VeoError';
    this.code = options.code ?? 'unknown';
    this.userMessage = options.userMessage ?? DEFAULT_USER_MESSAGE[this.code];
    this.context = options.context ?? {};
  }

  static from(error: unknown, fallbackCode: ErrorCode = 'unknown'): VeoError {
    if (error instanceof VeoError) return error;
    if (error instanceof Error) {
      return new VeoError(error.message, { code: fallbackCode, cause: error });
    }
    return new VeoError(String(error), { code: fallbackCode });
  }
}

/** Narrow unknown caught values into a user-presentable shape. */
export function toUserMessage(error: unknown): string {
  return VeoError.from(error).userMessage;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
