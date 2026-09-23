import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The boundaries Gate 12 is required to hold.
 *
 * Each is a rule about which module may know about which — the kind of thing
 * that is true on the day it is written and quietly stops being true six
 * commits later, because nothing fails when it breaks. So it is asserted.
 *
 * Every scan carries a positive control: a scan that finds nothing may be a
 * scan that finds nothing.
 */

const SRC = join(process.cwd(), 'src');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const AI_FILES = filesUnder(join(SRC, 'ai'));
const LEARNING_FILES = filesUnder(join(SRC, 'learning'));

describe('the AI cannot touch learning state', () => {
  it('found both module trees', () => {
    // Positive control for every scan below.
    expect(AI_FILES.length).toBeGreaterThan(10);
    expect(LEARNING_FILES.length).toBeGreaterThan(5);
  });

  it('no AI module imports the learning engine', () => {
    // A tutor that could advance a schedule could reward a learner for a
    // conversation, and the review history would stop meaning what it says.
    for (const file of AI_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from\s+['"]@\/learning/);
      expect(source, file).not.toMatch(/from\s+['"][./]+learning\//);
    }
  });

  it('no AI module can submit a review or schedule an item', () => {
    for (const file of AI_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\bsubmitReview\b/);
      expect(source, file).not.toMatch(/\bLearningStore\b/);
      expect(source, file).not.toMatch(/\bschedule\s*\(/);
    }
  });

  it('scan control: these patterns DO match when present', () => {
    const planted = `import { submitReview } from '@/learning/store';`;
    expect(planted).toMatch(/from\s+['"]@\/learning/);
    expect(planted).toMatch(/\bsubmitReview\b/);
  });
});

describe('the scheduler does not depend on AI', () => {
  it('no learning module imports an AI module or a provider', () => {
    // The requirement is not stylistic. A scheduler that consulted a language
    // model would produce a different answer for the same history on two
    // different days, which is indistinguishable from a bug and impossible to
    // test.
    for (const file of LEARNING_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from\s+['"]@\/ai\//);
      expect(source, file).not.toMatch(/openai|anthropic|LLMClient/i);
    }
  });

  it('the pure modules read no clock, environment or network', () => {
    for (const name of ['scheduler.ts', 'queue.ts', 'mastery.ts', 'streaks.ts', 'session.ts']) {
      const source = readFileSync(join(SRC, 'learning', name), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(code, name).not.toMatch(/\bfetch\s*\(/);
      expect(code, name).not.toMatch(/process\.env/);
      expect(code, name).not.toMatch(/Date\.now\s*\(/);
      expect(code, name).not.toMatch(/new Date\(\s*\)/);
    }
  });

  it('scan control: a planted clock read IS caught', () => {
    expect('const t = Date.now();').toMatch(/Date\.now\s*\(/);
    expect('const t = new Date();').toMatch(/new Date\(\s*\)/);
  });
});

describe('the domain vocabulary is not duplicated', () => {
  it('defines each learning concept exactly once', () => {
    // Gate 12 must reuse the existing domain rather than growing a parallel
    // one. Two enums for difficulty is how a product ends up with a card that
    // is "hard" in one screen and "medium" in another.
    const declarations = new Map<string, string[]>();

    for (const file of filesUnder(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(
        /export const (DIFFICULTIES|LEARNING_LEVELS|QUESTION_KINDS|LEARNING_OBJECTIVES|REVIEW_RATINGS|REVIEW_PHASES)\b/g,
      )) {
        const name = match[1]!;
        declarations.set(name, [...(declarations.get(name) ?? []), file]);
      }
    }

    // Positive control: the scan must actually be finding declarations.
    expect(declarations.size).toBeGreaterThan(2);

    for (const [name, files] of declarations) {
      expect(files, `${name} declared in ${files.length} files`).toHaveLength(1);
    }
  });

  it('reuses the existing difficulty and objective vocabularies', () => {
    // Rather than asserting absence, assert the positive: the learning
    // surface speaks the domain's words.
    const enrol = readFileSync(join(SRC, 'components/recall/enrol.ts'), 'utf8');
    expect(enrol).toMatch(/ValidatedQuestion|ValidatedFlashcard/);

    const api = readFileSync(join(SRC, 'learning/server/learning-api.ts'), 'utf8');
    expect(api).toContain('REVIEW_RATINGS');
    expect(api).toContain('GOAL_BOUNDS');
  });
});

describe('no primitive geometry is introduced as anatomy', () => {
  it('the learning engine creates no meshes at all', () => {
    // Gate 12 is about memory, not rendering. It must not have quietly grown
    // a way to draw something.
    for (const file of [...LEARNING_FILES, ...filesUnder(join(SRC, 'components/recall'))]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/BoxGeometry|SphereGeometry|CylinderGeometry|ConeGeometry/);
      expect(source, file).not.toMatch(/from\s+['"]three['"]/);
      expect(source, file).not.toMatch(/@react-three/);
    }
  });

  it('scan control: a planted primitive IS caught', () => {
    expect("new THREE.SphereGeometry(1, 32, 32)").toMatch(/SphereGeometry/);
  });

  it('the recall surface names no anatomical structure of its own', () => {
    // Labels come from the loaded model. A hard-coded name here would be
    // fabricated anatomy in a dashboard.
    const banned = /\b(left ventricle|right atrium|aorta|pulmonary|myocardium|ventricle)\b/i;
    for (const file of filesUnder(join(SRC, 'components/recall'))) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(source, file).not.toMatch(banned);
    }
  });
});

describe('the learning schedule is server-authoritative', () => {
  it('no client component imports scheduling or persistence as VALUES', () => {
    // The distinction is the whole point. `import type` is erased at build
    // time and grants no capability — a component that names `ReviewRating`
    // still cannot schedule anything. A VALUE import of the scheduler or a
    // store is a component that could compute its own interval or reach a
    // database from the browser.
    let checked = 0;

    for (const file of filesUnder(join(SRC, 'components'))) {
      const source = readFileSync(file, 'utf8');

      for (const match of source.matchAll(
        /\bimport\s+(type\s+)?[^;]*?from\s+['"]@\/learning\/(scheduler|store|supabase-store|memory-store)['"]/g,
      )) {
        checked += 1;
        expect(match[1], `${file}: value import of @/learning/${match[2]}`).toBe('type ');
      }

      // A store must never be constructed in a component, typed or not.
      expect(source, file).not.toMatch(/new\s+(SupabaseLearningStore|InMemoryLearningStore)/);
    }

    // Positive control: the scan found the imports it is judging.
    expect(checked).toBeGreaterThan(0);
  });

  it('scan control: a VALUE import of the scheduler IS caught', () => {
    const planted = "import { schedule } from '@/learning/scheduler';";
    const match = [
      ...planted.matchAll(
        /\bimport\s+(type\s+)?[^;]*?from\s+['"]@\/learning\/(scheduler|store|supabase-store|memory-store)['"]/g,
      ),
    ][0];
    expect(match).toBeDefined();
    expect(match?.[1]).toBeUndefined();
  });

  it('the review screen imports only the pure session machine and queue types', () => {
    const source = readFileSync(join(SRC, 'components/recall/ReviewSession.tsx'), 'utf8');
    expect(source).toMatch(/from '@\/learning\/session'/); // positive control
    expect(source).not.toMatch(/\bschedule\s*\(/);
    expect(source).not.toMatch(/SCHEDULER\./);
  });
});
