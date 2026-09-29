/**
 * Structured server logging.
 *
 * ## Why a module rather than `console.log`
 *
 * Logs from the account and billing paths are the record of who was refused
 * and why, and they are read during an incident by somebody who cannot
 * reproduce it. Free-form strings make that record unsearchable, and — more
 * dangerously — make it easy to interpolate a token into one.
 *
 * So every log is an event NAME plus a bounded set of fields, and the fields
 * go through `redact` below. There is no overload that takes an arbitrary
 * object.
 *
 * ## What never appears
 *
 * Passwords, access and refresh tokens, API keys of any provider, Stripe
 * secrets, the service-role key, card details, and a learner's email address.
 *
 * The email is deliberate and is the one people argue about. It is not needed
 * to investigate anything: a user id identifies the row, and anybody entitled
 * to resolve that id to a person can do so through the database, with the
 * access control that implies. Putting the address in a log ships personal
 * data to wherever logs are aggregated, which is usually a third party with
 * different retention and a much wider readership.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Field values a log line may carry.
 *
 * Deliberately narrow. An object would let a whole Stripe event or Supabase
 * error — both of which carry things that must not be logged — be passed in
 * one careless spread.
 */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Keys whose values are never printed, whatever they contain.
 *
 * Matched case-insensitively on a substring, so `stripeSecretKey`,
 * `access_token` and `apiKey` are all caught without needing to be listed.
 */
const FORBIDDEN_KEY_PATTERNS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'service_role',
  'servicerole',
  'card',
  'cvc',
  'email',
];

/**
 * Value shapes that are secrets wherever they appear.
 *
 * A message copied from a provider error can carry one even when the field
 * name is innocent — `reason: "Invalid API key sk_live_..."` is the realistic
 * case, and it is why messages are scrubbed rather than trusted.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]+/g,
  /\bwhsec_[A-Za-z0-9]+/g,
  /\brk_(live|test)_[A-Za-z0-9]+/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, // a JWT
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // an email address
];

export const REDACTED = '[redacted]';

function forbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Scrub a value that may have come from a provider or a user. */
export function scrub(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redact(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (forbiddenKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = typeof value === 'string' ? scrub(value) : value;
  }

  return out;
}

/**
 * The current request's correlation id.
 *
 * Set by `withRequestId` so every line emitted while handling one request
 * carries the same id, and a learner reporting "it failed at about ten past"
 * can be matched to the exact sequence of events.
 *
 * Module-level rather than AsyncLocalStorage-backed on purpose: Next runs each
 * request handler to completion within one task here, and an id that is
 * *occasionally* wrong is worse than one that is obviously per-process. If
 * VEO later interleaves handlers, this is the one place to change.
 */
let currentRequestId: string | null = null;

export function requestId(): string | null {
  return currentRequestId;
}

/** Run a handler with a correlation id attached to everything it logs. */
export async function withRequestId<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = currentRequestId;
  currentRequestId = id;
  try {
    return await run();
  } finally {
    currentRequestId = previous;
  }
}

/** A correlation id for one request, from the edge if it supplied one. */
export function correlationId(request: { headers: Headers }): string {
  const supplied =
    request.headers.get('x-request-id') ?? request.headers.get('x-correlation-id');

  // A client-supplied id is only ever a label for joining logs; it grants
  // nothing, so it needs no validation beyond a length and character bound to
  // stop it being used to inject into log output.
  if (supplied && /^[A-Za-z0-9_-]{1,64}$/.test(supplied)) return supplied;

  return crypto.randomUUID();
}

/**
 * Emit one structured line.
 *
 * Writes to stdout/stderr as JSON, which is what every log aggregator in
 * production ingests, and what `docker logs` shows in development.
 */
export function serverLog(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(currentRequestId ? { requestId: currentRequestId } : {}),
    ...redact(fields),
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  // Informational events belong on stdout, not stderr: a log aggregator
  // separates the two by stream, and routing routine events to stderr makes
  // every successful request look like a problem.
  // eslint-disable-next-line no-console
  else console.log(line);
}
