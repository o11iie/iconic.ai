import 'server-only';

import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabase/server';
import { serverLog } from '@/observability/log';

/**
 * Abuse control.
 *
 * ## This is not a second quota system
 *
 * Gate 14 owns what a PLAN includes: ten generated flashcards a day on the
 * free tier, counted in PostgreSQL, refused with 429 `quota_exhausted`, and
 * shown to the learner as an allowance they can see and upgrade. That remains
 * the only thing that decides what somebody is entitled to.
 *
 * This decides something different: how fast anybody — entitled or not — may
 * hit an endpoint. A learner with an unlimited plan still must not be able to
 * open ten thousand tutor requests a second, and an anonymous caller must not
 * be able to grind an endpoint that costs VEO money.
 *
 * The two are kept apart deliberately, because conflating them produces the
 * worst of both: a paying customer told they are "out of allowance" when they
 * merely clicked twice, or an attacker handed a per-day budget of free abuse.
 * They answer with different codes for that reason — `quota_exhausted` means
 * buy more, `rate_limited` means slow down.
 *
 * ## What this implementation is, honestly
 *
 * An in-process fixed-window counter. It protects ONE server instance.
 *
 * On a single instance — which is what VEO runs today — it is exact. Across
 * several, each keeps its own counter, so the effective limit multiplies by
 * the instance count. That is a real limitation, stated rather than papered
 * over: the seam below (`RateLimitStore`) is the whole extension point, and a
 * deployment that scales out replaces it with a shared store without touching
 * a single call site.
 *
 * It is not a substitute for an edge WAF or provider-level protection, and it
 * does not pretend to be.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Why this endpoint is limited, for whoever changes the number later. */
  readonly rationale: string;
}

/**
 * The limited endpoints, and why.
 *
 * Deliberately a closed set. An endpoint that should be limited and is not
 * shows up as a missing key here, rather than as an absent decorator nobody
 * notices.
 */
export const RATE_LIMITS = {
  'ai.tutor': {
    limit: 20,
    windowMs: 60_000,
    rationale: 'A provider call per request. Twenty a minute is far above human pace.',
  },
  'ai.generate': {
    limit: 15,
    windowMs: 60_000,
    rationale: 'Generation is slower and dearer than a tutor turn.',
  },
  'billing.checkout': {
    limit: 8,
    windowMs: 60_000,
    rationale: 'A learner needs one checkout at a time; a script needs many.',
  },
  'account.update': {
    limit: 20,
    windowMs: 60_000,
    rationale: 'A settings form, not a sync endpoint.',
  },
  'account.delete': {
    limit: 5,
    windowMs: 300_000,
    rationale: 'Irreversible, and confirmation must not be brute-forceable.',
  },
  /**
   * Writing a note is free and unmetered — charging somebody to record their
   * own understanding would be a bad product and a worse principle. This is
   * purely abuse control: a person types, a script floods.
   */
  'notes.write': {
    limit: 60,
    windowMs: 60_000,
    rationale: 'A person writes notes; sixty a minute is a script.',
  },
  /**
   * Export walks every note a learner owns and renders a document, so it is
   * the most expensive read in the feature and the easiest to abuse.
   */
  'notes.export': {
    limit: 6,
    windowMs: 300_000,
    rationale: 'Builds a document from every note owned; nobody needs it often.',
  },
  'analytics.read': {
    limit: 60,
    windowMs: 60_000,
    rationale: 'Several aggregations per call over a full review history.',
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

// ---------------------------------------------------------------------------
// The counter, as a pure function
// ---------------------------------------------------------------------------

export interface WindowState {
  readonly count: number;
  /** When the current window began. */
  readonly startedAt: number;
}

export interface RateDecision {
  readonly allowed: boolean;
  readonly state: WindowState;
  readonly remaining: number;
  /** Seconds until the window resets, for `Retry-After`. */
  readonly retryAfter: number;
}

/**
 * Decide, given the previous state and the clock.
 *
 * Pure, so the boundary conditions that matter — the request exactly on the
 * limit, the one that opens a new window, a clock that jumps backwards — are
 * testable without timers.
 */
export function consume(
  previous: WindowState | undefined,
  now: number,
  rule: RateLimitRule,
): RateDecision {
  const started = previous?.startedAt ?? now;
  const elapsed = now - started;

  // A fresh window, or a clock that moved backwards far enough that the
  // recorded start is in the future. Treating that as a new window is the
  // safe direction: the alternative is a window that never expires.
  if (previous === undefined || elapsed >= rule.windowMs || elapsed < 0) {
    return {
      allowed: true,
      state: { count: 1, startedAt: now },
      remaining: rule.limit - 1,
      retryAfter: Math.ceil(rule.windowMs / 1000),
    };
  }

  const retryAfter = Math.max(1, Math.ceil((rule.windowMs - elapsed) / 1000));

  if (previous.count >= rule.limit) {
    // A refused request does NOT increment the count and does NOT extend the
    // window. Incrementing would let a caller who is already over the limit
    // hold themselves out indefinitely by continuing to retry, which punishes
    // a buggy client far more than an attacker.
    return { allowed: false, state: previous, remaining: 0, retryAfter };
  }

  const count = previous.count + 1;
  return {
    allowed: true,
    state: { count, startedAt: started },
    remaining: rule.limit - count,
    retryAfter,
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface RateLimitStore {
  get(key: string): WindowState | undefined;
  set(key: string, state: WindowState): void;
}

/**
 * In-process storage, bounded.
 *
 * The bound matters: an unbounded map keyed by client address is a
 * memory-exhaustion vector handed to exactly the traffic this is meant to
 * survive. When it fills, the oldest windows are dropped — those are the ones
 * closest to expiring anyway.
 */
const MAX_TRACKED = 10_000;

class MemoryStore implements RateLimitStore {
  private readonly windows = new Map<string, WindowState>();

  get(key: string): WindowState | undefined {
    return this.windows.get(key);
  }

  set(key: string, state: WindowState): void {
    if (!this.windows.has(key) && this.windows.size >= MAX_TRACKED) {
      // Map iteration is insertion-ordered, so the first key is the oldest.
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
    this.windows.set(key, state);
  }
}

let store: RateLimitStore = new MemoryStore();

/** Swap the store. The seam for a shared one; also what the tests use. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

// ---------------------------------------------------------------------------

/**
 * Who is being limited.
 *
 * A signed-in learner is limited by user id, which is derived from their
 * session and cannot be changed by editing a header.
 *
 * An anonymous caller is limited by forwarded address, which CAN be spoofed
 * unless the deployment sits behind a proxy that overwrites the header. That
 * is a real weakness, and it is why the identity is prefixed: a spoofed
 * address gets somebody their own bucket, never somebody else's, and the
 * endpoints that matter most require a session anyway, where the id is
 * authoritative.
 */
async function identify(request: Request): Promise<string> {
  const user = await getServerUser().catch(() => null);
  if (user) return `user:${user.id}`;

  const forwarded = request.headers.get('x-forwarded-for');
  const address = forwarded?.split(',')[0]?.trim();
  return `addr:${address && address.length <= 64 ? address : 'unknown'}`;
}

/**
 * Apply a limit. Returns a refusal to return, or null to continue.
 *
 * Null-on-success rather than throwing, so a route reads as
 * `const limited = await rateLimit(...); if (limited) return limited;` — the
 * refusal is visible at the call site instead of hidden in a catch.
 */
export async function rateLimit(
  request: Request,
  key: RateLimitKey,
  now: number = Date.now(),
): Promise<NextResponse | null> {
  const rule = RATE_LIMITS[key];
  const identity = await identify(request);
  const bucket = `${key}:${identity}`;

  const decision = consume(store.get(bucket), now, rule);
  store.set(bucket, decision.state);

  if (decision.allowed) return null;

  // Logged because a sustained rate limit is an incident signal. The identity
  // is a user id or an address prefix, never an email.
  serverLog('warn', 'security.rate_limited', { key, identity, retryAfter: decision.retryAfter });

  return NextResponse.json(
    {
      ok: false,
      error: {
        // Distinct from Gate 14's `quota_exhausted`, deliberately: this is not
        // something buying a plan fixes, and telling somebody to upgrade
        // because they clicked twice would be a lie.
        code: 'rate_limited',
        message: 'Too many requests. Wait a moment and try again.',
      },
    },
    {
      status: 429,
      headers: {
        'retry-after': String(decision.retryAfter),
        'cache-control': 'no-store',
      },
    },
  );
}
