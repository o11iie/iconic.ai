/**
 * Mutation testing for Gate 16.
 *
 * The notes suites pass. That proves they run. It does not prove they would
 * NOTICE if a query stopped being scoped to its owner, if a deletion that
 * matched nothing started reporting success, if an inherited note were
 * silently presented as the learner's own, or if export stopped being gated.
 *
 * So each mutation below breaks one of those in a way a careless edit
 * plausibly could, and the suites must go RED for every one.
 *
 * RLS-level protections are mutated separately by `mutate-rls.mjs`, because
 * breaking a policy requires re-applying migrations to a real database.
 *
 * Usage: node scripts/mutate-notes.mjs
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = process.cwd();

const SUITE = [
  'src/notes/note.test.ts',
  'src/notes/server/note-service.test.ts',
  'src/app/api/notes/route.test.ts',
];

const MUTANTS = [
  // --- user isolation ------------------------------------------------------
  {
    category: 'user isolation',
    name: 'a single read is scoped by id alone, not by owner',
    file: 'src/notes/server/note-service.ts',
    from: "    .eq('id', id)\n    // Scoped by owner as well as id. See the note at the top of this file.\n    .eq('owner_id', userId)\n    .maybeSingle();",
    to: "    .eq('id', id)\n    .maybeSingle();",
  },
  {
    category: 'user isolation',
    name: 'an update is scoped by id alone',
    file: 'src/notes/server/note-service.ts',
    from: "    .eq('id', id)\n    .eq('owner_id', userId)\n    .select(COLUMNS)\n    .maybeSingle();",
    to: "    .eq('id', id)\n    .select(COLUMNS)\n    .maybeSingle();",
  },
  {
    category: 'user isolation',
    name: 'a delete is scoped by id alone',
    file: 'src/notes/server/note-service.ts',
    from: "    .eq('id', id)\n    .eq('owner_id', userId)\n    .select('id')\n    .maybeSingle();",
    to: "    .eq('id', id)\n    .select('id')\n    .maybeSingle();",
  },
  {
    category: 'user isolation',
    name: 'a list is not scoped to the owner',
    file: 'src/notes/server/note-service.ts',
    from: "    .select(COLUMNS, { count: 'exact' })\n    .eq('owner_id', userId);",
    to: "    .select(COLUMNS, { count: 'exact' });",
  },
  {
    category: 'user isolation',
    name: 'an export returns everybody',
    file: 'src/notes/server/note-service.ts',
    from: "    .select(COLUMNS)\n    .eq('owner_id', userId)\n    .order('spatial_object_id'",
    to: "    .select(COLUMNS)\n    .order('spatial_object_id'",
  },

  // --- userId trust --------------------------------------------------------
  {
    category: 'userId trust',
    name: 'the owner is taken from the input rather than the session',
    file: 'src/notes/server/note-service.ts',
    from: '      owner_id: userId,',
    to: '      owner_id: (input as { ownerId?: string }).ownerId ?? userId,',
  },
  {
    category: 'userId trust',
    name: 'the insert spreads the input, so any column becomes writable',
    file: 'src/notes/server/note-service.ts',
    from: '    .insert({\n      owner_id: userId,',
    to: '    .insert({\n      ...(input as Record<string, unknown>),\n      owner_id: userId,',
  },
  {
    category: 'userId trust',
    name: 'the lineage is taken from the browser instead of the id',
    file: 'src/app/api/notes/route.ts',
    from: '        anchors = [anchor, ...semanticIdAncestors(anchor)];',
    to: "        anchors = (url.searchParams.get('anchors')?.split(',') as never) ?? [anchor];",
  },

  // --- persistence / state transitions -------------------------------------
  {
    category: 'persistence',
    name: 'a delete that matched nothing reports success',
    file: 'src/notes/server/note-service.ts',
    from: "  if (!data) return { ok: false, reason: 'not_found' };\n\n  serverLog('info', 'notes.deleted', {});",
    to: "  serverLog('info', 'notes.deleted', {});",
  },
  {
    category: 'persistence',
    name: 'an update that matched nothing reports success',
    file: 'src/notes/server/note-service.ts',
    from: "  // No row came back: either no such note, or it is somebody else's. One\n  // answer for both, on purpose.\n  if (!data) return { ok: false, reason: 'not_found' };",
    to: '  // mutant: a miss is a hit',
  },
  {
    category: 'persistence',
    name: 'the client supplies updated_at, so the timestamp is not the server clock',
    file: 'src/notes/server/note-service.ts',
    from: '      metadata: input.modelRef ? { modelRef: input.modelRef } : {},\n      // `updated_at` is deliberately absent',
    to: "      metadata: input.modelRef ? { modelRef: input.modelRef } : {},\n      updated_at: new Date(0).toISOString(),\n      // `updated_at` is deliberately absent",
  },
  {
    category: 'persistence',
    name: 'a database failure is reported as success',
    file: 'src/notes/server/note-service.ts',
    from: "    serverLog('error', 'notes.list_failed', { reason: error.message });\n    return { ok: false, reason: 'unavailable' };",
    to: "    serverLog('error', 'notes.list_failed', { reason: error.message });\n    return { ok: true, value: { notes: [], total: 0 } };",
  },
  {
    category: 'persistence',
    name: 'the provider message is returned to the caller',
    file: 'src/notes/server/note-service.ts',
    from: "    serverLog('error', 'notes.get_failed', { reason: error.message });\n    return { ok: false, reason: 'unavailable' };",
    to: "    return { ok: false, reason: error.message as 'unavailable' };",
  },

  // --- validation ----------------------------------------------------------
  {
    category: 'validation',
    name: 'an empty note is accepted',
    file: 'src/notes/note.ts',
    from: "  if (body.length === 0 && title.length === 0) {\n    return { ok: false, reason: 'empty' };\n  }",
    to: '  // mutant: anything goes',
  },
  {
    category: 'validation',
    name: 'the body limit is not enforced',
    file: 'src/notes/note.ts',
    from: "  if (body.length > NOTE_LIMITS.bodyMax) return { ok: false, reason: 'body_too_long' };",
    to: '  // mutant: unbounded',
  },
  {
    category: 'validation',
    name: 'the anchor is not checked at all',
    file: 'src/notes/note.ts',
    from: "      if (!isSemanticId(anchor)) return { ok: false, reason: 'invalid_anchor' };\n      semanticId = anchor;",
    to: '      semanticId = anchor as SemanticId;',
  },
  {
    category: 'validation',
    name: 'the anchor is checked trimmed but stored raw',
    file: 'src/notes/note.ts',
    from: '    const anchor = typeof draft.semanticId === \'string\' ? draft.semanticId.trim() : null;',
    to: "    const anchor = typeof draft.semanticId === 'string' ? draft.semanticId : null;",
  },
  {
    category: 'validation',
    name: 'the model ref accepts a path',
    file: 'src/notes/note.ts',
    from: 'const MODEL_REF = /^[A-Za-z0-9._:-]{1,200}$/;',
    to: 'const MODEL_REF = /^.{1,200}$/;',
  },
  {
    category: 'validation',
    name: 'tags are not de-duplicated or case-folded',
    file: 'src/notes/note.ts',
    from: '    const tag = raw.trim().toLowerCase();\n    if (tag.length === 0 || seen.has(tag)) continue;',
    to: '    const tag = raw.trim();\n    if (tag.length === 0) continue;',
  },
  {
    category: 'validation',
    name: 'a search term that sanitises to nothing becomes no filter',
    file: 'src/notes/server/note-service.ts',
    from: '    if (term === null) return { ok: true, value: { notes: [], total: 0 } };',
    to: '    if (term === null) return listNotes({ ...query, q: undefined });',
  },
  {
    category: 'validation',
    name: 'the search term is unbounded',
    file: 'src/notes/server/note-service.ts',
    from: '    .slice(0, NOTE_LIMITS.queryMax)\n    .replace(/[\\0<>\\\\]/g, \' \')',
    to: "    .replace(/[\\0]/g, ' ')",
  },

  // --- business rules ------------------------------------------------------
  {
    category: 'business rules',
    name: 'an inherited note is presented as the learner\'s own',
    file: 'src/notes/note.ts',
    from: "      inherited.push({\n        note,\n        relation: 'inherited',\n        inheritedFrom: note.semanticId,\n        distance,\n      });",
    to: "      inherited.push({ note, relation: 'direct', inheritedFrom: null, distance });",
  },
  {
    category: 'business rules',
    name: 'notes on descendants are pulled in too',
    file: 'src/notes/note.ts',
    from: '    const distance = distanceOf.get(note.semanticId);\n    if (distance !== undefined) {',
    to: '    const distance = distanceOf.get(note.semanticId) ?? 1;\n    if (true) {',
  },
  {
    category: 'business rules',
    name: 'inherited notes outrank direct ones',
    file: 'src/notes/note.ts',
    from: '  return [...direct, ...inherited];',
    to: '  return [...inherited, ...direct];',
  },

  // --- entitlement ---------------------------------------------------------
  {
    category: 'entitlement',
    name: 'export is not gated at all',
    file: 'src/app/api/notes/export/route.ts',
    from: "    const gate = await requireEntitlement('export.notes');\n    if (!gate.ok) return gate.failure.response;",
    to: '    // mutant: anybody may export',
  },
  {
    category: 'entitlement',
    name: 'export is gated on a capability every learner already has',
    file: 'src/app/api/notes/export/route.ts',
    from: "const gate = await requireEntitlement('export.notes');",
    to: "const gate = await requireEntitlement('material.upload');",
  },
  {
    category: 'entitlement',
    name: 'writing a note becomes entitlement-gated',
    file: 'src/app/api/notes/route.ts',
    from: '    const limited = await rateLimit(request, \'notes.write\');\n    if (limited) return limited;\n\n    let payload: unknown;',
    to: "    const limited = await rateLimit(request, 'notes.write');\n    if (limited) return limited;\n\n    const gate = await (await import('@/billing/server/gate')).requireEntitlement('export.notes');\n    if (!gate.ok) return gate.failure.response;\n\n    let payload: unknown;",
  },
  {
    category: 'entitlement',
    name: 'the export rate limit runs after the gate',
    file: 'src/app/api/notes/export/route.ts',
    from: "    const limited = await rateLimit(request, 'notes.export');\n    if (limited) return limited;",
    to: '    // mutant: no limit before the gate',
  },

  // --- authorization -------------------------------------------------------
  {
    category: 'authorization',
    name: 'a malformed note id answers 400, revealing the id space',
    file: 'src/app/api/notes/[id]/route.ts',
    from: "    if (!parsedId.success) return failure('not_found');\n\n    let payload: unknown;",
    to: "    if (!parsedId.success) return invalid('That is not a valid id.');\n\n    let payload: unknown;",
  },
  {
    category: 'authorization',
    name: 'a note id is not validated before reaching a query',
    file: 'src/app/api/notes/[id]/route.ts',
    from: "    const parsedId = idSchema.safeParse(id);\n    if (!parsedId.success) return failure('not_found');\n\n    const result = await deleteNote(parsedId.data as UUID);",
    to: '    const result = await deleteNote(id as UUID);',
  },
  {
    category: 'authorization',
    name: 'an anchor that is not a semantic id reaches the service',
    file: 'src/app/api/notes/route.ts',
    from: "      if (!isSemanticId(anchor)) return invalid('That is not a structure VEO recognises.');",
    to: '      // mutant: anything goes',
  },
];

async function suitePasses() {
  try {
    await run('npx', ['vitest', 'run', '--reporter=dot', ...SUITE], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('VEO NOTES MUTATION TESTING\n');

  process.stdout.write('baseline (unmutated suite must PASS) ... ');
  if (!(await suitePasses())) {
    console.log('FAILED');
    console.error('\nThe suite is red before any mutation. Fix that first.');
    process.exit(1);
  }
  console.log('passes\n');

  let caught = 0;
  const survivors = [];
  let category = '';

  for (const mutant of MUTANTS) {
    if (mutant.category !== category) {
      category = mutant.category;
      console.log(`  --- ${category} ---`);
    }

    const path = join(ROOT, mutant.file);
    const original = readFileSync(path, 'utf8');

    if (!original.includes(mutant.from)) {
      // A mutation that no longer applies is a mutation that is no longer
      // testing anything, so this is a failure rather than a skip.
      console.log(`  STALE    ${mutant.name}`);
      survivors.push(`${mutant.name} (target text not found in ${mutant.file})`);
      continue;
    }

    try {
      writeFileSync(path, original.replace(mutant.from, mutant.to));
      if (await suitePasses()) {
        console.log(`  SURVIVED ${mutant.name}`);
        survivors.push(`[${mutant.category}] ${mutant.name}`);
      } else {
        caught += 1;
        console.log(`  caught   ${mutant.name}`);
      }
    } finally {
      writeFileSync(path, original);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`NOTES MUTANTS CAUGHT: ${caught} of ${MUTANTS.length}`);
  console.log('='.repeat(60));

  if (survivors.length > 0) {
    console.log('\nSurvivors — each is a protection no test would notice losing:');
    for (const name of survivors) console.log(`  - ${name}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
