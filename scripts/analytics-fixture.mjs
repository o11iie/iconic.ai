/**
 * Generate the browser harness's fixture from the REAL engine.
 *
 * ## Why this exists
 *
 * The browser harness has to know what the correct answer is. It could
 * hard-code numbers, but then a change to the engine would silently make the
 * harness assert stale values — and it could reimplement the calculation, but
 * then a bug in the engine would be duplicated in its own test and both would
 * agree while both were wrong.
 *
 * So the fixture is produced BY the engine from the same deterministic learner
 * the unit tests use, and the derived values written into it are checked
 * against hand-computed constants below before it is written. If the engine
 * ever stops producing 60% retention from 9 recalled out of 15, this refuses
 * to emit a fixture rather than quietly moving the goalposts.
 *
 * Usage: npx tsx scripts/analytics-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse } from '../src/analytics/engine.ts';
import { REFERENCE, referenceSnapshot, snapshot } from '../src/analytics/fixtures.ts';

/**
 * The instant everything is anchored to.
 *
 * Fixed, not `new Date()`: a fixture generated at midnight and asserted at
 * 00:01 would straddle a day boundary and produce different windows.
 */
const NOW = new Date('2026-06-15T12:00:00.000Z');

// Gate 9 is RED, so no model is available. Empty is the honest value.
const availableModels = new Set();

const raw = referenceSnapshot(NOW);
const byPeriod = {};

for (const period of ['7d', '30d', '90d', 'all']) {
  byPeriod[period] = analyse(raw, { period, now: NOW, availableModels });
}

const empty = analyse(snapshot(), { period: '30d', now: NOW, availableModels });

// ---------------------------------------------------------------------------
// Hand-computed expectations, checked against the engine before writing.
// ---------------------------------------------------------------------------

const thirty = byPeriod['30d'].overview;
const seven = byPeriod['7d'].overview;

const expected = {
  totalReviews: thirty.retention.totalReviews,
  retentionPercent: Math.round((thirty.retention.overall ?? 0) * 100),
  questions: thirty.activity.questionsAnswered,
  flashcards: thirty.activity.flashcardsReviewed,
  activeDays: thirty.activity.activeDays,
  structuresTracked: thirty.mastery.structuresTracked,

  sevenDayReviews: seven.retention.totalReviews,
  sevenDayRetentionPercent: Math.round((seven.retention.overall ?? 0) * 100),

  weakestName: 'Edge Unit',
  strongestName: 'Core Unit',
  mapRootName: 'Analytics Fixture',

  // Reviews fall on days -10..-1 with gaps, so the 30-day trend cannot be one
  // unbroken path. At least two segments proves gaps are breaks, not dives.
  expectedTrendSegments: 2,
};

/** Refuse to emit a fixture whose numbers are not the ones by hand. */
const assertions = [
  ['total reviews', expected.totalReviews, REFERENCE.totalReviews],
  ['overall retention', expected.retentionPercent, Math.round(REFERENCE.overallRetention * 100)],
  ['questions answered', expected.questions, 10],
  ['flashcards reviewed', expected.flashcards, 5],
  ['active days', expected.activeDays, 10],
  ['structures tracked', expected.structuresTracked, 3],
];

let failed = false;
for (const [label, actual, want] of assertions) {
  const ok = actual === want;
  if (!ok) failed = true;
  console.log(`  ${ok ? 'OK  ' : 'BAD '} ${label}: engine ${actual}, by hand ${want}`);
}

// The windows must genuinely differ, or the period-filter check is vacuous.
const windowsDiffer = expected.sevenDayReviews !== expected.totalReviews;
console.log(
  `  ${windowsDiffer ? 'OK  ' : 'BAD '} windows differ: 7d=${expected.sevenDayReviews}, 30d=${expected.totalReviews}`,
);
if (!windowsDiffer) failed = true;

if (failed) {
  console.error('\nThe engine no longer produces the hand-computed values. Fixture NOT written.');
  process.exit(1);
}

const out = join(process.cwd(), '.veo-analytics-fixture.json');
writeFileSync(
  out,
  JSON.stringify({ generatedFor: NOW.toISOString(), expected, byPeriod, empty }, null, 2),
);

console.log(`\nfixture written: ${out}`);
console.log(`  30d: ${expected.totalReviews} reviews, ${expected.retentionPercent}% retention`);
console.log(`  7d : ${expected.sevenDayReviews} reviews, ${expected.sevenDayRetentionPercent}% retention`);
