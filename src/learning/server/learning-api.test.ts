import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The security boundary.
 *
 * Gate 12's rule is that a browser can never name WHO is reviewing or WHEN a
 * review happened. These tests attack that directly: they submit the fields an
 * attacker would submit and assert VEO refuses, and they scan the route
 * sources for the shapes that would reintroduce the hole.
 *
 * Every scan carries a positive control. A scan that finds nothing may be a
 * scan that finds nothing.
 */

const mockResolve = vi.fn();

vi.mock('./resolve-store', () => ({
  resolveLearning: () => mockResolve(),
  memoryStoreEnabled: () => false,
  MEMORY_STORE_ENV_VAR: 'VEO_LEARNING_MEMORY_STORE',
}));

const {
  enrolSchema, endSessionSchema, goalSchema, startSessionSchema,
  submitReviewSchema, withLearner, readBody,
} = await import('./learning-api');
const { StoreError } = await import('../store');

const ROUTES_DIR = join(process.cwd(), 'src/app/api/learning');
const SERVER_DIR = join(process.cwd(), 'src/learning/server');

function routeSources(): { path: string; source: string }[] {
  return readdirSync(ROUTES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(ROUTES_DIR, entry.name, 'route.ts');
      return { path, source: readFileSync(path, 'utf8') };
    });
}

beforeEach(() => {
  mockResolve.mockReset();
});

describe('a client cannot name the learner', () => {
  it('rejects a body carrying a userId on every endpoint', async () => {
    // The whole attack, in one line: "record this review for someone else".
    const attacks = [
      [submitReviewSchema, { itemId: 'i', rating: 'good', idempotencyKey: 'k'.repeat(10) }],
      [startSessionSchema, { itemIds: [] }],
      [endSessionSchema, { sessionId: 's', status: 'completed' }],
      [enrolSchema, { contentRef: 'c', contentType: 'question' }],
      [goalSchema, { target: 20 }],
    ] as const;

    for (const [schema, valid] of attacks) {
      expect(schema.safeParse(valid).success).toBe(true);

      for (const forged of ['userId', 'user_id', 'uid', 'sub', 'auth_uid']) {
        const result = schema.safeParse({ ...valid, [forged]: 'somebody-else' });
        expect(result.success, `${forged} was accepted`).toBe(false);
      }
    }
  });

  it('never reads an identity from a request body in any route', () => {
    const sources = routeSources();
    expect(sources.length).toBeGreaterThanOrEqual(5); // positive control: files found

    for (const { path, source } of sources) {
      expect(source, path).not.toMatch(/body\.data\.user_?[Ii]d/);
      expect(source, path).not.toMatch(/\buserId\s*:\s*body\b/);
      expect(source, path).not.toMatch(/searchParams\.get\(['"]user/i);
    }
  });

  it('scan control: the scan DOES catch a body-supplied identity', () => {
    // Without this, the check above could be matching nothing at all.
    const planted = `const x = await store.snapshot(body.data.userId);`;
    expect(planted).toMatch(/body\.data\.user_?[Ii]d/);
  });

  it('resolves identity from the validated session, not the request', () => {
    const resolver = readFileSync(join(SERVER_DIR, 'resolve-store.ts'), 'utf8');
    expect(resolver).toContain('auth.getUser()');
    // getUser() validates the JWT with the auth server; reading the session
    // cookie directly would accept a forged one.
    expect(resolver).not.toMatch(/auth\.getSession\(\)/);
  });
});

describe('a client cannot name the time', () => {
  it('rejects a body carrying a timestamp on every endpoint', async () => {
    // A client that could set the review instant could claim a review
    // happened a year ago and take any interval it liked.
    const attacks = [
      [submitReviewSchema, { itemId: 'i', rating: 'good', idempotencyKey: 'k'.repeat(10) }],
      [startSessionSchema, { itemIds: [] }],
      [endSessionSchema, { sessionId: 's', status: 'completed' }],
      [enrolSchema, { contentRef: 'c', contentType: 'question' }],
    ] as const;

    for (const [schema, valid] of attacks) {
      for (const forged of ['now', 'reviewedAt', 'timestamp', 'at', 'createdAt']) {
        expect(
          schema.safeParse({ ...valid, [forged]: '2020-01-01T00:00:00Z' }).success,
          `${forged} was accepted`,
        ).toBe(false);
      }
    }
  });

  it('rejects a body trying to dictate the resulting schedule', async () => {
    // The other half: not "when did this happen" but "and here is the answer".
    const valid = { itemId: 'i', rating: 'good', idempotencyKey: 'k'.repeat(10) };

    for (const forged of [
      'dueAt', 'intervalDays', 'stability', 'difficulty',
      'repetitions', 'lapses', 'phase', 'state',
    ]) {
      expect(
        submitReviewSchema.safeParse({ ...valid, [forged]: 999 }).success,
        `${forged} was accepted`,
      ).toBe(false);
    }
  });

  it('mints the instant on the server, once, for every route', () => {
    const api = readFileSync(join(SERVER_DIR, 'learning-api.ts'), 'utf8');
    expect(api).toContain('new Date()');

    // No route may mint its own, or accept one.
    for (const { path, source } of routeSources()) {
      expect(source, path).not.toMatch(/new Date\(\s*body/);
      expect(source, path).not.toMatch(/Date\.parse\(\s*body/);
    }
  });

  it('measures response time as reporting only, and survives a nonsense value', () => {
    const base = { itemId: 'i', rating: 'good' as const, idempotencyKey: 'k'.repeat(10) };

    // A client can lie about how long it took; it cannot make the request fail
    // or reach the scheduler, which never sees this field.
    for (const nonsense of [-5, 1e12, Number.NaN, 'ages']) {
      const parsed = submitReviewSchema.safeParse({ ...base, responseMs: nonsense });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.responseMs).toBe(0);
    }

    const scheduler = readFileSync(join(process.cwd(), 'src/learning/scheduler.ts'), 'utf8');
    expect(scheduler).not.toContain('responseMs');
  });
});

describe('refusals', () => {
  it('refuses an unauthenticated request with 401 and no detail', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'unauthenticated' });

    const response = await withLearner(async () => ({ never: true }));
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthenticated');
    expect(body).not.toHaveProperty('never');
  });

  it('checks identity before it looks at a store', async () => {
    // Otherwise "not configured" becomes a way to probe a deployment while
    // signed out.
    const handler = vi.fn();
    mockResolve.mockResolvedValue({ ok: false, reason: 'unauthenticated' });

    await withLearner(handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps a store refusal to its status without leaking internals', async () => {
    const cases = [
      ['unknown_item', 404],
      ['unknown_session', 404],
      ['conflict', 409],
      ['unavailable', 503],
      ['not_configured', 503],
    ] as const;

    for (const [code, status] of cases) {
      mockResolve.mockResolvedValue({
        ok: true, userId: 'u', store: {}, ephemeral: false,
      });

      const response = await withLearner(async () => {
        throw new StoreError(code, 'a safe message');
      });

      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it('never forwards an unexpected error to the client', async () => {
    // A raw database error names tables, columns and constraints — free
    // reconnaissance.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolve.mockResolvedValue({ ok: true, userId: 'u', store: {}, ephemeral: false });

    const response = await withLearner(async () => {
      throw new Error('relation "public.review_states" violates constraint xyz');
    });

    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('review_states');
    expect(text).not.toContain('constraint');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('tells the client when its data is ephemeral rather than pretending', async () => {
    // A learner must never be shown a streak that a restart will erase
    // without knowing.
    mockResolve.mockResolvedValue({ ok: true, userId: 'u', store: {}, ephemeral: true });
    const body = await (await withLearner(async () => ({ value: 1 }))).json();
    expect(body.ephemeral).toBe(true);

    mockResolve.mockResolvedValue({ ok: true, userId: 'u', store: {}, ephemeral: false });
    expect(await (await withLearner(async () => ({ value: 1 }))).json()).not.toHaveProperty(
      'ephemeral',
    );
  });

  it('rejects a malformed body before resolving anything', async () => {
    const request = new Request('https://veo.test/api/learning/review', {
      method: 'POST',
      body: 'not json',
    });
    const result = await readBody(request, submitReviewSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('the in-memory store cannot shadow a real database', () => {
  it('reads its flag as a literal, because Next inlines these at build time', () => {
    // A computed lookup (process.env[VAR]) reads a build-time snapshot and
    // silently never activates — the flag looks wired and does nothing.
    const source = readFileSync(join(SERVER_DIR, 'resolve-store.ts'), 'utf8');
    expect(source).toContain('process.env.VEO_LEARNING_MEMORY_STORE');
    expect(source).not.toMatch(/process\.env\[/);
  });

  it('refuses to engage when Supabase is configured', () => {
    const source = readFileSync(join(SERVER_DIR, 'resolve-store.ts'), 'utf8');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL');
    // The guard must come before the flag is honoured.
    const flagAt = source.indexOf('VEO_LEARNING_MEMORY_STORE !== ');
    const guardAt = source.indexOf('NEXT_PUBLIC_SUPABASE_URL &&');
    expect(flagAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(flagAt);
  });

  it('still requires a real authenticated user', () => {
    // The flag swaps persistence, never authentication — otherwise the
    // verification build would be a way to review as anybody.
    const source = readFileSync(join(SERVER_DIR, 'resolve-store.ts'), 'utf8');
    const block = source.slice(source.indexOf('if (memoryStoreEnabled())'));
    expect(block.slice(0, 600)).toContain('getServerUser()');
  });
});

describe('server-only modules stay server-only', () => {
  it('marks every server learning module', () => {
    const files = readdirSync(SERVER_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0); // positive control

    for (const file of files) {
      expect(readFileSync(join(SERVER_DIR, file), 'utf8'), file).toContain("import 'server-only'");
    }
    expect(readFileSync(join(process.cwd(), 'src/learning/supabase-store.ts'), 'utf8'))
      .toContain("import 'server-only'");
  });

  it('keeps the pure modules free of server-only imports, so the client can use them', () => {
    // The scheduler and queue render the UI. If they became server-only the
    // review screen could not compute anything locally.
    for (const file of ['scheduler.ts', 'queue.ts', 'mastery.ts', 'streaks.ts', 'session.ts']) {
      const source = readFileSync(join(process.cwd(), 'src/learning', file), 'utf8');
      expect(source, file).not.toContain("import 'server-only'");
      expect(source, file).not.toMatch(/from '@supabase/);
      expect(source, file).not.toMatch(/process\.env/);
    }
  });
});
