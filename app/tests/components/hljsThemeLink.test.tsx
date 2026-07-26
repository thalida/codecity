// Note on scope: vitest stubs CSS assets, so `?url` imports evaluate to "" here
// and asserting on the resolved URLs would pass vacuously. Two other things do
// the real enforcing: THEME_HREF is typed `Record<SyntaxThemeValue, string>`, so
// a missing theme fails typecheck, and the hrefs come from bundler-resolved
// imports, which cannot produce an off-origin URL the way the old hardcoded
// jsDelivr template string did. What's left to test at runtime is the lookup.

import { describe, it, expect } from 'vitest';
import { THEME_HREF, hrefForTheme } from '@/components/HljsThemeLink/HljsThemeLink';
import { SYNTAX_THEME_OPTIONS, SYNTAX_THEME_DEFAULT } from '@/state/stores/settings/syntaxTheme';

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
