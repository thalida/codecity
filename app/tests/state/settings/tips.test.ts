// User-facing copy uses colons or commas, never an em-dash. Runtime + source
// halves (a fixture missing a branch under-enforces silently); globs, not lists.

import { describe, it, expect } from 'vitest';
import { forEachSettingStore, getFieldKeys, getFieldDef } from '@/state/settings/schema';

// Self-registration happens on import; glob so a new store is covered the day
// it lands rather than whenever someone remembers to add it here.
const STORE_MODULES = import.meta.glob('../../../src/state/stores/settings/*.ts', { eager: true });

// Source text via the same `?raw` import the shaders use, rather than node's fs
// — this tsconfig has no node types, and the app is browser-targeted.
const SOURCES = import.meta.glob('../../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Keys whose strings reach the user: the split-button menus' copy, and the
// aria-labels a screen reader reads out.
const COPY_KEYS = ['tip', 'description', 'placeholder', 'hint', 'label', 'sublabel'];

describe('user-facing copy', () => {
  it('has no em-dashes in settings field tips', () => {
    const offenders: string[] = [];
    forEachSettingStore((store) => {
      for (const key of getFieldKeys(store as object)) {
        const tip = getFieldDef(store as object, key)?.tip;
        if (tip && tip.includes('—')) offenders.push(`${key}: ${tip}`);
      }
    });
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('registers at least one store per file in settings/, so the glob is doing its job', () => {
    // Not equality: stores register from outside settings/ too, so an exact
    // count is not this test's business.
    let registered = 0;
    forEachSettingStore(() => registered++);
    expect(registered).toBeGreaterThanOrEqual(Object.keys(STORE_MODULES).length);
  });

  it('has no em-dashes in other user-facing copy', () => {
    // `tip: '...'` on one line. Template literals and multi-line strings are not
    // matched; those would need a parser, and copy rarely uses them.
    const re = new RegExp(
      `\\b(${COPY_KEYS.join('|')})\\s*:\\s*(['"])((?:\\\\.|(?!\\2).)*)\\2`,
      'g'
    );
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const m of source.matchAll(re)) {
        if (m[3].includes('—')) offenders.push(`${path}  ${m[1]}: ${m[3]}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
