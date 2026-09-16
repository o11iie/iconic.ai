import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for a real, silent defect.
 *
 * Tailwind v4 removed the `utility-[--custom-var]` shorthand that v3 accepted.
 * A class like `bg-[--color-accent]` still *compiles*, but emits
 *
 *     background-color: --color-accent
 *
 * which is not a valid colour, so the browser drops the declaration. Nothing
 * fails: no build error, no lint error, no type error. The interface simply
 * renders without most of its colour, inheriting from `body` instead.
 *
 * Because VEO's tokens are declared in `@theme`, Tailwind generates real
 * utilities for them (`bg-accent`, `text-ink-muted`, `border-hairline`), and
 * those are the only correct form. This test fails if the old shorthand
 * reappears anywhere in the source.
 */

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.(tsx?|css)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('design tokens', () => {
  const files = sourceFiles('src');

  it('never uses the Tailwind v3 CSS-variable shorthand, which v4 emits as invalid CSS', () => {
    const offenders: string[] = [];

    for (const file of files) {
      // `.css` may legitimately contain `var(--color-x)`; only the bracket
      // shorthand inside a utility class is wrong. This file documents the bad
      // form in prose, so it excludes itself.
      if (file.endsWith('.css')) continue;
      if (file.endsWith('design-tokens.test.ts')) continue;

      const contents = readFileSync(file, 'utf8');
      const matches = contents.match(/\[--(?:color|font|shadow|ease)-[a-z0-9-]+\]/g);
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('declares every colour token the utilities rely on', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8');
    const themeBlock = globals.slice(globals.indexOf('@theme'), globals.indexOf('@layer base'));

    const declared = new Set(
      [...themeBlock.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1] as string),
    );

    // Tokens the interface actually uses. If one is removed from @theme, the
    // utilities referencing it silently stop resolving.
    for (const token of [
      'obsidian',
      'surface',
      'surface-raised',
      'surface-overlay',
      'hairline',
      'hairline-strong',
      'accent',
      'cyan',
      'ink',
      'ink-muted',
      'ink-subtle',
      'ink-faint',
      'success',
      'warning',
      'danger',
    ]) {
      expect(declared.has(token), `--color-${token} must be declared in @theme`).toBe(true);
    }
  });

  it('keeps the brand palette on the specified values', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8');
    expect(globals).toContain('--color-obsidian: #090d16');
    expect(globals).toContain('--color-surface: #111827');
    expect(globals).toContain('--color-accent: #3b82f6');
  });
});
