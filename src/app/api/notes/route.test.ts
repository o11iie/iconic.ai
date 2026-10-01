import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The notes routes, driven.
 *
 * Three behaviours live in the route rather than the service, so they are
 * tested here:
 *
 *   1. the lineage for a contextual lookup is computed from the id, never
 *      accepted from the browser;
 *   2. a note id from the path is validated, and an unusable one answers 404
 *      rather than 400 — which would hand back a bit about the id space;
 *   3. export is entitlement-gated, and writing is not.
 */

const listed: unknown[] = [];
let listResult: unknown = { ok: true, value: { notes: [], total: 0 } };
let createResult: unknown = { ok: true, value: { id: 'n1' } };
let updateResult: unknown = { ok: true, value: { id: 'n1' } };
let deleteResult: unknown = { ok: true, value: null };
let allResult: unknown = { ok: true, value: [] };

let gateAllows = true;
const gateCalls: string[] = [];
let rateLimited = false;

vi.mock('@/notes/server/note-service', () => ({
  listNotes: (query: unknown) => {
    listed.push(query);
    return Promise.resolve(listResult);
  },
  createNote: () => Promise.resolve(createResult),
  updateNote: () => Promise.resolve(updateResult),
  deleteNote: () => Promise.resolve(deleteResult),
  allNotes: () => Promise.resolve(allResult),
  searchTerm: (raw: string) => (raw.trim() === '' ? null : raw.trim()),
}));

vi.mock('@/billing/server/gate', () => ({
  requireEntitlement: (key: string) => {
    gateCalls.push(key);
    return Promise.resolve(
      gateAllows
        ? { ok: true, access: null }
        : {
            ok: false,
            failure: {
              reason: 'plan_required',
              response: new Response(
                JSON.stringify({
                  ok: false,
                  error: { code: 'plan_required', message: 'Exporting is part of a paid plan.' },
                }),
                { status: 403, headers: { 'content-type': 'application/json' } },
              ),
            },
          },
    );
  },
}));

vi.mock('@/security/rate-limit', () => ({
  rateLimit: () =>
    Promise.resolve(
      rateLimited
        ? new Response(JSON.stringify({ ok: false, error: { code: 'rate_limited' } }), {
            status: 429,
          })
        : null,
    ),
}));

beforeEach(() => {
  listed.length = 0;
  gateCalls.length = 0;
  gateAllows = true;
  rateLimited = false;
  listResult = { ok: true, value: { notes: [], total: 0 } };
  createResult = { ok: true, value: { id: 'n1' } };
  updateResult = { ok: true, value: { id: 'n1' } };
  deleteResult = { ok: true, value: null };
  allResult = { ok: true, value: [] };
});

afterEach(() => vi.restoreAllMocks());

const url = (path: string) => `http://veo.test${path}`;

describe('the contextual lookup', () => {
  it('computes the lineage from the id rather than taking it from the browser', async () => {
    const { GET } = await import('./route');

    await GET(
      new Request(
        url('/api/notes?semanticId=veo.anatomy.heart.left_ventricle&includeAncestors=true'),
      ),
    );

    /*
     * A client that could supply the anchor list could supply any list. It
     * would still only return the caller's own notes — the owner scope and
     * RLS both hold — but it would turn a question about one structure into
     * an arbitrary multi-anchor probe.
     */
    expect(listed[0]).toMatchObject({
      anchors: [
        'veo.anatomy.heart.left_ventricle',
        'veo.anatomy.heart',
      ],
    });
  });

  it('ignores an anchors parameter supplied by the client', async () => {
    const { GET } = await import('./route');

    await GET(
      new Request(
        url(
          '/api/notes?semanticId=veo.anatomy.heart&includeAncestors=true&anchors=veo.chemistry.benzene',
        ),
      ),
    );

    expect(JSON.stringify(listed[0])).not.toContain('benzene');
  });

  it('uses an exact filter when ancestors are not asked for', async () => {
    const { GET } = await import('./route');

    await GET(new Request(url('/api/notes?semanticId=veo.anatomy.heart')));

    expect(listed[0]).toMatchObject({ semanticId: 'veo.anatomy.heart' });
    expect(listed[0]).not.toHaveProperty('anchors');
  });

  it('refuses an anchor that is not a semantic id', async () => {
    const { GET } = await import('./route');

    const response = await GET(new Request(url('/api/notes?semanticId=not-an-id')));

    expect(response.status).toBe(400);
    expect(listed).toHaveLength(0);
  });
});

describe('writing', () => {
  it('is NOT entitlement-gated', async () => {
    /*
     * Deliberate and worth asserting: metering somebody recording their own
     * understanding would be charging rent on their thinking. If a gate is
     * ever added here, this fails and somebody has to justify it.
     */
    const { POST } = await import('./route');

    const response = await POST(
      new Request(url('/api/notes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'a note' }),
      }),
    );

    expect(response.status).toBe(201);
    expect(gateCalls).toEqual([]);
  });

  it('is rate limited', async () => {
    rateLimited = true;
    const { POST } = await import('./route');

    const response = await POST(
      new Request(url('/api/notes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'a note' }),
      }),
    );

    expect(response.status).toBe(429);
  });

  it('refuses an invalid note before reaching the service', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new Request(url('/api/notes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: '   ' }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_request');
  });
});

describe('a note id from the path', () => {
  const ids = ['not-a-uuid', '../../etc/passwd', "1';drop table notes;--", ''];

  it.each(ids)('answers 404 for %s, never 400', async (id) => {
    const { PATCH } = await import('./[id]/route');

    const response = await PATCH(
      new Request(url(`/api/notes/${id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'x' }),
      }),
      { params: Promise.resolve({ id }) },
    );

    // 400 would distinguish "that is not an id" from "that is an id you
    // cannot have", which is a bit about the id space for no benefit.
    expect(response.status).toBe(404);
  });

  it.each(ids)('answers 404 for %s on delete too', async (id) => {
    const { DELETE } = await import('./[id]/route');

    const response = await DELETE(
      new Request(url(`/api/notes/${id}`), { method: 'DELETE' }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(404);
  });

  it('accepts a well-formed uuid', async () => {
    // The control: if 404 were unconditional, every check above would pass
    // while the endpoint did nothing.
    const { DELETE } = await import('./[id]/route');

    const response = await DELETE(
      new Request(url('/api/notes/33333333-3333-4333-8333-333333333333'), { method: 'DELETE' }),
      { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) },
    );

    expect(response.status).toBe(200);
  });

  it('reports a note that is not yours as 404', async () => {
    deleteResult = { ok: false, reason: 'not_found' };
    const { DELETE } = await import('./[id]/route');

    const response = await DELETE(
      new Request(url('/api/notes/33333333-3333-4333-8333-333333333333'), { method: 'DELETE' }),
      { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) },
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('not_found');
  });
});

describe('export', () => {
  it('is gated by export.notes', async () => {
    const { GET } = await import('./export/route');

    await GET(new Request(url('/api/notes/export')));

    expect(gateCalls).toEqual(['export.notes']);
  });

  it('refuses without the entitlement, and returns no notes', async () => {
    gateAllows = false;
    allResult = { ok: true, value: [{ id: 'n1', body: 'secret' }] };
    const { GET } = await import('./export/route');

    const response = await GET(new Request(url('/api/notes/export')));
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(text).toContain('plan_required');
    // The refusal must not carry the thing it refused.
    expect(text).not.toContain('secret');
  });

  it('returns Markdown with the entitlement', async () => {
    allResult = {
      ok: true,
      value: [
        {
          id: 'n1',
          semanticId: null,
          modelRef: null,
          title: 'Chordae',
          body: 'They stop inversion.',
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const { GET } = await import('./export/route');

    const response = await GET(new Request(url('/api/notes/export')));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(text).toContain('Chordae');
    expect(text).toContain('They stop inversion.');
  });

  it('names the download without using anything a learner typed', async () => {
    /*
     * A note title in a Content-Disposition header is a header-injection and
     * path-traversal surface for no benefit.
     */
    allResult = {
      ok: true,
      value: [
        {
          id: 'n1',
          semanticId: null,
          modelRef: null,
          title: 'evil"; rm -rf /; x="',
          body: 'b',
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const { GET } = await import('./export/route');

    const response = await GET(new Request(url('/api/notes/export')));
    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toMatch(/^attachment; filename="veo-notes-\d{4}-\d{2}-\d{2}\.md"$/);
    expect(disposition).not.toContain('rm -rf');
  });

  it('is rate limited before the gate runs', async () => {
    rateLimited = true;
    const { GET } = await import('./export/route');

    const response = await GET(new Request(url('/api/notes/export')));

    expect(response.status).toBe(429);
    // The limit is what bounds how often the entitlement lookup can be made
    // to run, so it must come first.
    expect(gateCalls).toEqual([]);
  });
});
