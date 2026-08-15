import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fs, not an `?raw` glob: vitest runs with CSS transforms off, so a glob over
// stylesheets hands back empty strings. Node-side, hence the tsconfig pair.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const SOURCES = sourceFiles(SRC).map(
  (path) => [path.slice(SRC.length + 1), readFileSync(path, 'utf8')] as const
);
const TOKENS_CSS = SOURCES.find(([path]) => path === join('styles', 'tokens.css'))?.[1] ?? '';

const DECLARED = /^\s*(--cc-[a-z0-9-]+)\s*:/gm;
const REFERENCED = /var\((--cc-[a-z0-9-]+)/g;
const matches = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]);

/** Anywhere in src, so a component's own scoped block (ControlsPane's --cc-ctrl-*)
 *  counts without this test keeping a list of them. */
const defined = new Set(SOURCES.flatMap(([, text]) => matches(text, DECLARED)));
const read = new Set(SOURCES.flatMap(([, text]) => matches(text, REFERENCED)));

describe('design tokens', () => {
  it('found the token file, so the checks below are not vacuous', () => {
    expect(TOKENS_CSS).toContain('--cc-text-strong');
  });

  // This shipped: a border read --cc-accent-line, which no file defines, so the
  // declaration was invalid and the callout drew no border at all.
  it('has a definition behind every token a rule reads', () => {
    const orphans = SOURCES.flatMap(([path, text]) =>
      matches(text, REFERENCED)
        .filter((name) => !defined.has(name))
        .map((name) => `${path}  ${name}`)
    );
    expect(orphans, orphans.join('\n')).toEqual([]);
  });

  it('has a reader for every token it defines', () => {
    const unread = matches(TOKENS_CSS, DECLARED).filter((name) => !read.has(name));
    expect(unread, unread.join('\n')).toEqual([]);
  });

  // The complaint this resolves: two rungs a shade apart, the dimmer one more
  // saturated, read as two different greys rather than two steps of one.
  it('keeps the text ladder monotone: L falls, chroma rises, one hue', () => {
    const ladder = ['strong', 'primary', 'secondary', 'muted', 'faint'].map((step) => {
      const match = TOKENS_CSS.match(
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
