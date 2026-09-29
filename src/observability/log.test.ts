import { afterEach, describe, expect, it, vi } from 'vitest';
import { correlationId, REDACTED, redact, scrub, serverLog, withRequestId } from './log';

describe('redacting log fields', () => {
  it('hides a value whose key names a secret', () => {
    const out = redact({
      password: 'hunter2',
      accessToken: 'abc',
      api_key: 'k',
      STRIPE_SECRET_KEY: 'sk_live_1',
      authorization: 'Bearer x',
      cookie: 'sb-access-token=y',
      serviceRole: 'srv',
      cardNumber: '4242424242424242',
      cvc: '123',
      email: 'learner@example.com',
    });

    for (const [key, value] of Object.entries(out)) {
      expect(value, key).toBe(REDACTED);
    }
  });

  it('keeps fields that are safe and useful', () => {
    const out = redact({ userId: 'u-1', reason: 'plan_required', attempt: 3, ok: false });

    expect(out).toEqual({ userId: 'u-1', reason: 'plan_required', attempt: 3, ok: false });
  });

  it('scrubs a secret that arrived inside an innocent field', () => {
    /*
     * The realistic case: a provider's error message copied into `reason`.
     * Trusting the field name alone would ship the key to the log
     * aggregator.
     */
    const out = redact({
      reason: 'Invalid API key provided: sk_live_51H8xyzABCdef',
    });

    expect(out.reason).toBe('Invalid API key provided: [redacted]');
    expect(String(out.reason)).not.toContain('sk_live');
  });

  it.each([
    ['a Stripe live key', 'failed with sk_live_abc123', 'sk_live'],
    ['a Stripe test key', 'used sk_test_abc123', 'sk_test'],
    ['a webhook secret', 'signature whsec_abcdef123', 'whsec_'],
    ['a restricted key', 'rk_live_abcdef', 'rk_live'],
    ['a bearer token', 'Authorization: Bearer abc.def-ghi', 'Bearer abc'],
    ['an email address', 'no account for learner@example.com', '@example.com'],
  ])('scrubs %s out of free text', (_label, text, leak) => {
    expect(scrub(text)).not.toContain(leak);
    expect(scrub(text)).toContain(REDACTED);
  });

  it('scrubs a JWT, which is what a Supabase session cookie carries', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(scrub(`token ${jwt}`)).not.toContain('eyJhbGciOi');
  });

  it('leaves text with no secret in it untouched', () => {
    // A scrubber that mangles ordinary messages makes logs useless, which is
    // its own failure mode.
    const message = 'could not reach the learning record after 3 attempts';
    expect(scrub(message)).toBe(message);
  });
});

describe('emitting a line', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes JSON carrying the level, the event and the time', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    serverLog('warn', 'account.deletion_refused', { reason: 'not_confirmed' });

    expect(spy).toHaveBeenCalledOnce();
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({
      level: 'warn',
      event: 'account.deletion_refused',
      reason: 'not_confirmed',
    });
    expect(Date.parse(line.at)).not.toBeNaN();
  });

  it('routes errors to stderr and routine events to stdout', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    serverLog('error', 'account.deletion_failed');
    serverLog('info', 'account.deleted');

    expect(error).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
  });

  it('redacts on the way out, not only in the helper', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    serverLog('error', 'billing.failed', { reason: 'bad key sk_test_zzz', token: 'abc' });

    const printed = spy.mock.calls[0]![0] as string;
    expect(printed).not.toContain('sk_test_zzz');
    expect(printed).not.toContain('abc');
  });

  it('carries the correlation id of the request it was emitted during', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await withRequestId('req-abc', async () => {
      serverLog('info', 'inside');
    });
    serverLog('info', 'outside');

    const [first, second] = spy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(first.requestId).toBe('req-abc');
    expect(second.requestId).toBeUndefined();
  });

  it('restores the previous id even when the handler throws', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      withRequestId('req-1', async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');

    serverLog('info', 'after');
    expect(JSON.parse(spy.mock.calls[0]![0] as string).requestId).toBeUndefined();
  });
});

describe('correlation ids', () => {
  const withHeaders = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it('adopts an id the edge supplied', () => {
    expect(correlationId(withHeaders({ 'x-request-id': 'edge-123' }))).toBe('edge-123');
    expect(correlationId(withHeaders({ 'x-correlation-id': 'edge-456' }))).toBe('edge-456');
  });

  it('mints one when nothing supplied it', () => {
    const id = correlationId(withHeaders({}));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses an id that could break the log format', () => {
    /*
     * The id is echoed into a JSON line, so a supplied value must not be able
     * to carry a quote, a newline or an unbounded blob into log output.
     *
     * Driven through a stand-in for `Headers` rather than the real one,
     * deliberately. `Headers` rejects a newline itself, so constructing these
     * cases the normal way would throw in the TEST and prove nothing about
     * the guard. This asserts the guard holds on its own, for a value arriving
     * from anywhere.
     */
    const rawHeaders = (value: string) =>
      ({ headers: { get: (name: string) => (name === 'x-request-id' ? value : null) } }) as unknown as {
        headers: Headers;
      };

    for (const hostile of [
      'a"b',
      'a\nb',
      'a\r\nlevel: error',
      '{"level":"info"}',
      'x'.repeat(65),
      '../../etc/passwd',
      '',
    ]) {
      const id = correlationId(rawHeaders(hostile));
      expect(id, JSON.stringify(hostile)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
