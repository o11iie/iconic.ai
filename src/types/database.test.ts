import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';

/**
 * Regression guard for a real defect.
 *
 * `Database` was originally declared with `interface`. TypeScript gives type
 * aliases an implicit index signature but not interfaces, so the schema failed
 * supabase-js's `Record<string, GenericTable>` constraint — silently, with no
 * error at the definition site. The only symptom was that every query
 * builder's argument type collapsed to `never`, so no insert or update could
 * ever typecheck.
 *
 * These assertions are compile-time: if the schema stops satisfying the
 * client's constraint, this file fails `tsc` before it ever runs.
 */

type IsNever<T> = [T] extends [never] ? true : false;
type UpdateArg = Database['public']['Tables']['profiles']['Update'];
type InsertArg = Database['public']['Tables']['profiles']['Insert'];

// If the schema regresses, these become `true` and the assignments below fail.
const updateIsUsable: IsNever<UpdateArg> = false;
const insertIsUsable: IsNever<InsertArg> = false;

describe('Database schema type', () => {
  it('keeps query-builder arguments usable rather than collapsing to never', () => {
    expect(updateIsUsable).toBe(false);
    expect(insertIsUsable).toBe(false);
  });

  it('satisfies the supabase-js schema constraint at compile time', () => {
    const client = createClient<Database>('https://example.supabase.co', 'anon-key');

    // These calls only compile if the schema constraint holds. They are never
    // awaited, so no network request is made.
    const update = client.from('profiles').update({ display_name: 'Ada' });
    const insert = client.from('flashcards').insert({
      owner_id: '00000000-0000-0000-0000-000000000000',
      subject_id: null,
      material_id: null,
      front: 'front',
      back: 'back',
      concept_ids: [],
      spatial_object_id: null,
      generated_by: 'authored',
      tags: [],
      metadata: {},
    });

    expect(typeof update.eq).toBe('function');
    expect(typeof insert.select).toBe('function');
  });
});
