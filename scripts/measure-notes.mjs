/**
 * Gate 16 performance, measured.
 *
 * Three things, at realistic volume, against budgets stated in the contract
 * before any of this was written:
 *
 *   1. note validation — the pure path every write goes through
 *   2. contextual resolution — picking a structure's notes out of a large set
 *   3. search — the real query, against real PostgreSQL, at 1,000 notes
 *
 * (3) is the only one that can be slow in a way unit tests cannot see, which
 * is why it runs against a database rather than a mock. A search budget
 * asserted from a stub is a budget for the stub.
 *
 * Usage: node scripts/measure-notes.mjs
 */
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { buildSemanticId } from '../src/lib/semantic-id.ts';
import { contextualNotes, validateNote } from '../src/notes/note.ts';

const HOST = '127.0.0.1';
const PORT = process.env.VEO_PG_PORT ?? '54329';
const DB = 'veo_notes_perf';

const BUDGETS = {
  validate: 1,
  contextual: 10,
  search: 50,
};

const results = [];
let failed = false;

function report(label, perCall, budget, detail = '') {
  const within = perCall <= budget;
  if (!within) failed = true;
  results.push({ label, perCall, budget, within, detail });
}

/** Median rather than mean: one scheduling hiccup should not set the figure. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timed(iterations, work) {
  // A warm-up pass, so the first-call JIT cost is not reported as the cost.
  for (let i = 0; i < Math.min(50, iterations); i += 1) work(i);

  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    work(i);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. VALIDATING A NOTE ===');
// ---------------------------------------------------------------------------

const anchor = buildSemanticId('anatomy', 'heart', 'left_ventricle');

const cases = [
  ['a short note', { body: 'The chordae stop the valve inverting.' }],
  ['an anchored note with tags', { body: 'b', semanticId: anchor, tags: ['cardiac', 'valves'] }],
  ['a note at the body limit', { body: 'x'.repeat(20_000) }],
  ['a note with the maximum tags', { body: 'b', tags: Array.from({ length: 12 }, (_, i) => `tag${i}`) }],
];

for (const [label, draft] of cases) {
  const perCall = timed(2_000, () => validateNote(draft));
  report(`validate: ${label}`, perCall, BUDGETS.validate);
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. RESOLVING CONTEXT OVER A LARGE SET ===');
// ---------------------------------------------------------------------------

/**
 * A learner with a lot of notes.
 *
 * 2,000 is far more than anybody writes about one model, which is the point:
 * the budget should hold well past realistic use, not just at it.
 */
function buildNotes(count) {
  const anchors = [
    buildSemanticId('anatomy', 'heart', 'left_ventricle'),
    buildSemanticId('anatomy', 'heart'),
    buildSemanticId('anatomy', 'heart', 'right_atrium'),
    buildSemanticId('chemistry', 'benzene', 'ring'),
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: `note-${i}`,
    semanticId: i % 7 === 0 ? null : anchors[i % anchors.length],
    modelRef: null,
    title: null,
    body: `Note ${i}`,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date(1_767_225_600_000 + i * 1_000).toISOString(),
  }));
}

for (const count of [100, 500, 2_000]) {
  const notes = buildNotes(count);
  const perCall = timed(500, () => contextualNotes(notes, anchor));
  const resolved = contextualNotes(notes, anchor).length;
  report(`contextual: ${count} notes`, perCall, BUDGETS.contextual, `${resolved} relevant`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. SEARCH, AGAINST REAL POSTGRESQL ===');
// ---------------------------------------------------------------------------

function psql(sql, database = DB) {
  return execFileSync(
    'psql',
    ['-h', HOST, '-p', PORT, '-U', 'postgres', '-d', database, '-q', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ).trim();
}

let databaseReady = false;
try {
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', 'postgres', '-c', 'select 1'], {
    stdio: 'ignore',
  });
  databaseReady = true;
} catch {
  databaseReady = false;
}

if (!databaseReady) {
  console.log('  SKIPPED  no PostgreSQL on this host — search was NOT measured');
  console.log('           (start one and re-run; this is reported, not assumed)');
  failed = true;
} else {
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', 'postgres', '-c',
    `drop database if exists ${DB}`], { stdio: 'ignore' });
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', 'postgres', '-c',
    `create database ${DB}`], { stdio: 'ignore' });

  /*
   * The real table and the real index, from the real migration's definitions.
   * A measurement against a different schema measures a different thing.
   */
  psql(`
    create extension if not exists "pgcrypto";
    create table notes (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      spatial_object_id text,
      title text,
      body text not null default '',
      tags text[] not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      fts tsvector generated always as (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
      ) stored
    );
    create index notes_search_idx on notes using gin (fts);
    create index notes_owner_anchor_idx on notes (owner_id, spatial_object_id)
      where spatial_object_id is not null;
    create index notes_owner_recent_idx on notes (owner_id, updated_at desc);
  `);

  /*
   * 1,000 notes for the learner being measured, and 9,000 belonging to others.
   *
   * The other learners matter: a search that is fast only because the table
   * is small has not been measured.
   *
   * The BODIES are varied, which matters just as much. The first version of
   * this fixture gave every note the same sentence, so a search term matched
   * all 1,000 of the owner's notes — the `fts` predicate selected everything,
   * and the planner quite correctly ignored the GIN index in favour of the
   * owner index. That measured a real query but not a real search. Real notes
   * do not all contain the same word, so one in fifty carries the term being
   * searched for.
   */
  const OWNER = '11111111-1111-4111-8111-111111111111';
  psql(`
    insert into notes (owner_id, title, body, spatial_object_id)
    select
      '${OWNER}',
      'Note ' || g,
      case
        -- One in fifty is about the thing being searched for.
        when g % 50 = 0
          then 'The chordae tendineae prevent valve inversion during systole, entry ' || g
        else 'Observation ' || g || ' concerning '
             || (array['conduction','perfusion','innervation','drainage','attachment'])[1 + (g % 5)]
             || ' recorded while revising topic ' || (g % 37)
      end,
      case when g % 7 = 0 then null else 'veo.anatomy.heart.left_ventricle' end
    from generate_series(1, 1000) as g;

    insert into notes (owner_id, title, body)
    select gen_random_uuid(), 'Other ' || g, 'unrelated content ' || g
    from generate_series(1, 9000) as g;

    analyze notes;
  `);

  const total = psql('select count(*) from notes');
  const mine = psql(`select count(*) from notes where owner_id = '${OWNER}'`);
  console.log(`  ${total} notes in the table, ${mine} belonging to the learner measured`);

  /**
   * Time a query using PostgreSQL's own execution time.
   *
   * `EXPLAIN (ANALYZE)` reports the time the SERVER spent, which is the figure
   * that matters: wall-clock around a `psql` call is dominated by process
   * spawn (tens of milliseconds) and would report a budget for the client.
   */
  function timeQuery(label, sql, budget) {
    const samples = [];

    for (let i = 0; i < 12; i += 1) {
      const plan = psql(`explain (analyze, timing off, format json) ${sql};`);
      const match = /"Execution Time":\s*([\d.]+)/.exec(plan);
      if (match) samples.push(Number(match[1]));
    }

    if (samples.length === 0) {
      report(label, Number.POSITIVE_INFINITY, budget, 'no timing could be taken');
      return;
    }
    report(label, median(samples), budget);
  }

  timeQuery(
    'search: one word, 1,000 own notes',
    `select count(*) from notes
      where owner_id = '${OWNER}'
        and fts @@ websearch_to_tsquery('english', 'inversion')`,
    BUDGETS.search,
  );

  timeQuery(
    'search: a phrase',
    `select count(*) from notes
      where owner_id = '${OWNER}'
        and fts @@ websearch_to_tsquery('english', 'chordae tendineae')`,
    BUDGETS.search,
  );

  timeQuery(
    'search: a term that matches nothing',
    `select count(*) from notes
      where owner_id = '${OWNER}'
        and fts @@ websearch_to_tsquery('english', 'mitochondrion')`,
    BUDGETS.search,
  );

  timeQuery(
    'list: a page of the most recent',
    `select id from notes where owner_id = '${OWNER}'
      order by updated_at desc limit 25`,
    BUDGETS.search,
  );

  timeQuery(
    'contextual: notes on one structure',
    `select id from notes
      where owner_id = '${OWNER}'
        and spatial_object_id = 'veo.anatomy.heart.left_ventricle'
      order by updated_at desc limit 25`,
    BUDGETS.search,
  );

  // The indexes must actually be used. A GIN index the planner ignores is a
  // sequential scan with extra steps, and it would still pass a time budget
  // at this size while failing at ten times it.
  /*
   * Does the GIN index earn its place?
   *
   * At 10,000 rows the planner does NOT use it, and is right not to: a bitmap
   * scan on `owner_id` plus a filter reads 22 heap blocks, which is cheaper
   * than consulting GIN and combining two bitmaps. An earlier version of this
   * script asserted the index must be used and failed — the assertion was
   * wrong for the volume, not the schema.
   *
   * So the question is answered where it actually matters. The index is
   * justified only if the planner reaches for it once the table is big enough
   * for a filter to hurt; if it never does, it is dead weight paid for on
   * every write, and that would be worth knowing.
   */
  function searchPlanUsesGin(database) {
    const plan = psql(
      `explain (format text) select count(*) from notes
         where owner_id = '${OWNER}'
           and fts @@ websearch_to_tsquery('english', 'inversion');`,
      database,
    );
    return /notes_search_idx/.test(plan);
  }

  const matching = psql(`
    select count(*) from notes where owner_id = '${OWNER}'
      and fts @@ websearch_to_tsquery('english', 'inversion');
  `);
  console.log(
    `  at this size: 'inversion' matches ${matching} of ${mine} own notes, ` +
      `GIN index used: ${searchPlanUsesGin(DB) ? 'yes' : 'no (a filter is cheaper here)'}`,
  );

  // --- the same query, at a scale where the index must pay for itself -----
  const SCALE_DB = `${DB}_scale`;
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', 'postgres', '-c',
    `drop database if exists ${SCALE_DB}`], { stdio: 'ignore' });
  execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', 'postgres', '-c',
    `create database ${SCALE_DB}`], { stdio: 'ignore' });

  psql(`
    create extension if not exists "pgcrypto";
    create table notes (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      spatial_object_id text,
      title text,
      body text not null default '',
      tags text[] not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      fts tsvector generated always as (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
      ) stored
    );
    create index notes_search_idx on notes using gin (fts);
    create index notes_owner_recent_idx on notes (owner_id, updated_at desc);

    insert into notes (owner_id, title, body)
    select '${OWNER}', 'Note ' || g,
      case when g % 200 = 0
        then 'The chordae tendineae prevent valve inversion during systole ' || g
        else 'Observation ' || g || ' about '
             || (array['conduction','perfusion','innervation'])[1 + (g % 3)]
      end
    from generate_series(1, 50000) as g;

    insert into notes (owner_id, title, body)
    select gen_random_uuid(), 'Other ' || g, 'unrelated content ' || g
    from generate_series(1, 50000) as g;

    analyze notes;
  `, SCALE_DB);

  const scaleTotal = psql('select count(*) from notes', SCALE_DB);
  const scaleMatching = psql(
    `select count(*) from notes where owner_id = '${OWNER}'
       and fts @@ websearch_to_tsquery('english', 'inversion');`,
    SCALE_DB,
  );
  const scaleUsesGin = searchPlanUsesGin(SCALE_DB);

  console.log(
    `  at ${scaleTotal} rows: matches ${scaleMatching}, ` +
      `GIN index used: ${scaleUsesGin ? 'yes' : 'NO'}`,
  );

  // THIS is the assertion that matters: the index is not dead weight.
  if (!scaleUsesGin) {
    console.log('  the GIN index is never used, so it is a write cost for nothing');
    failed = true;
  }

  // And the query must still be within budget at that size.
  const scaleSamples = [];
  for (let i = 0; i < 12; i += 1) {
    const plan = psql(
      `explain (analyze, timing off, format json) select count(*) from notes
         where owner_id = '${OWNER}'
           and fts @@ websearch_to_tsquery('english', 'inversion');`,
      SCALE_DB,
    );
    const match = /"Execution Time":\s*([\d.]+)/.exec(plan);
    if (match) scaleSamples.push(Number(match[1]));
  }
  report(
    'search: at 100,000 rows, 50,000 own',
    scaleSamples.length > 0 ? median(scaleSamples) : Number.POSITIVE_INFINITY,
    BUDGETS.search,
    scaleUsesGin ? 'GIN index' : 'no index',
  );

  const recentPlan = psql(`
    explain (format text)
    select id from notes where owner_id = '${OWNER}'
      order by updated_at desc limit 25;
  `);
  const usesRecentIndex = /notes_owner_recent_idx/.test(recentPlan);
  console.log(`  list plan uses the recency index: ${usesRecentIndex ? 'yes' : 'NO'}`);
  if (!usesRecentIndex) failed = true;

  for (const database of [DB, SCALE_DB]) {
    execFileSync('psql', ['-h', HOST, '-p', PORT, '-U', 'postgres', '-c',
      `drop database if exists ${database}`], { stdio: 'ignore' });
  }
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(72)}`);
console.log('VEO NOTES PERFORMANCE');
console.log('='.repeat(72));
console.log(`${'measure'.padEnd(44)}${'per call'.padStart(12)}${'budget'.padStart(10)}`);

for (const row of results) {
  const value = Number.isFinite(row.perCall) ? `${row.perCall.toFixed(4)}ms` : 'not measured';
  console.log(
    `${row.label.padEnd(44)}${value.padStart(12)}${`${row.budget}ms`.padStart(10)}` +
      `${row.within ? '' : '   OVER BUDGET'}${row.detail ? `   (${row.detail})` : ''}`,
  );
}

console.log('='.repeat(72));
console.log(failed ? 'OVER BUDGET or NOT MEASURED' : 'WITHIN BUDGET');
process.exit(failed ? 1 : 0);
