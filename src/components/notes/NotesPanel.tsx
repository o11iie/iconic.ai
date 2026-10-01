'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { semanticIdToLabel, type SemanticId } from '@/lib/semantic-id';
import { contextualNotes, NOTE_LIMITS, type ContextualNote, type Note } from '@/notes/note';

/**
 * A learner's notes.
 *
 * One component serves both places notes appear — anchored to the selected
 * structure in the workspace, and as the whole collection in the Library —
 * because they are the same thing viewed through a different filter. Two
 * components would be two places for "what a note looks like" to drift.
 *
 * Every piece of state here comes from the server. Nothing is kept locally
 * and presented as saved: after a write the list is re-read, so what a
 * learner sees is what exists.
 */

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly notes: readonly Note[]; readonly total: number };

export interface NotesPanelProps {
  /**
   * The structure the learner is looking at.
   *
   * When set, the panel shows notes on it and on its ancestors, and a new
   * note is anchored there. When null it is the whole collection.
   */
  readonly semanticId?: SemanticId | null;
  readonly modelRef?: string | null;
  /** Whether to offer search. The workspace does not; the Library does. */
  readonly searchable?: boolean;
  /** Whether to offer export. Library only — it is a whole-corpus action. */
  readonly exportable?: boolean;
  /**
   * Whether a learner is signed in, as the SERVER resolved it.
   *
   * Notes are private, so without a session there is nothing to fetch.
   * Omitted means "ask and find out", which is right for a route that is
   * already behind authentication (the Library). /explore is deliberately
   * public, so it passes the answer in rather than firing a request
   * guaranteed to 401 on every selection a visitor makes.
   *
   * This is a rendering hint and nothing more: the route re-decides on every
   * request, so a browser claiming to be signed in gets 401 regardless.
   */
  readonly signedIn?: boolean;
  readonly className?: string;
}

export function NotesPanel({
  semanticId = null,
  modelRef = null,
  searchable = false,
  exportable = false,
  signedIn,
  className,
}: NotesPanelProps) {
  const [phase, setPhase] = useState<Phase>(
    signedIn === false ? { kind: 'signed_out' } : { kind: 'loading' },
  );
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    // Known to be signed out: nothing to ask for.
    if (signedIn === false) {
      setPhase({ kind: 'signed_out' });
      return;
    }

    const params = new URLSearchParams();
    if (semanticId) {
      params.set('semanticId', semanticId);
      // Ancestors too: a note about the heart bears on the left ventricle.
      params.set('includeAncestors', 'true');
    }
    if (query.trim()) params.set('q', query.trim());

    try {
      const response = await fetch(`/api/notes?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json();

      if (response.status === 401) return setPhase({ kind: 'signed_out' });
      if (!response.ok || !body.ok) return setPhase({ kind: 'unavailable' });

      setPhase({ kind: 'ready', notes: body.notes as Note[], total: body.total as number });
    } catch {
      setPhase({ kind: 'unavailable' });
    }
  }, [semanticId, query, signedIn]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  /**
   * What to render, in order.
   *
   * With a structure selected the server returned the lineage, so the pure
   * `contextualNotes` decides which are direct and which are inherited —
   * the same function the tests exercise, rather than a second ordering rule
   * living in a component.
   */
  const entries: ContextualNote[] = useMemo(() => {
    if (phase.kind !== 'ready') return [];
    if (semanticId) return contextualNotes(phase.notes, semanticId);
    return phase.notes.map((note) => ({
      note,
      relation: 'direct' as const,
      inheritedFrom: null,
      distance: 0,
    }));
  }, [phase, semanticId]);

  if (phase.kind === 'loading') {
    return (
      <div className={cn('p-4', className)}>
        <p className="text-sm text-ink-muted">Loading your notes…</p>
      </div>
    );
  }

  if (phase.kind === 'signed_out') {
    return (
      <div className={cn('p-4', className)}>
        <EmptyState
          title="Sign in to keep notes"
          description="Notes are private to your account, so VEO needs to know who you are before it can keep them."
          icon={<Icon name="lock" size={22} />}
          action={
            <Link
              href={`/login?next=${encodeURIComponent(semanticId ? '/explore' : '/library')}`}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-strong"
            >
              Sign in
            </Link>
          }
        />
      </div>
    );
  }

  if (phase.kind === 'unavailable') {
    return (
      <div className={cn('p-4', className)}>
        <p className="text-sm text-ink-muted" data-veo-notes-unavailable>
          VEO could not reach your notes just now. Nothing has been lost — this view only
          reads them.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)} data-veo-notes>
      {searchable ? (
        <label className="flex flex-col gap-1.5">
          <span className="veo-sr-only">Search your notes</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={NOTE_LIMITS.queryMax}
            placeholder="Search your notes"
            className="w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            data-veo-notes-search
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!composing && !editing ? (
          <Button size="sm" onClick={() => setComposing(true)} data-veo-note-new>
            {semanticId ? 'Note this structure' : 'New note'}
          </Button>
        ) : null}

        {exportable ? <ExportButton /> : null}

        {phase.total > 0 ? (
          <span className="text-[11px] text-ink-faint" data-veo-notes-count>
            {phase.total} {phase.total === 1 ? 'note' : 'notes'}
          </span>
        ) : null}
      </div>

      {composing ? (
        <NoteEditor
          semanticId={semanticId}
          modelRef={modelRef}
          onDone={async () => {
            setComposing(false);
            await load();
          }}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      {editing ? (
        <NoteEditor
          note={editing}
          semanticId={editing.semanticId}
          modelRef={editing.modelRef}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {entries.length === 0 && !composing ? (
        <EmptyState
          title={query.trim() ? 'Nothing matched' : 'No notes yet'}
          description={
            query.trim()
              ? 'No note of yours contains that. Try a different word.'
              : semanticId
                ? 'Write down what you work out about this structure and it will be here when you come back to it.'
                : 'Your notes will appear here. Write one from the workspace while you are looking at a structure, or start one now.'
          }
          icon={<Icon name="learn" size={22} />}
          className="border-0 bg-transparent"
        />
      ) : null}

      <ul className="flex min-w-0 flex-col gap-2">
        {entries.map((entry) => (
          <NoteCard
            key={entry.note.id}
            entry={entry}
            onEdit={() => setEditing(entry.note)}
            onDeleted={load}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NoteCard({
  entry,
  onEdit,
  onDeleted,
}: {
  readonly entry: ContextualNote;
  readonly onEdit: () => void;
  readonly onDeleted: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { note } = entry;

  async function remove() {
    try {
      const response = await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setFailed(body?.error?.message ?? 'VEO could not delete that note.');
        return;
      }
      await onDeleted();
    } catch {
      setFailed('VEO could not reach the server.');
    }
  }

  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-hairline bg-surface-raised p-3"
      data-veo-note={note.id}
      data-veo-note-relation={entry.relation}
    >
      {entry.relation === 'inherited' && entry.inheritedFrom ? (
        /*
         * Labelled, never silently merged. A note about the heart is relevant
         * when looking at the left ventricle, but it is not a note ABOUT the
         * left ventricle — and telling a learner otherwise would credit them
         * with something they did not write.
         */
        <p className="flex items-center gap-1.5 text-[11px] text-ink-faint" data-veo-note-inherited>
          <Icon name="link" size={12} className="shrink-0" />
          <span>From {semanticIdToLabel(entry.inheritedFrom)}</span>
        </p>
      ) : null}

      {/*
        * `overflow-wrap: anywhere` on both, and it is load-bearing.
        *
        * A note is arbitrary text a learner pasted. `whitespace-pre-wrap`
        * keeps their line breaks, but it will not break an unbroken run — and
        * a pasted URL, a chemical name or a token is exactly that. The first
        * browser run measured 2,726px of horizontal overflow at 360px wide
        * from one 400-character word.
        *
        * `break-words` is not enough: it breaks BETWEEN words, so a single
        * long word still overflows. `anywhere` breaks inside one.
        */}
      {note.title ? (
        <p
          className="text-sm font-medium text-ink [overflow-wrap:anywhere]"
          data-veo-note-title
        >
          {note.title}
        </p>
      ) : null}

      {note.body ? (
        <p
          className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted [overflow-wrap:anywhere]"
          data-veo-note-body
        >
          {note.body}
        </p>
      ) : null}

      {note.tags.length > 0 ? (
        <ul className="flex min-w-0 flex-wrap gap-1.5">
          {note.tags.map((tag) => (
            <li key={tag} className="min-w-0 [overflow-wrap:anywhere]">
              <Badge>{tag}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {failed ? (
        <p className="text-[11px] text-warning" role="alert" data-veo-note-error>
          {failed}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit} data-veo-note-edit>
          Edit
        </Button>

        {confirming ? (
          <>
            <Button variant="danger" size="sm" onClick={remove} data-veo-note-delete-confirm>
              Delete it
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(true)}
            data-veo-note-delete
          >
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'failed'; readonly message: string };

function NoteEditor({
  note,
  semanticId,
  modelRef,
  onDone,
  onCancel,
}: {
  readonly note?: Note;
  readonly semanticId: SemanticId | null;
  readonly modelRef: string | null;
  readonly onDone: () => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const empty = title.trim().length === 0 && body.trim().length === 0;

  async function save() {
    setState({ kind: 'saving' });

    try {
      const response = await fetch(note ? `/api/notes/${note.id}` : '/api/notes', {
        method: note ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || null,
          body,
          semanticId,
          modelRef,
          tags: note?.tags ?? [],
        }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        // Whatever the server said, verbatim: it is the only thing that knows
        // why, and inventing a friendlier message would hide the reason.
        setState({ kind: 'failed', message: payload?.error?.message ?? 'VEO could not save that.' });
        return;
      }

      await onDone();
    } catch {
      setState({ kind: 'failed', message: 'VEO could not reach the server.' });
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-cyan/40 bg-surface-raised p-3"
      data-veo-note-editor
    >
      {semanticId ? (
        <p className="text-[11px] text-ink-faint">
          About {semanticIdToLabel(semanticId)}
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="veo-sr-only">Note title</span>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setState({ kind: 'idle' });
          }}
          maxLength={NOTE_LIMITS.titleMax}
          placeholder="Title (optional)"
          className="w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
          data-veo-note-title-input
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="veo-sr-only">Note</span>
        <textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setState({ kind: 'idle' });
          }}
          maxLength={NOTE_LIMITS.bodyMax}
          rows={4}
          placeholder="What did you work out?"
          className="w-full resize-y rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
          data-veo-note-body-input
        />
      </label>

      {state.kind === 'failed' ? (
        <p className="text-[11px] text-warning" role="alert" data-veo-note-save-error>
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={save}
          /*
           * Disabled while empty so the control is never a dead button. The
           * server checks the same rule regardless — this only spares a
           * pointless round trip.
           */
          disabled={empty || state.kind === 'saving'}
          data-veo-note-save
        >
          {state.kind === 'saving' ? 'Saving…' : note ? 'Save changes' : 'Save note'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} data-veo-note-cancel>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Export, which is a paid capability.
 *
 * The button is always present and always pressable. A learner without the
 * entitlement discovers that by being told, with the remedy — not by finding
 * a control greyed out for a reason the interface never explains.
 */
function ExportButton() {
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setRefused(null);

    try {
      const response = await fetch('/api/notes/export');

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRefused(body?.error?.message ?? 'VEO could not build your export.');
        return;
      }

      const text = await response.text();
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `veo-notes-${new Date().toISOString().slice(0, 10)}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setRefused('VEO could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={run} disabled={busy} data-veo-notes-export>
        {busy ? 'Preparing…' : 'Export'}
      </Button>

      {refused ? (
        <span className="flex items-center gap-1.5 text-[11px] text-warning" role="alert" data-veo-export-refused>
          <span>{refused}</span>
          <Link href="/plans" className="text-cyan underline-offset-2 hover:underline">
            See plans
          </Link>
        </span>
      ) : null}
    </>
  );
}
