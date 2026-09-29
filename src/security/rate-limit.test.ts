import { describe, expect, it } from 'vitest';
import { consume, RATE_LIMITS, type RateLimitRule, type WindowState } from './rate-limit';

const rule: RateLimitRule = { limit: 3, windowMs: 1000, rationale: 'test' };

/** Drive n requests through the counter, returning every decision. */
function run(count: number, now: number, start?: WindowState) {
  let state = start;
  const decisions = [];
  for (let i = 0; i < count; i += 1) {
    const decision = consume(state, now, rule);
    state = decision.state;
    decisions.push(decision);
  }
  return decisions;
}

describe('the rate-limit counter', () => {
  it('permits exactly the limit and refuses the next', () => {
    const decisions = run(4, 1_000);

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('opens a new window once the old one has elapsed', () => {
    const spent = run(3, 1_000).at(-1)!.state;

    // One millisecond before the window ends: still refused.
    expect(consume(spent, 1_999, rule).allowed).toBe(false);
    // Exactly on the boundary: a new window.
    const reopened = consume(spent, 2_000, rule);
    expect(reopened.allowed).toBe(true);
    expect(reopened.state).toEqual({ count: 1, startedAt: 2_000 });
  });

  it('does not let a refused request extend the window', () => {
    /*
     * The failure this guards: if a refusal incremented the count or moved
     * the window, a client retrying in a loop would hold itself out forever,
     * and the limit would punish a buggy client far more than an attacker.
     */
    const spent = run(3, 1_000).at(-1)!.state;

    let state = spent;
    for (let now = 1_100; now < 2_000; now += 100) {
      const decision = consume(state, now, rule);
      expect(decision.allowed).toBe(false);
      state = decision.state;
    }

    expect(state).toEqual(spent);
    // And the window still ends when it always would have.
    expect(consume(state, 2_000, rule).allowed).toBe(true);
  });

  it('reports a retry-after that shrinks as the window closes', () => {
    const spent = run(3, 1_000).at(-1)!.state;

    expect(consume(spent, 1_000, rule).retryAfter).toBe(1);
    expect(consume(spent, 1_500, rule).retryAfter).toBe(1);
    // Never zero: a client told to wait zero seconds retries immediately.
    expect(consume(spent, 1_999, rule).retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('survives a clock that jumps backwards', () => {
    // NTP correction, a container migration, a developer's laptop waking up.
    // A stored window in the future must not become permanent.
    const future: WindowState = { count: 3, startedAt: 10_000 };
    const decision = consume(future, 1_000, rule);

    expect(decision.allowed).toBe(true);
    expect(decision.state).toEqual({ count: 1, startedAt: 1_000 });
  });

  it('starts fresh for an unseen caller', () => {
    const decision = consume(undefined, 5_000, rule);
    expect(decision).toMatchObject({ allowed: true, remaining: 2 });
  });
});

describe('the configured limits', () => {
  it('gives every endpoint a positive limit and window', () => {
    for (const [key, configured] of Object.entries(RATE_LIMITS)) {
      expect(configured.limit, key).toBeGreaterThan(0);
      expect(configured.windowMs, key).toBeGreaterThan(0);
      expect(configured.rationale.length, key).toBeGreaterThan(10);
    }
  });

  it('limits the irreversible action hardest', () => {
    // Deleting an account is the only action here that cannot be undone, and
    // its confirmation phrase must not be brute-forceable.
    const deletion = RATE_LIMITS['account.delete'];
    for (const [key, configured] of Object.entries(RATE_LIMITS)) {
      if (key === 'account.delete') continue;
      const deletionsPerMinute = deletion.limit / (deletion.windowMs / 60_000);
      const otherPerMinute = configured.limit / (configured.windowMs / 60_000);
      expect(deletionsPerMinute, key).toBeLessThan(otherPerMinute);
    }
  });

  it('covers every endpoint that costs money or cannot be undone', () => {
    const keys = Object.keys(RATE_LIMITS);
    for (const required of ['ai.tutor', 'ai.generate', 'billing.checkout', 'account.delete']) {
      expect(keys, required).toContain(required);
    }
  });
});
