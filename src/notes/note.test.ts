import { describe, expect, it } from 'vitest';
import { buildSemanticId } from '@/lib/semantic-id';
import type { ISODateString, UUID } from '@/types/domain/primitives';
import {
  NOTE_LIMITS,
  NOTE_REJECTIONS,
  NOTE_REJECTION_MESSAGES,
  contextualNotes,
  normaliseTags,
  notesToMarkdown,
  validateNote,
  type Note,
} from './note';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: '11111111-1111-4111-8111-111111111111' as UUID,
    semanticId: null,
    modelRef: null,
    title: null,
    body: 'A note.',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z' as ISODateString,
    updatedAt: '2026-01-01T00:00:00.000Z' as ISODateString,
    ...overrides,
  };
}

describe('validating a note', () => {
  it('accepts a plain note and trims it', () => {
    const result = validateNote({ body: '  the chordae stop the valve inverting  ' });

    expect(result).toEqual({
      ok: true,
      note: {
        title: null,
        body: 'the chordae stop the valve inverting',
        semanticId: null,
        modelRef: null,
        tags: [],
      },
    });
  });

  it('accepts a title with no body', () => {
    // "ask about the chordae tendineae" is a legitimate note. Requiring a body
    // would refuse the most common kind of note somebody writes mid-study.
    const result = validateNote({ title: 'Ask about the chordae' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.note.title).toBe('Ask about the chordae');
    expect(result.ok && result.note.body).toBe('');
  });

  it('refuses a note with nothing in it', () => {
    for (const draft of [{}, { body: '' }, { body: '   ' }, { title: '  ', body: '\n\t' }]) {
      expect(validateNote(draft), JSON.stringify(draft)).toEqual({
        ok: false,
        reason: 'empty',
      });
    }
  });

  it('refuses a body past the limit, and accepts one exactly on it', () => {
    expect(validateNote({ body: 'x'.repeat(NOTE_LIMITS.bodyMax) }).ok).toBe(true);
    expect(validateNote({ body: 'x'.repeat(NOTE_LIMITS.bodyMax + 1) })).toEqual({
      ok: false,
      reason: 'body_too_long',
    });
  });

  it('refuses a title past the limit, and accepts one exactly on it', () => {
    expect(validateNote({ title: 'x'.repeat(NOTE_LIMITS.titleMax), body: 'b' }).ok).toBe(true);
    expect(validateNote({ title: 'x'.repeat(NOTE_LIMITS.titleMax + 1), body: 'b' })).toEqual({
      ok: false,
      reason: 'title_too_long',
    });
  });

  it('measures the limit AFTER trimming, so whitespace is not content', () => {
    const body = `  ${'x'.repeat(NOTE_LIMITS.bodyMax)}  `;
    expect(validateNote({ body }).ok).toBe(true);
  });

  describe('the anchor', () => {
    it('accepts a well-formed semantic id', () => {
      const id = buildSemanticId('anatomy', 'heart', 'left_ventricle');
      const result = validateNote({ body: 'b', semanticId: id });

      expect(result.ok && result.note.semanticId).toBe(id);
    });

    it('treats an absent, null or empty anchor as a general note', () => {
      for (const semanticId of [undefined, null, '']) {
        const result = validateNote({ body: 'b', semanticId });
        expect(result.ok && result.note.semanticId, String(semanticId)).toBeNull();
      }
    });

    it('refuses anything that is not a semantic id', () => {
      for (const bad of [
        'heart',
        'veo.anatomy',
        'VEO.anatomy.heart',
        'veo..heart',
        '../../etc/passwd',
        "'; drop table notes; --",
        '<script>alert(1)</script>',
      ]) {
        expect(validateNote({ body: 'b', semanticId: bad }), bad).toEqual({
          ok: false,
          reason: 'invalid_anchor',
        });
      }
    });

    it('normalises a pasted anchor rather than storing it raw', () => {
      /*
       * `parseSemanticId` trims internally, so the grammar accepts a value
       * with surrounding whitespace — a pasted id should work.
       *
       * The assertion that matters is on what is STORED. Checking the trimmed
       * form and keeping the raw one would persist "veo.anatomy.heart ",
       * which the database's anchored `is_semantic_id()` CHECK rejects, and
       * which would never match a lookup for the clean id. The value checked
       * and the value kept must be the same value.
       */
      const result = validateNote({ body: 'b', semanticId: '  veo.anatomy.heart  ' });

      expect(result.ok).toBe(true);
      expect(result.ok && result.note.semanticId).toBe('veo.anatomy.heart');
    });

    it('refuses a non-string anchor', () => {
      expect(validateNote({ body: 'b', semanticId: 42 as never })).toEqual({
        ok: false,
        reason: 'invalid_anchor',
      });
    });
  });

  describe('the model reference', () => {
    it('accepts a plausible ref', () => {
      const result = validateNote({ body: 'b', modelRef: 'veo-heart_v2.1:hosted' });
      expect(result.ok && result.note.modelRef).toBe('veo-heart_v2.1:hosted');
    });

    it('refuses one carrying characters a ref cannot contain', () => {
      for (const bad of ['../secret', 'a b', 'ref<script>', 'x'.repeat(201), 'a/b']) {
        expect(validateNote({ body: 'b', modelRef: bad }), bad).toEqual({
          ok: false,
          reason: 'invalid_model_ref',
        });
      }
    });
  });

  describe('tags', () => {
    it('lower-cases, trims and de-duplicates', () => {
      const result = validateNote({ body: 'b', tags: ['Cardiac', ' cardiac ', 'VALVES', ''] });
      expect(result.ok && result.note.tags).toEqual(['cardiac', 'valves']);
    });

    it('refuses more tags than the limit, counted AFTER de-duplication', () => {
      // 13 distinct tags is over; 13 that collapse to 2 is not.
      const distinct = Array.from({ length: NOTE_LIMITS.tagsMax + 1 }, (_, i) => `tag${i}`);
      expect(validateNote({ body: 'b', tags: distinct })).toEqual({
        ok: false,
        reason: 'too_many_tags',
      });

      const duplicated = Array.from({ length: 13 }, (_, i) => (i % 2 ? 'a' : 'b'));
      expect(validateNote({ body: 'b', tags: duplicated }).ok).toBe(true);
    });

    it('refuses a tag past the length limit', () => {
      expect(validateNote({ body: 'b', tags: ['x'.repeat(NOTE_LIMITS.tagMax + 1)] })).toEqual({
        ok: false,
        reason: 'tag_too_long',
      });
    });

    it('ignores a non-string in the array rather than throwing', () => {
      expect(normaliseTags(['ok', 7 as never, null as never, 'fine'])).toEqual(['ok', 'fine']);
    });
  });

  it('gives every rejection a message that does not name internals', () => {
    for (const reason of NOTE_REJECTIONS) {
      const message = NOTE_REJECTION_MESSAGES[reason];
      expect(message?.length, reason).toBeGreaterThan(0);
      expect(message, reason).not.toMatch(/postgres|supabase|tsvector|column|table|zod/i);
    }
  });
});

describe('notes in context', () => {
  const ventricle = buildSemanticId('anatomy', 'heart', 'left_ventricle');
  const heart = buildSemanticId('anatomy', 'heart');
  const anatomy = buildSemanticId('anatomy', 'heart', 'right_atrium');

  it('returns a note written about the selected structure as direct', () => {
    const own = note({ semanticId: ventricle });
    const result = contextualNotes([own], ventricle);

    expect(result).toEqual([
      { note: own, relation: 'direct', inheritedFrom: null, distance: 0 },
    ]);
  });

  it('returns an ancestor note as INHERITED, naming where it came from', () => {
    /*
     * The distinction this guards: a note about the heart is relevant when
     * looking at the left ventricle, but it is not a note about the left
     * ventricle. Merging them silently would tell a learner they had written
     * something they had not.
     */
    const parent = note({ id: 'p' as UUID, semanticId: heart });
    const result = contextualNotes([parent], ventricle);

    expect(result).toEqual([
      { note: parent, relation: 'inherited', inheritedFrom: heart, distance: 1 },
    ]);
  });

  it('excludes a note on a sibling', () => {
    const sibling = note({ semanticId: anatomy });
    expect(contextualNotes([sibling], ventricle)).toEqual([]);
  });

  it('excludes a note on a DESCENDANT', () => {
    // Inheritance runs upward only. A note about one chamber is not context
    // for the whole heart — that would bury a learner in detail the moment
    // they selected a parent.
    const child = note({ semanticId: ventricle });
    expect(contextualNotes([child], heart)).toEqual([]);
  });

  it('excludes unanchored notes', () => {
    expect(contextualNotes([note({ semanticId: null })], ventricle)).toEqual([]);
  });

  it('puts direct notes before inherited ones', () => {
    const parent = note({ id: 'p' as UUID, semanticId: heart, updatedAt: '2026-06-01T00:00:00.000Z' as ISODateString });
    const own = note({ id: 'o' as UUID, semanticId: ventricle, updatedAt: '2026-01-01T00:00:00.000Z' as ISODateString });

    // The parent note is newer, and still comes second: relevance beats
    // recency across the two groups.
    const result = contextualNotes([parent, own], ventricle);
    expect(result.map((entry) => entry.note.id)).toEqual(['o', 'p']);
  });

  it('orders inherited notes nearest-ancestor first', () => {
    const near = note({ id: 'near' as UUID, semanticId: heart });
    const far = note({ id: 'far' as UUID, semanticId: buildSemanticId('anatomy', 'cardiovascular') });

    // `veo.anatomy.cardiovascular` is not in this lineage, so it is excluded;
    // build a real two-level case instead.
    const deep = buildSemanticId('anatomy', 'heart', 'left_ventricle', 'papillary_muscle');
    const result = contextualNotes([far, near, note({ id: 'mid' as UUID, semanticId: buildSemanticId('anatomy', 'heart', 'left_ventricle') })], deep);

    expect(result.map((entry) => entry.note.id)).toEqual(['mid', 'near']);
    expect(result.map((entry) => entry.distance)).toEqual([1, 2]);
  });

  it('orders within a group by recency', () => {
    const older = note({ id: 'older' as UUID, semanticId: ventricle, updatedAt: '2026-01-01T00:00:00.000Z' as ISODateString });
    const newer = note({ id: 'newer' as UUID, semanticId: ventricle, updatedAt: '2026-09-01T00:00:00.000Z' as ISODateString });

    expect(contextualNotes([older, newer], ventricle).map((e) => e.note.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});

describe('exporting notes', () => {
  const exportedAt = '2026-10-01T09:00:00.000Z';

  it('says so plainly when there is nothing to export', () => {
    const markdown = notesToMarkdown([], exportedAt);
    expect(markdown).toContain('have not written any notes');
  });

  it('carries every note\'s title, body and tags', () => {
    const markdown = notesToMarkdown(
      [note({ title: 'Chordae', body: 'They stop inversion.', tags: ['cardiac'] })],
      exportedAt,
    );

    expect(markdown).toContain('### Chordae');
    expect(markdown).toContain('They stop inversion.');
    expect(markdown).toContain('Tags: cardiac');
  });

  it('groups by the structure a note is about', () => {
    const heart = buildSemanticId('anatomy', 'heart');
    const markdown = notesToMarkdown(
      [
        note({ id: 'a' as UUID, semanticId: heart, body: 'anchored' }),
        note({ id: 'b' as UUID, semanticId: null, body: 'general' }),
      ],
      exportedAt,
    );

    expect(markdown).toContain(`## ${heart}`);
    expect(markdown).toContain('## General notes');
    // General notes last: the anchored ones are the structured part.
    expect(markdown.indexOf(`## ${heart}`)).toBeLessThan(markdown.indexOf('## General notes'));
  });

  it('stamps when it was exported, so an old file is identifiable', () => {
    expect(notesToMarkdown([note()], exportedAt)).toContain(exportedAt);
  });

  it('is readable without VEO', () => {
    // No VEO-specific syntax, no JSON envelope, no custom markers. If this
    // ever needs a parser, it has stopped being an export.
    const markdown = notesToMarkdown([note({ title: 'T', body: 'B' })], exportedAt);
    expect(markdown).not.toMatch(/\{|\}|data-veo|<[a-z]+>/);
  });
});
