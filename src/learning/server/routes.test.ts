import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UUID } from '@/types/domain/primitives';
import { InMemoryLearningStore } from '../memory-store';

/**
 * The real route handlers, driven as HTTP.
 *
 * These are correspondence tests, not scans: a forged request is sent to the
 * actual exported handler, and what the STORE received is inspected. Text
 * appearing in a source file is not evidence; what the store was asked to do
 * is.
 */

const ALICE = 'alice-uuid' as UUID;
const MALLORY = 'mallory-uuid' as UUID;

const mockResolve = vi.fn();

vi.mock('./resolve-store', () => ({ resolveLearning: () => mockResolve() }));

const review = await import('@/app/api/learning/review/route');
const session = await import('@/app/api/learning/session/route');
const enrol = await import('@/app/api/learning/enrol/route');
const queue = await import('@/app/api/learning/queue/route');
const goal = await import('@/app/api/learning/goal/route');

let store: InMemoryLearningStore;
let submitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store = new InMemoryLearningStore();
  submitSpy = vi.spyOn(store, 'submitReview');
  mockResolve.mockReset();
  mockResolve.mockImplementation(async () => ({
    ok: true, userId: ALICE, store,
  }));
});

function post(url: string, body: unknown): Request {
  return new Request(`https://veo.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function enrolOne(): Promise<UUID> {
  const item = await store.enrol({
    userId: ALICE, contentRef: 'q-1', contentType: 'question',
    semanticId: null, modelRef: null, payload: { prompt: 'Which chamber?' },
    objective: null, difficulty: null, now: new Date('2026-03-15T09:00:00.000Z'),
  });
  return item.id;
}

describe('POST /api/learning/review', () => {
  it('records the review against the SESSION\'s learner, never the body\'s', async () => {
    const itemId = await enrolOne();

    const response = await review.POST(
      post('/api/learning/review', {
        itemId, rating: 'good', idempotencyKey: 'answer-0001',
        // The attack.
        userId: MALLORY,
      }),
    );

    // Refused outright: the schema does not have a field for this.
    expect(response.status).toBe(400);
    expect(submitSpy).not.toHaveBeenCalled();

    // And nothing moved.
    expect((await store.getItem(ALICE, itemId))!.state.phase).toBe('new');
  });

  it('passes the authenticated id to the store on a legitimate request', async () => {
    const itemId = await enrolOne();

    const response = await review.POST(
      post('/api/learning/review', {
        itemId, rating: 'good', idempotencyKey: 'answer-0001',
      }),
    );

    expect(response.status).toBe(200);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0]![0]).toMatchObject({ userId: ALICE, itemId });
  });

  it('gives the store a server-minted instant, close to now', async () => {
    const itemId = await enrolOne();
    const before = Date.now();

    await review.POST(
      post('/api/learning/review', { itemId, rating: 'good', idempotencyKey: 'answer-0001' }),
    );

    const passed = (submitSpy.mock.calls[0]![0] as { now: Date }).now;
    expect(passed).toBeInstanceOf(Date);
    expect(passed.getTime()).toBeGreaterThanOrEqual(before);
    expect(passed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('returns the schedule VEO decided, not one the client proposed', async () => {
    const itemId = await enrolOne();

    const response = await review.POST(
      post('/api/learning/review', { itemId, rating: 'easy', idempotencyKey: 'answer-0001' }),
    );
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.state.phase).toBe('review');
    expect(body.state.intervalDays).toBeGreaterThan(0);
    expect(body.deduplicated).toBe(false);
  });

  it('deduplicates a retried submission end to end', async () => {
    const itemId = await enrolOne();
    const send = () =>
      review.POST(post('/api/learning/review', {
        itemId, rating: 'good', idempotencyKey: 'answer-0001',
      }));

    const first = await (await send()).json();
    const retry = await (await send()).json();

    expect(retry.deduplicated).toBe(true);
    expect(retry.state).toEqual(first.state);
    expect((await store.snapshot(ALICE)).recentReviews).toHaveLength(1);
  });

  it('refuses an item belonging to somebody else with 404, not a leak', async () => {
    const bobItem = await store.enrol({
      userId: 'bob-uuid' as UUID, contentRef: 'q-bob', contentType: 'question',
      semanticId: null, modelRef: null, payload: { prompt: 'secret' },
      objective: null, difficulty: null, now: new Date(),
    });

    const response = await review.POST(
      post('/api/learning/review', {
        itemId: bobItem.id, rating: 'easy', idempotencyKey: 'answer-0001',
      }),
    );

    expect(response.status).toBe(404);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('secret');
    expect(text).not.toContain('bob-uuid');
  });

  it('rejects a rating that is not one VEO defines', async () => {
    const itemId = await enrolOne();
    const response = await review.POST(
      post('/api/learning/review', { itemId, rating: 'perfect', idempotencyKey: 'answer-0001' }),
    );
    expect(response.status).toBe(400);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('requires an idempotency key long enough to be unique', async () => {
    const itemId = await enrolOne();
    for (const key of ['', 'x', 'short']) {
      const response = await review.POST(
        post('/api/learning/review', { itemId, rating: 'good', idempotencyKey: key }),
      );
      expect(response.status).toBe(400);
    }
  });
});

describe('POST /api/learning/session', () => {
  async function enrolMany(count: number) {
    for (let i = 0; i < count; i += 1) {
      await store.enrol({
        userId: ALICE, contentRef: `q-${i}`, contentType: 'question',
        semanticId: null, modelRef: null, payload: { prompt: `Q${i}` },
        objective: null, difficulty: null, now: new Date(),
      });
    }
  }

  it('plans from the server\'s queue, not from what the client asked for', async () => {
    await enrolMany(3);
    const bob = await store.enrol({
      userId: 'bob-uuid' as UUID, contentRef: 'q-bob', contentType: 'question',
      semanticId: null, modelRef: null, payload: {}, objective: null,
      difficulty: null, now: new Date(),
    });

    const body = await (
      await session.POST(post('/api/learning/session', {
        itemIds: [bob.id, 'made-up-id'],
      }))
    ).json();

    // Requested ids are INTERSECTED with the server's queue, so neither
    // another learner's item nor a fabricated id can enter a session.
    expect(body.session.plannedItemIds).toEqual([]);
    expect(body.items).toEqual([]);
  });

  it('starts over everything due when the client proposes nothing', async () => {
    await enrolMany(4);
    const body = await (await session.POST(post('/api/learning/session', {}))).json();

    expect(body.session.status).toBe('active');
    expect(body.session.plannedItemIds).toHaveLength(4);
    expect(body.items).toHaveLength(4);
  });

  it('sends the content the learner must actually see', async () => {
    await enrolMany(1);
    const body = await (await session.POST(post('/api/learning/session', {}))).json();
    expect(body.items[0].payload).toEqual({ prompt: 'Q0' });
  });

  it('rejoins the in-flight session rather than forking one', async () => {
    await enrolMany(2);
    const first = await (await session.POST(post('/api/learning/session', {}))).json();
    const second = await (await session.POST(post('/api/learning/session', {}))).json();

    expect(second.session.id).toBe(first.session.id);
    expect((await (await session.GET()).json()).session.id).toBe(first.session.id);
  });

  it('will not end another learner\'s session', async () => {
    await enrolMany(1);
    const mine = await (await session.POST(post('/api/learning/session', {}))).json();

    mockResolve.mockImplementation(async () => ({
      ok: true, userId: MALLORY, store,
    }));

    const request = new Request('https://veo.test/api/learning/session', {
      method: 'PATCH',
      body: JSON.stringify({ sessionId: mine.session.id, status: 'abandoned' }),
    });
    expect((await (await session.PATCH(request)).json()).session).toBeNull();

    mockResolve.mockImplementation(async () => ({
      ok: true, userId: ALICE, store,
    }));
    expect((await (await session.GET()).json()).session.status).toBe('active');
  });
});

describe('POST /api/learning/enrol', () => {
  it('creates a new item and no study activity whatsoever', async () => {
    // Enrolling is not studying. A learner who generates fifty flashcards and
    // closes the tab has studied on zero days.
    const body = await (
      await enrol.POST(post('/api/learning/enrol', {
        contentRef: 'q-new', contentType: 'question', payload: { prompt: 'Q' },
      }))
    ).json();

    expect(body.item.phase).toBe('new');

    const snapshot = await store.snapshot(ALICE);
    expect(snapshot.days).toEqual([]);
    expect(snapshot.recentReviews).toEqual([]);
  });

  it('stores an unrecognised semantic id as null rather than trusting it', async () => {
    // A client-invented id must never become a structure reference VEO would
    // later try to show in 3D.
    const body = await (
      await enrol.POST(post('/api/learning/enrol', {
        contentRef: 'q-bad', contentType: 'question',
        semanticId: 'totally.made.up.structure',
      }))
    ).json();

    expect(body.item.semanticId).toBeNull();
  });

  it('keeps a semantic id VEO would mint itself', async () => {
    const body = await (
      await enrol.POST(post('/api/learning/enrol', {
        contentRef: 'q-good', contentType: 'flashcard',
        semanticId: 'veo.anatomy.heart.left_ventricle',
      }))
    ).json();

    expect(body.item.semanticId).toBe('veo.anatomy.heart.left_ventricle');
  });

  it('is idempotent per content ref', async () => {
    const send = () =>
      enrol.POST(post('/api/learning/enrol', {
        contentRef: 'q-same', contentType: 'question',
      }));

    const first = await (await send()).json();
    const second = await (await send()).json();

    expect(second.item.itemId).toBe(first.item.itemId);
    expect((await store.snapshot(ALICE)).items).toHaveLength(1);
  });
});

describe('GET /api/learning/queue', () => {
  it('reports honest zeroes and nulls for a learner with no history', async () => {
    const body = await (
      await queue.GET(new Request('https://veo.test/api/learning/queue'))
    ).json();

    expect(body.counts.actionable).toBe(0);
    expect(body.queue).toEqual([]);
    expect(body.streak).toMatchObject({ current: 0, longest: 0, totalStudyDays: 0 });
    expect(body.retention.overall).toBeNull();
    expect(body.nextDueAt).toBeNull();
    expect(body.progress.reviewsCompleted).toBe(0);
  });

  it('reports what the learner has actually done, after real reviews', async () => {
    const itemId = await enrolOne();
    await review.POST(post('/api/learning/review', {
      itemId, rating: 'good', idempotencyKey: 'answer-0001', timeZone: 'UTC',
    }));

    const body = await (
      await queue.GET(new Request('https://veo.test/api/learning/queue'))
    ).json();

    expect(body.streak.current).toBe(1);
    expect(body.streak.studiedToday).toBe(true);
    expect(body.retention.overall).toBe(1);
    expect(body.progress.reviewsCompleted).toBe(1);
    expect(body.goal.completed).toBe(1);
  });

  it('does not let a query string override the learner\'s stored timezone', async () => {
    await store.setDailyTarget(ALICE, 20, 'Pacific/Auckland');
    const body = await (
      await queue.GET(new Request('https://veo.test/api/learning/queue?timeZone=UTC'))
    ).json();

    expect(body.timeZone).toBe('Pacific/Auckland');
  });
});

describe('PUT /api/learning/goal', () => {
  it('returns the clamped value that was actually stored', async () => {
    const put = (body: unknown) =>
      goal.PUT(new Request('https://veo.test/api/learning/goal', {
        method: 'PUT', body: JSON.stringify(body),
      }));

    expect((await (await put({ target: 35 })).json()).target).toBe(35);
    // Out of range is refused by the schema rather than silently clamped, so
    // a UI cannot believe it set something it did not.
    expect((await put({ target: 10_000 })).status).toBe(400);
    expect((await put({ target: 0 })).status).toBe(400);
  });
});

describe('every route refuses an unauthenticated caller', () => {
  it('returns 401 and touches no store', async () => {
    const spy = vi.spyOn(store, 'snapshot');
    mockResolve.mockImplementation(async () => ({ ok: false, reason: 'unauthenticated' }));

    const responses = await Promise.all([
      review.POST(post('/api/learning/review', {
        itemId: 'i', rating: 'good', idempotencyKey: 'answer-0001',
      })),
      session.POST(post('/api/learning/session', {})),
      session.GET(),
      enrol.POST(post('/api/learning/enrol', {
        contentRef: 'c', contentType: 'question',
      })),
      queue.GET(new Request('https://veo.test/api/learning/queue')),
      goal.PUT(new Request('https://veo.test/api/learning/goal', {
        method: 'PUT', body: JSON.stringify({ target: 20 }),
      })),
    ]);

    for (const response of responses) expect(response.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
