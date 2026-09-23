/**
 * Gate 13 performance measurement.
 *
 * Measures the analytics engine against realistic volumes. The rule it exists
 * to enforce: do not claim scalability without measuring it, and do not add an
 * index or a cache without evidence that something is slow.
 *
 * What is measured is the PURE engine — parsing, filtering, aggregating,
 * detecting, recommending and mapping — because that is the part Gate 13
 * added. Database read time is a separate concern, bounded by the row caps in
 * `queryFor` and verified against real PostgreSQL by verify-rls.sh.
 *
 * Usage: npx tsx scripts/measure-analytics.mjs
 */
import { performance } from 'node:perf_hooks';
import { analyse } from '../src/analytics/engine.ts';

const RATINGS = ['again', 'hard', 'good', 'easy'];

/**
 * Build a learner of a given size, deterministically.
 *
 * A seeded walk rather than Math.random, so a slow run can be reproduced
 * exactly and two runs are comparable.
 */
function buildLearner(itemCount, eventCount, now) {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const domains = ['anatomy', 'chemistry', 'physics', 'engineering', 'astrophysics'];
  const items = [];

  for (let i = 0; i < itemCount; i += 1) {
    const domain = domains[i % domains.length];
    const system = `system_${i % 12}`;
    const region = `region_${i % 30}`;
    items.push({
      id: `item-${i}`,
      contentType: i % 3 === 0 ? 'flashcard' : 'question',
      semanticId: `veo.${domain}.${system}.${region}.structure_${i}`,
      modelRef: `model-${i % 4}`,
      createdAt: new Date(now.getTime() - (300 - (i % 300)) * 86_400_000).toISOString(),
      phase: 'review',
      stability: 5 + next() * 100,
      difficulty: next(),
      repetitions: Math.floor(next() * 20),
      lapses: Math.floor(next() * 5),
      intervalDays: 1 + next() * 30,
      dueAt: new Date(now.getTime() + (next() - 0.5) * 30 * 86_400_000).toISOString(),
      lastReviewedAt: new Date(now.getTime() - next() * 60 * 86_400_000).toISOString(),
    });
  }

  const events = [];
  for (let i = 0; i < eventCount; i += 1) {
    const item = items[i % items.length];
    events.push({
      id: `event-${i}`,
      itemId: item.id,
      rating: RATINGS[Math.floor(next() * 4)],
      correct: next() > 0.3,
      responseMs: Math.floor(1000 + next() * 12_000),
      // Spread across a year so every window and bucket is populated.
      reviewedAt: new Date(now.getTime() - (i / eventCount) * 365 * 86_400_000).toISOString(),
      sessionId: `session-${Math.floor(i / 20)}`,
    });
  }

  const sessions = [];
  for (let i = 0; i < Math.ceil(eventCount / 20); i += 1) {
    const startedAt = new Date(now.getTime() - i * 86_400_000);
    sessions.push({
      id: `session-${i}`,
      status: i % 7 === 0 ? 'abandoned' : 'completed',
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + 12 * 60_000).toISOString(),
      itemsPlanned: 20,
      itemsCompleted: 18,
    });
  }

  const days = [];
  for (let i = 0; i < 365; i += 1) {
    const date = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ date, reviewsCompleted: Math.floor(next() * 30), secondsStudied: Math.floor(next() * 1800) });
  }

  return { items, events, sessions, days, dailyTarget: 20, timeZone: 'UTC', eventsTruncated: false };
}

function measure(label, run, iterations = 5) {
  run(); // warm, so the first-call JIT cost is not reported as the median

  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);

  const median = samples[Math.floor(samples.length / 2)];
  const worst = samples[samples.length - 1];
  return { label, median, worst };
}

const now = new Date('2026-06-15T12:00:00.000Z');
const availableModels = new Set();

console.log('VEO ANALYTICS PERFORMANCE');
console.log('='.repeat(72));
console.log(
  'scale'.padEnd(34) + 'period'.padEnd(8) + 'median'.padStart(10) + 'worst'.padStart(10),
);
console.log('-'.repeat(72));

const SCALES = [
  { items: 20, events: 100, label: '100 events / 20 items' },
  { items: 100, events: 1_000, label: '1,000 events / 100 items' },
  { items: 400, events: 10_000, label: '10,000 events / 400 items' },
];

let worstOverall = 0;

for (const scale of SCALES) {
  const snapshot = buildLearner(scale.items, scale.events, now);

  for (const period of ['7d', '30d', 'all']) {
    const result = measure(scale.label, () =>
      analyse(snapshot, { period, now, availableModels }),
    );
    worstOverall = Math.max(worstOverall, result.worst);

    console.log(
      scale.label.padEnd(34) +
        period.padEnd(8) +
        `${result.median.toFixed(1)}ms`.padStart(10) +
        `${result.worst.toFixed(1)}ms`.padStart(10),
    );
  }
}

console.log('-'.repeat(72));

// A dashboard load should not be dominated by arithmetic. 250ms at the
// largest scale is the bar: above it, the engine needs work rather than the
// database needing an index.
const BUDGET_MS = 250;
console.log(`worst case: ${worstOverall.toFixed(1)}ms (budget ${BUDGET_MS}ms)`);
console.log(worstOverall <= BUDGET_MS ? 'WITHIN BUDGET' : 'OVER BUDGET');

process.exit(worstOverall <= BUDGET_MS ? 0 : 1);
