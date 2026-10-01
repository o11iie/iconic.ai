import { isSemanticId, semanticIdAncestors, type SemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';

/**
 * What a learner writes down, and the rules about it.
 *
 * Pure: no database, no clock, no network. Everything here is a function of
 * its arguments, so the rules that decide what a note may contain and which
 * notes belong to a structure are testable without standing anything up — and
 * the same functions run on the server and in the browser without two
 * implementations drifting apart.
 */

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

export interface Note {
  readonly id: UUID;
  /** Null when the note is general rather than about one structure. */
  readonly semanticId: SemanticId | null;
  /** Which model the learner was in, if any. Context, not authority. */
  readonly modelRef: string | null;
  readonly title: string | null;
  readonly body: string;
  readonly tags: readonly string[];
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

/**
 * A note as it relates to the structure currently selected.
 *
 * `relation` is the whole point of this type. A note written about the heart
 * is relevant when looking at the left ventricle, but it is NOT a note about
 * the left ventricle, and silently merging the two would tell a learner they
 * had written something they had not. So inherited notes are carried
 * separately and labelled, with the structure they actually belong to.
 */
export interface ContextualNote {
  readonly note: Note;
  readonly relation: 'direct' | 'inherited';
  /** For an inherited note, the ancestor it was written about. */
  readonly inheritedFrom: SemanticId | null;
  /**
   * How far above the selection the note sits. 0 for a direct note.
   *
   * Used for ordering: a note on the immediate parent is more relevant than
   * one on the domain root.
   */
  readonly distance: number;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * The limits, in one place.
 *
 * Mirrored by CHECK constraints in `0005_notes_capture.sql`. Two enforcement
 * points for one rule is usually a smell; here it is deliberate, because the
 * API is not the only thing that can reach the table and "the application
 * validates it" is not a constraint.
 */
export const NOTE_LIMITS = {
  /** A long essay. Bounds one row's cost, not what anybody wants to say. */
  bodyMax: 20_000,
  titleMax: 200,
  tagsMax: 12,
  tagMax: 40,
  /** Bounds a page of results, so a list query cannot be made unbounded. */
  pageMax: 100,
  pageDefault: 25,
  /** Bounds a search term, which goes into a tsquery. */
  queryMax: 200,
} as const;

export const NOTE_REJECTIONS = [
  'empty',
  'body_too_long',
  'title_too_long',
  'too_many_tags',
  'tag_too_long',
  'invalid_anchor',
  'invalid_model_ref',
] as const;
export type NoteRejection = (typeof NOTE_REJECTIONS)[number];

export const NOTE_REJECTION_MESSAGES: Record<NoteRejection, string> = {
  empty: 'A note needs something in it.',
  body_too_long: `A note can be up to ${NOTE_LIMITS.bodyMax.toLocaleString()} characters.`,
  title_too_long: `A title can be up to ${NOTE_LIMITS.titleMax} characters.`,
  too_many_tags: `A note can carry up to ${NOTE_LIMITS.tagsMax} tags.`,
  tag_too_long: `A tag can be up to ${NOTE_LIMITS.tagMax} characters.`,
  invalid_anchor: 'That is not a structure VEO recognises.',
  invalid_model_ref: 'That is not a model VEO recognises.',
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface NoteDraft {
  readonly title?: string | null;
  readonly body?: string;
  readonly semanticId?: string | null;
  readonly modelRef?: string | null;
  readonly tags?: readonly string[];
}

/** A draft, normalised and ready to persist. */
export interface NormalisedNote {
  readonly title: string | null;
  readonly body: string;
  readonly semanticId: SemanticId | null;
  readonly modelRef: string | null;
  readonly tags: readonly string[];
}

export type NoteValidation =
  | { readonly ok: true; readonly note: NormalisedNote }
  | { readonly ok: false; readonly reason: NoteRejection };

/**
 * A model reference, as the anatomy provider issues them.
 *
 * Bounded and restricted to the characters a ref can contain. The ref is only
 * ever context on a note — nothing is loaded from it here — but an unbounded
 * string that gets rendered later is still worth refusing at the door.
 */
const MODEL_REF = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * Normalise and check a draft.
 *
 * Returns the FIRST rejection rather than a list. A learner fixes one thing at
 * a time, and a form that reports six problems about one field is worse than
 * one that reports the first.
 */
export function validateNote(draft: NoteDraft): NoteValidation {
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const body = typeof draft.body === 'string' ? draft.body.trim() : '';

  /*
   * Emptiness is judged on title AND body together.
   *
   * A note that is only a title is a legitimate thing to write — "ask about
   * the chordae tendineae" is a note. What is not legitimate is a row with
   * nothing in it at all, which is what an accidental save produces.
   */
  if (body.length === 0 && title.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (body.length > NOTE_LIMITS.bodyMax) return { ok: false, reason: 'body_too_long' };
  if (title.length > NOTE_LIMITS.titleMax) return { ok: false, reason: 'title_too_long' };

  // ---- the anchor ---------------------------------------------------------
  //
  // An anchor is accepted only if it is a well-formed semantic id. That is a
  // grammar check, not an existence check: whether the structure exists in a
  // loaded model is decided by the semantic registry at render time, and a
  // note must survive the model it was written against being swapped for a
  // licensed one.

  let semanticId: SemanticId | null = null;
  if (draft.semanticId !== undefined && draft.semanticId !== null) {
    /*
     * TRIMMED BEFORE BOTH the check and the store.
     *
     * `parseSemanticId` trims internally, so `isSemanticId` accepts
     * "veo.anatomy.heart " — deliberately tolerant of a pasted value. Storing
     * the raw string after a tolerant check is the bug that tolerance
     * invites: the database's own `is_semantic_id()` CHECK is anchored and
     * does NOT trim, so the insert would fail and the learner would be told
     * VEO could not reach their notes. Even if it persisted, it would never
     * match a lookup for the untrimmed id and the note would be invisible.
     *
     * So the value that is checked and the value that is stored are the same
     * value.
     */
    const anchor = typeof draft.semanticId === 'string' ? draft.semanticId.trim() : null;

    if (anchor !== null && anchor !== '') {
      if (!isSemanticId(anchor)) return { ok: false, reason: 'invalid_anchor' };
      semanticId = anchor;
    } else if (anchor === null) {
      // A non-string that is not null or undefined, e.g. a number.
      return { ok: false, reason: 'invalid_anchor' };
    }
  }

  // Same discipline as the anchor: trim once, then check and store that.
  let modelRef: string | null = null;
  if (draft.modelRef !== undefined && draft.modelRef !== null) {
    const ref = typeof draft.modelRef === 'string' ? draft.modelRef.trim() : null;

    if (ref !== null && ref !== '') {
      if (!MODEL_REF.test(ref)) return { ok: false, reason: 'invalid_model_ref' };
      modelRef = ref;
    } else if (ref === null) {
      return { ok: false, reason: 'invalid_model_ref' };
    }
  }

  // ---- tags ---------------------------------------------------------------

  const tags = normaliseTags(draft.tags ?? []);
  if (tags.length > NOTE_LIMITS.tagsMax) return { ok: false, reason: 'too_many_tags' };
  if (tags.some((tag) => tag.length > NOTE_LIMITS.tagMax)) {
    return { ok: false, reason: 'tag_too_long' };
  }

  return {
    ok: true,
    note: { title: title.length > 0 ? title : null, body, semanticId, modelRef, tags },
  };
}

/**
 * Tags, tidied.
 *
 * Lower-cased, trimmed, de-duplicated, empties dropped, order preserved.
 * Case-folding matters: "Cardiac" and "cardiac" are one tag to a learner, and
 * treating them as two makes filtering useless within a week.
 */
export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Which of a learner's notes bear on the structure they have selected.
 *
 * Direct notes first, then inherited ones nearest-ancestor-first, because a
 * note on the immediate parent is more likely to be relevant than one on the
 * domain root. Within a group, most recently updated first.
 *
 * `semanticIdAncestors` returns nearest-first, which is what makes `distance`
 * simply the index + 1.
 */
export function contextualNotes(
  notes: readonly Note[],
  selected: SemanticId,
): ContextualNote[] {
  const ancestors = semanticIdAncestors(selected);
  const distanceOf = new Map<string, number>();
  ancestors.forEach((ancestor, index) => distanceOf.set(ancestor, index + 1));

  const direct: ContextualNote[] = [];
  const inherited: ContextualNote[] = [];

  for (const note of notes) {
    if (note.semanticId === null) continue;

    if (note.semanticId === selected) {
      direct.push({ note, relation: 'direct', inheritedFrom: null, distance: 0 });
      continue;
    }

    const distance = distanceOf.get(note.semanticId);
    if (distance !== undefined) {
      inherited.push({
        note,
        relation: 'inherited',
        inheritedFrom: note.semanticId,
        distance,
      });
    }
  }

  const byRecency = (a: ContextualNote, b: ContextualNote) =>
    b.note.updatedAt.localeCompare(a.note.updatedAt);

  direct.sort(byRecency);
  inherited.sort((a, b) => a.distance - b.distance || byRecency(a, b));

  return [...direct, ...inherited];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * A learner's notes as Markdown.
 *
 * Markdown rather than JSON or PDF: it opens in anything, it is readable
 * without VEO, and it survives VEO. An export that needs the product it came
 * from in order to be read is not really an export.
 *
 * Grouped by anchor so the structure a note is about is visible, with general
 * notes last.
 */
export function notesToMarkdown(notes: readonly Note[], exportedAt: string): string {
  const lines: string[] = ['# VEO notes', '', `_Exported ${exportedAt}_`, ''];

  if (notes.length === 0) {
    lines.push('You have not written any notes yet.');
    return `${lines.join('\n')}\n`;
  }

  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = note.semanticId ?? '';
    const group = groups.get(key);
    if (group) group.push(note);
    else groups.set(key, [note]);
  }

  // Anchored groups first, alphabetically; general notes at the end.
  const anchored = [...groups.keys()].filter((key) => key !== '').sort();
  const ordered = groups.has('') ? [...anchored, ''] : anchored;

  for (const key of ordered) {
    lines.push(`## ${key === '' ? 'General notes' : key}`, '');

    for (const note of groups.get(key) ?? []) {
      if (note.title) lines.push(`### ${note.title}`, '');
      if (note.body) lines.push(note.body, '');
      if (note.tags.length > 0) lines.push(`Tags: ${note.tags.join(', ')}`, '');
      lines.push(`_Last edited ${note.updatedAt}_`, '');
    }
  }

  return `${lines.join('\n')}\n`;
}
