// vitest stubs CSS assets ("" here), so URL asserts would pass vacuously. The
// Record<SyntaxThemeValue, string> type enforces completeness; only lookup is testable.

import { describe, it, expect } from 'vitest';
import { THEME_HREF, hrefForTheme } from '@/views/CityView/HljsThemeLink/HljsThemeLink';
import { SYNTAX_THEME_OPTIONS, SYNTAX_THEME_DEFAULT } from '@/state/settings/fields/syntaxTheme';

describe('hljs theme stylesheets', () => {
  it('has a stylesheet entry for every offered theme', () => {
    const missing = SYNTAX_THEME_OPTIONS.filter((o) => !(o.value in THEME_HREF));
    expect(missing.map((o) => o.value)).toEqual([]);
  });

  it('offers a theme for every stylesheet entry, with no strays', () => {
    const offered = new Set<string>(SYNTAX_THEME_OPTIONS.map((o) => o.value));
    expect(Object.keys(THEME_HREF).filter((k) => !offered.has(k))).toEqual([]);
  });

  it('falls back to the default for a theme name it does not recognize', () => {
    // A persisted setting can name a theme that a later build dropped; that
    // must resolve to the default entry rather than an undefined href.
    expect(hrefForTheme('theme-from-an-older-build')).toBe(THEME_HREF[SYNTAX_THEME_DEFAULT]);
  });
});
