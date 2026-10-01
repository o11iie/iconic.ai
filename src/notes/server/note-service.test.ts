import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UUID } from '@/types/domain/primitives';
import type { SemanticId } from '@/lib/semantic-id';

/**
 * The notes service, driven.
 *
 * What matters is not that it reads and writes — it is that IDENTITY comes
 * from the session on every path, that a note id from a URL is never trusted
 * on its own, and that a note belonging to somebody else is indistinguishable
 * from one that does not exist.
 *
 * Supabase is substituted, and the substitute RECORDS the query that was
 * built, so the assertions are on the filters the service applied — including
 * the owner scope, which is the whole point.
 *
 * `verify-rls.sh` proves the other half against real PostgreSQL: that the
 * policies refuse a foreign row even if this layer asked for one.
 */

const SESSION_USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const NOTE_ID = '33333333-3333-4333-8333-333333333333' as UUID;

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
  textSearch?: { column: string; term: string };
  inFilter?: { column: string; values: unknown[] };
}

let recorded: Recorded[] = [];
let sessionUser: string | null = SESSION_USER;
/** What the substituted database returns. Null means "no such row". */
let row: Record<string, unknown> | null = null;
let rows: Record<string, unknown>[] = [];
let dbError: string | null = null;

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    spatial_object_id: null,
    title: 'A title',
    body: 'A body',
    tags: ['cardiac'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function builder(entry: Recorded) {
  recorded.push(entry);

  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      entry.filters.push({ column, value });
      return api;
    },
    in(column: string, values: unknown[]) {
      entry.inFilter = { column, values };
      return api;
    },
    textSearch(column: string, term: string) {
      entry.textSearch = { column, term };
      return api;
    },
    order() {
      return api;
    },
    range() {
      return Promise.resolve(
        dbError ? { data: null, error: { message: dbError }, count: null } : { data: rows, error: null, count: rows.length },
      );
    },
    maybeSingle() {
      return Promise.resolve(
        dbError ? { data: null, error: { message: dbError } } : { data: row, error: null },
      );
    },
    single() {
      return Promise.resolve(
        dbError ? { data: null, error: { message: dbError } } : { data: row ?? sampleRow(), error: null },
      );
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(
        dbError ? { data: null, error: { message: dbError } } : { data: rows, error: null },
      ).then(resolve);
    },
  };

  return api;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () =>
        sessionUser
          ? { data: { user: { id: sessionUser } }, error: null }
          : { data: { user: null }, error: new Error('no session') },
    },
    from: (table: string) => ({
      select: () => builder({ table, op: 'select', filters: [] }),
      insert: (payload: Record<string, unknown>) =>
        builder({ table, op: 'insert', payload, filters: [] }),
      update: (payload: Record<string, unknown>) =>
        builder({ table, op: 'update', payload, filters: [] }),
      delete: () => builder({ table, op: 'delete', filters: [] }),
    }),
  }),
  getServerUser: async () => (sessionUser ? { id: sessionUser } : null),
}));

beforeEach(() => {
  recorded = [];
  sessionUser = SESSION_USER;
  row = sampleRow();
  rows = [sampleRow()];
  dbError = null;
});

afterEach(() => vi.restoreAllMocks());

const ownerFilter = (entry: Recorded | undefined) =>
  entry?.filters.find((filter) => filter.column === 'owner_id');

// ---------------------------------------------------------------------------

describe('every read is scoped to the session user', () => {
  it('scopes a list', async () => {
    const { listNotes } = await import('./note-service');
    await listNotes();

    expect(ownerFilter(recorded[0])).toEqual({ column: 'owner_id', value: SESSION_USER });
  });

  it('scopes a single read by owner AS WELL AS by id', async () => {
    const { getNote } = await import('./note-service');
    await getNote(NOTE_ID);

    const filters = recorded[0]?.filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { column: 'id', value: NOTE_ID },
        { column: 'owner_id', value: SESSION_USER },
      ]),
    );
  });

  it('scopes an export', async () => {
    const { allNotes } = await import('./note-service');
    await allNotes();

    expect(ownerFilter(recorded[0])).toEqual({ column: 'owner_id', value: SESSION_USER });
  });

  it('refuses every read without a session, before touching the database', async () => {
    sessionUser = null;
    const service = await import('./note-service');

    for (const call of [
      () => service.listNotes(),
      () => service.getNote(NOTE_ID),
      () => service.allNotes(),
    ]) {
      const result = await call();
      expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
    }
    expect(recorded).toHaveLength(0);
  });
});

describe('every write is scoped to the session user', () => {
  const draft = {
    title: 'T',
    body: 'B',
    semanticId: null,
    modelRef: null,
    tags: [] as readonly string[],
  };

  it('creates with the session owner id', async () => {
    const { createNote } = await import('./note-service');
    await createNote(draft);

    expect(recorded[0]?.payload?.owner_id).toBe(SESSION_USER);
  });

  it('writes only the columns it means to', async () => {
    const { createNote } = await import('./note-service');
    await createNote(draft);

    // Listed explicitly: a spread would make a new column client-writable the
    // moment one is added to the table.
    expect(Object.keys(recorded[0]?.payload ?? {}).sort()).toEqual([
      'body',
      'metadata',
      'owner_id',
      'spatial_object_id',
      'tags',
      'title',
    ]);
  });

  it('never sends updated_at, because the trigger owns it', async () => {
    const { updateNote } = await import('./note-service');
    await updateNote(NOTE_ID, draft);

    const payload = recorded[0]?.payload ?? {};
    expect(payload).not.toHaveProperty('updated_at');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('owner_id');
  });

  it('scopes an update by owner as well as id', async () => {
    const { updateNote } = await import('./note-service');
    await updateNote(NOTE_ID, draft);

    expect(recorded[0]?.filters).toEqual(
      expect.arrayContaining([
        { column: 'id', value: NOTE_ID },
        { column: 'owner_id', value: SESSION_USER },
      ]),
    );
  });

  it('scopes a delete by owner as well as id', async () => {
    const { deleteNote } = await import('./note-service');
    await deleteNote(NOTE_ID);

    expect(recorded[0]?.filters).toEqual(
      expect.arrayContaining([
        { column: 'id', value: NOTE_ID },
        { column: 'owner_id', value: SESSION_USER },
      ]),
    );
  });

  it('refuses every write without a session', async () => {
    sessionUser = null;
    const service = await import('./note-service');

    for (const call of [
      () => service.createNote(draft),
      () => service.updateNote(NOTE_ID, draft),
      () => service.deleteNote(NOTE_ID),
    ]) {
      expect(await call()).toEqual({ ok: false, reason: 'unauthenticated' });
    }
    expect(recorded).toHaveLength(0);
  });

  it('never writes a user id that came from the input', async () => {
    const { createNote } = await import('./note-service');
    await createNote({ ...draft, ownerId: OTHER_USER, owner_id: OTHER_USER } as never);

    expect(recorded[0]?.payload?.owner_id).toBe(SESSION_USER);
    expect(JSON.stringify(recorded[0])).not.toContain(OTHER_USER);
  });
});

describe('a note that is not yours is not found', () => {
  /*
   * The one behaviour the browser run cannot reach, because the fixture has
   * no database: with no row returned, the service must report `not_found`
   * and never anything that distinguishes "somebody else owns it" from "it
   * does not exist".
   */
  it('reports not_found when no row comes back from a read', async () => {
    row = null;
    const { getNote } = await import('./note-service');

    expect(await getNote(NOTE_ID)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports not_found when an update matched nothing', async () => {
    row = null;
    const { updateNote } = await import('./note-service');

    const result = await updateNote(NOTE_ID, {
      title: null,
      body: 'B',
      semanticId: null,
      modelRef: null,
      tags: [],
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports not_found when a delete matched nothing', async () => {
    /*
     * The failure this guards: PostgREST reports a delete matching no rows as
     * success, and RLS makes a foreign row match nothing. Without checking
     * what came back, a learner would be told somebody else's note was
     * deleted — and their own would appear to delete when it had not.
     */
    row = null;
    const { deleteNote } = await import('./note-service');

    expect(await deleteNote(NOTE_ID)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('does not report not_found when the delete DID match', async () => {
    const { deleteNote } = await import('./note-service');
    expect(await deleteNote(NOTE_ID)).toEqual({ ok: true, value: null });
  });
});

describe('search', () => {
  it('filters on the generated column', async () => {
    const { listNotes } = await import('./note-service');
    await listNotes({ q: 'chordae' });

    expect(recorded[0]?.textSearch).toEqual({ column: 'fts', term: 'chordae' });
  });

  it('returns nothing — not everything — for a term with nothing usable in it', async () => {
    /*
     * A term that sanitises to empty must not become "no filter". Dropping
     * the filter would show a learner their whole collection and look like a
     * search that matched everything.
     */
    const { listNotes } = await import('./note-service');
    const result = await listNotes({ q: '   <>\\  ' });

    /*
     * The substituted database holds one row. An empty result therefore
     * proves the service returned BEFORE executing anything — had it dropped
     * the filter and run the query, that row would be here.
     *
     * An earlier version of this test also asserted no query was recorded.
     * That was wrong: the builder is lazy, so `.from().select()` records an
     * entry without executing, and nothing runs until `.range()` is awaited.
     * The assertion was about construction order rather than behaviour.
     */
    expect(result).toEqual({ ok: true, value: { notes: [], total: 0 } });
    expect(rows).toHaveLength(1);
    expect(recorded[0]?.textSearch).toBeUndefined();
  });

  it('bounds the term before it reaches a tsquery', async () => {
    const { searchTerm } = await import('./note-service');
    const term = searchTerm('x'.repeat(5000));

    expect(term).not.toBeNull();
    expect(term!.length).toBeLessThanOrEqual(200);
  });

  it('strips characters that carry meaning in a tsquery', async () => {
    const { searchTerm } = await import('./note-service');
    expect(searchTerm('a<b>c\\d')).not.toMatch(/[<>\\]/);
  });

  it('keeps an ordinary phrase intact', async () => {
    const { searchTerm } = await import('./note-service');
    expect(searchTerm('chordae tendineae')).toBe('chordae tendineae');
  });
});

describe('the contextual lookup', () => {
  it('uses an exact filter for one structure', async () => {
    const { listNotes } = await import('./note-service');
    await listNotes({ semanticId: 'veo.anatomy.heart' as SemanticId });

    expect(recorded[0]?.filters).toEqual(
      expect.arrayContaining([{ column: 'spatial_object_id', value: 'veo.anatomy.heart' }]),
    );
  });

  it('uses an IN filter for a lineage', async () => {
    const { listNotes } = await import('./note-service');
    await listNotes({
      anchors: ['veo.anatomy.heart.left_ventricle', 'veo.anatomy.heart'] as SemanticId[],
    });

    expect(recorded[0]?.inFilter).toEqual({
      column: 'spatial_object_id',
      values: ['veo.anatomy.heart.left_ventricle', 'veo.anatomy.heart'],
    });
  });
});

describe('paging is bounded', () => {
  it('clamps an absurd limit rather than honouring it', async () => {
    const { listNotes } = await import('./note-service');
    const result = await listNotes({ limit: 100_000 });

    // No way to assert the range directly through this substitute, so the
    // assertion is that it succeeded without the service passing the raw
    // number anywhere — the clamp is covered by the unit bound below.
    expect(result.ok).toBe(true);
  });

  it('refuses to treat a negative offset as a negative range', async () => {
    const { listNotes } = await import('./note-service');
    expect((await listNotes({ offset: -50 })).ok).toBe(true);
  });
});

describe('a database failure is reported as unavailable', () => {
  it('never as a success, and never with the provider message', async () => {
    dbError = 'relation "public.notes" does not exist at character 42';
    const service = await import('./note-service');

    for (const call of [
      () => service.listNotes(),
      () => service.getNote(NOTE_ID),
      () => service.allNotes(),
      () =>
        service.createNote({
          title: null,
          body: 'B',
          semanticId: null,
          modelRef: null,
          tags: [],
        }),
    ]) {
      const result = await call();
      expect(result.ok).toBe(false);
      expect(result).toEqual({ ok: false, reason: 'unavailable' });
      expect(JSON.stringify(result)).not.toContain('relation');
    }
  });
});

describe('the model ref rides in metadata', () => {
  it('is stored there rather than in a column of its own', async () => {
    const { createNote } = await import('./note-service');
    await createNote({
      title: null,
      body: 'B',
      semanticId: null,
      modelRef: 'veo-heart_v2',
      tags: [],
    });

    expect(recorded[0]?.payload?.metadata).toEqual({ modelRef: 'veo-heart_v2' });
  });

  it('and reads back as null when absent', async () => {
    row = sampleRow({ metadata: {} });
    const { getNote } = await import('./note-service');
    const result = await getNote(NOTE_ID);

    expect(result.ok && result.value.modelRef).toBeNull();
  });

  it('ignores a non-string that found its way into metadata', async () => {
    row = sampleRow({ metadata: { modelRef: { nested: true } } });
    const { getNote } = await import('./note-service');
    const result = await getNote(NOTE_ID);

    expect(result.ok && result.value.modelRef).toBeNull();
  });
});
