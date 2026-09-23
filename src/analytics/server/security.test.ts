import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { UUID } from '@/types/domain/primitives';
import { InMemoryLearningStore } from '@/learning/memory-store';

/**
 * The analytics security boundary.
 *
 * Learning analytics are private: a learner's mastery, review history, study
 * time, streak and recommendations. The rule is the same as Gate 12's, and it
 * is attacked the same way — by sending what an attacker would send and
 * asserting VEO refuses, and by driving the real handlers and inspecting what
 * the STORE was asked to do rather than trusting that the source reads well.
 */

const ALICE = 'alice-uuid' as UUID;
const MALLORY = 'mallory-uuid' as UUID;

const mockResolve = vi.fn();

vi.mock('@/learning/server/resolve-store', () => ({
  resolveLearning: () => mockResolve(),
}));

// The anatomy provider is not configured in tests, and resolving models would
// reach for a catalogue. Availability is its own concern, verified separately.
vi.mock('@/analytics/server/model-availability', () => ({
  resolveAvailableModels: async () => new Set<string>(),
}));

const overview = await import('@/app/api/analytics/overview/route');
const retention = await import('@/app/api/analytics/retention/route');
const mastery = await import('@/app/api/analytics/mastery/route');
const activity = await import('@/app/api/analytics/activity/route');
const attention = await import('@/app/api/analytics/attention/route');
const recommendations = await import('@/app/api/analytics/recommendations/route');
const knowledgeMap = await import('@/app/api/analytics/knowledge-map/route');
const sessions = await import('@/app/api/analytics/sessions/route');

const { queryFor, readPeriod } = await import('./analytics-api');

const ROUTES = [
  ['overview', overview.GET],
  ['retention', retention.GET],
  ['mastery', mastery.GET],
  ['activity', activity.GET],
  ['attention', attention.GET],
  ['recommendations', recommendations.GET],
  ['knowledge-map', knowledgeMap.GET],
  ['sessions', sessions.GET],
] as const;

let store: InMemoryLearningStore;
let snapshotSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store = new InMemoryLearningStore();
  snapshotSpy = vi.spyOn(store, 'analyticsSnapshot');
  mockResolve.mockReset();
  mockResolve.mockImplementation(async () => ({ ok: true, userId: ALICE, store }));
});

function get(path: string, query = ''): Request {
  return new Request(`https://veo.test/api/analytics/${path}${query}`);
}

/** Give Alice a small history so analytics has something to compute. */
async function seedAlice(userId: UUID = ALICE) {
  const now = new Date('2026-06-10T09:00:00.000Z');
  const enrolled = await store.enrol({
    userId,
    contentRef: 'question:secret-content',
    contentType: 'question',
    semanticId: null,
    modelRef: null,
    payload: { prompt: 'a private question' },
    objective: null,
    difficulty: null,
    now,
  });

  for (let i = 0; i < 5; i += 1) {
    await store.submitReview({
      userId,
      itemId: enrolled.id,
      rating: 'good',
      correct: true,
      responseMs: 3000,
      sessionId: null,
      idempotencyKey: `seed-key-${userId}-${i}`,
      now: new Date(now.getTime() + i * 86_400_000),
      timeZone: 'UTC',
    });
  }
  return enrolled.id;
}

describe('identity is never taken from the request', () => {
  it('reads analytics for the SESSION\'s learner, whatever the query says', async () => {
    await seedAlice();

    const response = await overview.GET(
      get('overview', `?period=30d&userId=${MALLORY}&user_id=${MALLORY}&uid=${MALLORY}`),
    );

    expect(response.status).toBe(200);
    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    // The id handed to the store is the authenticated one, not the query's.
    expect(snapshotSpy.mock.calls[0]![0]).toBe(ALICE);
  });

  it('gives a second learner their own empty analytics, not Alice\'s', async () => {
    await seedAlice();

    mockResolve.mockImplementation(async () => ({ ok: true, userId: MALLORY, store }));
    const body = await (await overview.GET(get('overview'))).json();

    expect(body.overview.hasData).toBe(false);
    expect(body.overview.retention.totalReviews).toBe(0);
    expect(body.overview.today.streakCurrent).toBe(0);
  });

  it('never leaks another learner\'s content through any route', async () => {
    await seedAlice();
    mockResolve.mockImplementation(async () => ({ ok: true, userId: MALLORY, store }));

    for (const [name, handler] of ROUTES) {
      const text = JSON.stringify(await (await handler(get(name))).json());
      expect(text, name).not.toContain('secret-content');
      expect(text, name).not.toContain('a private question');
      expect(text, name).not.toContain(ALICE);
    }
  });

  it('no route reads an identity from the request', () => {
    const dir = join(process.cwd(), 'src/app/api/analytics');
    const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());

    expect(names.length).toBeGreaterThanOrEqual(8); // positive control

    for (const entry of names) {
      const source = readFileSync(join(dir, entry.name, 'route.ts'), 'utf8');
      expect(source, entry.name).not.toMatch(/searchParams\.get\(['"]user/i);
      expect(source, entry.name).not.toMatch(/\buserId\s*[:=]/);
    }
  });

  it('scan control: the scan DOES catch a query-supplied identity', () => {
    const planted = `const userId = new URL(request.url).searchParams.get('userId');`;
    expect(planted).toMatch(/searchParams\.get\(['"]user/i);
  });
});

describe('every route refuses an unauthenticated caller', () => {
  it('returns 401 and never touches a store', async () => {
    mockResolve.mockImplementation(async () => ({ ok: false, reason: 'unauthenticated' }));

    for (const [name, handler] of ROUTES) {
      const response = await handler(get(name));
      expect(response.status, name).toBe(401);
    }
    expect(snapshotSpy).not.toHaveBeenCalled();
  });

  it('returns 503 rather than inventing analytics when no database exists', async () => {
    mockResolve.mockImplementation(async () => ({ ok: false, reason: 'not_configured' }));

    const response = await overview.GET(get('overview'));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('not_configured');
  });
});

describe('the period parameter', () => {
  it('accepts exactly the four VEO defines', () => {
    for (const period of ['7d', '30d', '90d', 'all']) {
      expect(readPeriod(get('overview', `?period=${period}`))).toBe(period);
    }
  });

  it('falls back to a sane window rather than failing a read', () => {
    // A stale bookmark should show something sensible, not an error page.
    for (const rubbish of ['', '1d', '365d', 'ALL', 'null', '-30d']) {
      expect(readPeriod(get('overview', `?period=${rubbish}`))).toBe('30d');
    }
    expect(readPeriod(get('overview'))).toBe('30d');
  });

  it('cannot be used to smuggle SQL, because it never reaches a query', async () => {
    // The value is parsed into a closed enum before anything else sees it, so
    // a hostile string is not escaped — it simply ceases to exist.
    const hostile = "30d'; DROP TABLE review_events; --";
    expect(readPeriod(get('overview', `?period=${encodeURIComponent(hostile)}`))).toBe('30d');

    await seedAlice();
    const response = await overview.GET(
      get('overview', `?period=${encodeURIComponent(hostile)}`),
    );
    expect(response.status).toBe(200);

    const query = snapshotSpy.mock.calls[0]![1] as { from: Date | null };
    expect(query.from).toBeInstanceOf(Date);
  });

  it('cannot request an unbounded scan', async () => {
    // Every period keeps a row cap; only the date floor varies.
    const now = new Date('2026-06-15T12:00:00.000Z');

    for (const period of ['7d', '30d', '90d', 'all'] as const) {
      const query = queryFor(period, now);
      expect(query.maxEvents, period).toBeLessThanOrEqual(5000);
      expect(query.maxSessions, period).toBeLessThanOrEqual(500);
    }

    // A short window reads less history than a long one.
    expect(queryFor('7d', now).from!.getTime()).toBeGreaterThan(
      queryFor('90d', now).from!.getTime(),
    );
    expect(queryFor('all', now).from).toBeNull();
  });

  it('ignores every other query parameter a client invents', async () => {
    await seedAlice();

    await overview.GET(
      get('overview', '?period=7d&limit=999999&offset=-1&order=user_id&maxEvents=1000000'),
    );

    const query = snapshotSpy.mock.calls[0]![1] as { maxEvents: number };
    expect(query.maxEvents).toBe(5000);
  });
});

describe('responses expose no internals', () => {
  it('names no table, column or database construct', async () => {
    await seedAlice();

    for (const [name, handler] of ROUTES) {
      const text = JSON.stringify(await (await handler(get(name))).json());
      for (const leak of [
        'review_events', 'learning_items', 'review_states', 'review_sessions',
        'learning_daily_activity', 'auth.uid', 'postgres', 'supabase',
      ]) {
        expect(text, `${name} leaked ${leak}`).not.toContain(leak);
      }
    }
  });

  it('never forwards a raw store failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(store, 'analyticsSnapshot').mockRejectedValue(
      new Error('relation "public.review_events" does not exist'),
    );

    const response = await overview.GET(get('overview'));
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(text).not.toContain('review_events');
    expect(text).not.toContain('relation');
    spy.mockRestore();
  });
});

describe('analytics cannot be reached through an unauthenticated path', () => {
  it('resolves identity through Gate 12\'s single boundary, not a second one', () => {
    const source = readFileSync(join(process.cwd(), 'src/analytics/server/analytics-api.ts'), 'utf8');

    // Reuses withLearner rather than adding a parallel identity path. A second
    // way to decide whose data this is would be a second chance to get it wrong.
    expect(source).toContain('withLearner');
    expect(source).not.toMatch(/getUser\(\)/);
    expect(source).not.toMatch(/createSupabaseServerClient/);
    expect(source).not.toMatch(/createClient/);
  });

  it('keeps every analytics server module server-only', () => {
    const dir = join(process.cwd(), 'src/analytics/server');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    expect(files.length).toBeGreaterThan(0); // positive control
    for (const file of files) {
      expect(readFileSync(join(dir, file), 'utf8'), file).toContain("import 'server-only'");
    }
  });

  it('keeps the pure engine free of environment and network access', () => {
    const dir = join(process.cwd(), 'src/analytics');
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fixtures.ts',
    );

    expect(files.length).toBeGreaterThan(5); // positive control
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, file).not.toContain("import 'server-only'");
      expect(source, file).not.toMatch(/process\.env/);
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toMatch(/from '@supabase/);
    }
  });
});
