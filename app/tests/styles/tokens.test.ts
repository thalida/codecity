import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same reason as themePresets.test.ts: resolve via __dirname, not import.meta
// URL rewriting.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src');
const tokensCss = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const SOURCES = sourceFiles(SRC).map((path) => [path, readFileSync(path, 'utf8')] as const);
const DECLARED = /^\s*(--cc-[a-z0-9-]+)\s*:/gm;
const REFERENCED = /var\((--cc-[a-z0-9-]+)/g;

/** Anywhere in src, so a component's own scoped block (ControlsPane's --cc-ctrl-*)
 *  counts as a definition without this test keeping a list of them. */
const defined = new Set(SOURCES.flatMap(([, css]) => [...css.matchAll(DECLARED)].map((m) => m[1])));

describe('design tokens', () => {
  // This shipped: a border read --cc-accent-line, which no file defined, so the
  // declaration was invalid and the callout drew no border at all.
  it('has a definition behind every token a rule reads', () => {
    const orphans = SOURCES.flatMap(([path, text]) =>
      [...text.matchAll(REFERENCED)]
        .map((m) => m[1])
        .filter((name) => !defined.has(name))
        .map((name) => `${path.slice(SRC.length + 1)}  ${name}`)
    );
    expect(orphans, orphans.join('\n')).toEqual([]);
  });

  it('has a reader for every token it defines', () => {
    const declared = [...tokensCss.matchAll(DECLARED)].map((m) => m[1]);
    const read = new Set(
      SOURCES.flatMap(([, text]) => [...text.matchAll(REFERENCED)].map((m) => m[1]))
    );
    const unread = declared.filter((name) => !read.has(name));
    expect(unread, unread.join('\n')).toEqual([]);
  });

  // The complaint this resolves: two rungs a shade apart, the dimmer one more
  // saturated, read as two different greys rather than two steps of one.
  it('keeps the text ladder monotone: L falls, chroma rises, one hue', () => {
    const ladder = ['strong', 'primary', 'secondary', 'muted', 'faint'].map((step) => {
      const match = tokensCss.match(
        new RegExp(`--cc-text-${step}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`)
      );
      expect(match, `--cc-text-${step} is not a plain oklch triple`).not.toBeNull();
      const [, l, c, h] = match!;
      return { step, l: Number(l), c: Number(c), h: Number(h) };
    });

    for (let i = 1; i < ladder.length; i++) {
      const [above, below] = [ladder[i - 1], ladder[i]];
      expect(below.l, `${below.step} is not dimmer than ${above.step}`).toBeLessThan(above.l);
      expect(below.c, `${below.step} is less tinted than ${above.step}`).toBeGreaterThan(above.c);
      expect(below.h, `${below.step} sits on another hue`).toBe(above.h);
    }
  });
});
