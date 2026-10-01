import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { serverLog } from '@/observability/log';
import type { SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import { NOTE_LIMITS, type NormalisedNote, type Note } from '../note';

/**
 * Notes, persisted.
 *
 * ## Identity
 *
 * Resolved from the Supabase session on every call, exactly as Gate 12's
 * `resolveLearning` does. **No function here accepts an owner id.** A route
 * cannot forget to check one it was never given, and a note id arriving from
 * a URL is treated as what it is — a client-supplied identifier — so every
 * statement is additionally scoped by `owner_id`.
 *
 * That scoping is belt and braces: the `notes_*_own` policies would refuse a
 * foreign row anyway, and Gate 15's RLS suite proves it by execution against
 * real PostgreSQL. The application must still not have the option, because a
 * policy is one migration away from being edited and an application that
 * never asks for another learner's row cannot be made to return one.
 *
 * ## Why a missing note is 404 and not 403
 *
 * A learner asking for a note that belongs to somebody else gets exactly what
 * they would get for an id that does not exist. 403 would confirm the id is
 * real, which turns the endpoint into an oracle for enumerating note ids.
 * `notFound` is therefore one outcome covering both cases, deliberately.
 */

export const NOTE_FAILURES = [
  'unauthenticated',
  'not_configured',
  'not_found',
  'unavailable',
] as const;
export type NoteFailure = (typeof NOTE_FAILURES)[number];

export type NoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: NoteFailure };

/** The columns a note is read back as. Listed, never `select('*')`. */
const COLUMNS = 'id, spatial_object_id, title, body, tags, created_at, updated_at, metadata';

interface NoteRow {
  id: string;
  spatial_object_id: string | null;
  title: string | null;
  body: string;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

/**
 * A row as the domain sees it.
 *
 * `modelRef` lives in `metadata`, not in a column of its own. The table is
 * Gate 1's and a migration that added a column would be a schema change for
 * something that is pure context — never queried, never joined, never
 * authoritative. `metadata` is jsonb and exists for exactly this.
 */
function toNote(row: NoteRow): Note {
  const modelRef = row.metadata?.modelRef;

  return {
    id: row.id as UUID,
    semanticId: (row.spatial_object_id as SemanticId | null) ?? null,
    modelRef: typeof modelRef === 'string' ? modelRef : null,
    title: row.title,
    body: row.body,
    tags: row.tags ?? [],
    createdAt: row.created_at as ISODateString,
    updatedAt: row.updated_at as ISODateString,
  };
}

/** The request's client and the learner it belongs to. */
type Session = { client: SupabaseClient; userId: UUID };

async function session(): Promise<NoteResult<Session>> {
  const typed = await createSupabaseServerClient();
  if (!typed) return { ok: false, reason: 'not_configured' };

  /*
   * Widened for the same reason Gate 12's store and Gate 14's resolver widen:
   * `Database` is generated from Gate 1's schema and its `notes` shape
   * predates the metadata use above. This loses compile-time column checking
   * on one table and widens no security boundary — the client still carries
   * the caller's cookies and the anon key, so every statement runs under
   * their own RLS context.
   */
  const client = typed as unknown as SupabaseClient;

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, reason: 'unauthenticated' };

  return { ok: true, value: { client, userId: data.user.id as UUID } };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ListQuery {
  /** Free text. Matched against title and body. */
  readonly q?: string;
  /** Restrict to notes anchored to exactly this structure. */
  readonly semanticId?: SemanticId;
  /**
   * Restrict to notes anchored anywhere in this structure's lineage.
   *
   * Used by the workspace, which needs ancestors too. The ancestor list is
   * computed by the caller from the live semantic model and passed in, so
   * this layer never has to know the hierarchy.
   */
  readonly anchors?: readonly SemanticId[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface NotePage {
  readonly notes: readonly Note[];
  /** Total matching, for a result count the UI can show honestly. */
  readonly total: number;
}

export async function listNotes(query: ListQuery = {}): Promise<NoteResult<NotePage>> {
  const resolved = await session();
  if (!resolved.ok) return resolved;
  const { client, userId } = resolved.value;

  const limit = Math.min(
    Math.max(1, Math.floor(query.limit ?? NOTE_LIMITS.pageDefault)),
    NOTE_LIMITS.pageMax,
  );
  const offset = Math.max(0, Math.floor(query.offset ?? 0));

  let builder = client
    .from('notes')
    // `exact` so the UI can say "7 notes" rather than "7 shown". A count that
    // is really a page size is a number that lies on the second page.
    .select(COLUMNS, { count: 'exact' })
    .eq('owner_id', userId);

  if (query.semanticId) {
    builder = builder.eq('spatial_object_id', query.semanticId);
  } else if (query.anchors && query.anchors.length > 0) {
    builder = builder.in('spatial_object_id', [...query.anchors]);
  }

  if (query.q) {
    const term = searchTerm(query.q);
    // An empty term after sanitising means the learner typed only punctuation.
    // Returning everything would be wrong; returning nothing is the truth.
    if (term === null) return { ok: true, value: { notes: [], total: 0 } };
    builder = builder.textSearch('fts', term, { config: 'english', type: 'websearch' });
  }

  const { data, error, count } = await builder
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    serverLog('error', 'notes.list_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }

  return {
    ok: true,
    value: {
      notes: ((data ?? []) as NoteRow[]).map(toNote),
      total: count ?? 0,
    },
  };
}

/**
 * Sanitise a search term.
 *
 * `websearch` syntax is forgiving, but the term still reaches a tsquery, so
 * it is bounded and stripped of the characters that carry meaning there.
 * Returns null when nothing usable survives, which the caller treats as "no
 * matches" rather than "no filter" — the difference between showing a learner
 * nothing and showing them everything.
 */
export function searchTerm(raw: string): string | null {
  const cleaned = raw
    .slice(0, NOTE_LIMITS.queryMax)
    .replace(/[\0<>\\]/g, ' ')
    .trim();

  return cleaned.length === 0 ? null : cleaned;
}

export async function getNote(id: UUID): Promise<NoteResult<Note>> {
  const resolved = await session();
  if (!resolved.ok) return resolved;
  const { client, userId } = resolved.value;

  const { data, error } = await client
    .from('notes')
    .select(COLUMNS)
    .eq('id', id)
    // Scoped by owner as well as id. See the note at the top of this file.
    .eq('owner_id', userId)
    .maybeSingle();

  if (error) {
    serverLog('error', 'notes.get_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }
  if (!data) return { ok: false, reason: 'not_found' };

  return { ok: true, value: toNote(data as NoteRow) };
}

/** Every note the learner owns, for export. Ordered for a readable document. */
export async function allNotes(): Promise<NoteResult<readonly Note[]>> {
  const resolved = await session();
  if (!resolved.ok) return resolved;
  const { client, userId } = resolved.value;

  const { data, error } = await client
    .from('notes')
    .select(COLUMNS)
    .eq('owner_id', userId)
    .order('spatial_object_id', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false });

  if (error) {
    serverLog('error', 'notes.export_read_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }

  return { ok: true, value: ((data ?? []) as NoteRow[]).map(toNote) };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function createNote(input: NormalisedNote): Promise<NoteResult<Note>> {
  const resolved = await session();
  if (!resolved.ok) return resolved;
  const { client, userId } = resolved.value;

  /*
   * Built field by field from the VALIDATED input, never spread from a
   * request body. A spread would write whatever arrived, so adding a column
   * to `notes` would silently make it client-writable — the same discipline
   * Gate 15's profile update follows.
   *
   * `owner_id` is the session's, and nothing else can set it: the insert
   * policy's `with check (owner_id = auth.uid())` refuses a forged one, and
   * this layer never offers the chance.
   */
  const { data, error } = await client
    .from('notes')
    .insert({
      owner_id: userId,
      spatial_object_id: input.semanticId,
      title: input.title,
      body: input.body,
      tags: [...input.tags],
      metadata: input.modelRef ? { modelRef: input.modelRef } : {},
    })
    .select(COLUMNS)
    .single();

  if (error) {
    serverLog('error', 'notes.create_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }

  // The body is NOT logged. A note is personal data and a log is the wrong
  // place for it; the id and the anchor are enough to investigate anything.
  serverLog('info', 'notes.created', { anchored: input.semanticId !== null });

  return { ok: true, value: toNote(data as NoteRow) };
}

export async function updateNote(
  id: UUID,
  input: NormalisedNote,
): Promise<NoteResult<Note>> {
  const resolved = await session();
  if (!resolved.ok) return resolved;
  const { client, userId } = resolved.value;

  const { data, error } = await client
    .from('notes')
    .update({
      spatial_object_id: input.semanticId,
      title: input.title,
      body: input.body,
      tags: [...input.tags],
      metadata: input.modelRef ? { modelRef: input.modelRef } : {},
      // `updated_at` is deliberately absent: the `set_updated_at` trigger owns
      // it, so the timestamp is the server's clock rather than a client's.
    })
    .eq('id', id)
    .eq('owner_id', userId)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    serverLog('error', 'notes.update_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }
  // No row came back: either no such note, or it is somebody else's. One
  // answer for both, on purpose.
  if (!data) return { ok: false, reason: 'not_found' };

  serverLog('info', 'notes.updated', {});
  return { ok: true, value: toNote(data as NoteRow) };
}

export async function deleteNote(id: UUID): Promise<NoteResult<null>> {
  const resolved = await session();
  if (!resolved.ok) return resolved;
  const { client, userId } = resolved.value;

  /*
   * `select()` on the delete so the outcome is known.
   *
   * Without it, deleting a note that does not exist and deleting somebody
   * else's are both "success" — PostgREST reports a delete that matched no
   * rows as fine, and RLS makes a foreign row match nothing. The learner
   * would be told their note was deleted when nothing happened.
   */
  const { data, error } = await client
    .from('notes')
    .delete()
    .eq('id', id)
    .eq('owner_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    serverLog('error', 'notes.delete_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }
  if (!data) return { ok: false, reason: 'not_found' };

  serverLog('info', 'notes.deleted', {});
  return { ok: true, value: null };
}
