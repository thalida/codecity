// state/stores/settings/syntaxTheme.ts — User-selected highlight.js syntax theme.
// Rendered by the HljsThemeLink component to swap a <link id="hljs-theme"> element's href
// so the CSS theme applies immediately without a page reload or re-render.
// Persisted via attachPersistence (Config barrel) so the choice survives
// sessions.

import { persistedSignal } from '@/state/persist';
import { markSettingStore, markAutosave } from '@/state/settingsSchema';

export interface SyntaxThemeOption {
  value: string;
  label: string;
}

// Curated DARK theme list. Light themes are intentionally not offered —
// codecity's UI is a dark theme and bright code panels clash visually.
// Alphabetized by display label.
//
// `as const` makes the values a literal union, which HljsThemeLink's stylesheet
// map is keyed on: adding a theme here fails typecheck until its CSS is
// imported there, so the two cannot drift.
export const SYNTAX_THEME_OPTIONS = [
  { value: 'a11y-dark', label: 'A11y Dark' },
  { value: 'agate', label: 'Agate' },
  { value: 'androidstudio', label: 'Android Studio' },
  { value: 'cybertopia-cherry', label: 'Cybertopia Cherry' },
  { value: 'cybertopia-icecap', label: 'Cybertopia Icecap' },
  { value: 'base16/dracula', label: 'Dracula' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'ir-black', label: 'IR Black' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'monokai-sublime', label: 'Monokai Sublime' },
  { value: 'night-owl', label: 'Night Owl' },
  { value: 'nord', label: 'Nord' },
  { value: 'obsidian', label: 'Obsidian' },
  { value: 'atom-one-dark', label: 'One Dark' },
  { value: 'rose-pine', label: 'Rosé Pine' },
  { value: 'rose-pine-moon', label: 'Rosé Pine Moon' },
  { value: 'shades-of-purple', label: 'Shades of Purple' },
  { value: 'base16/solarized-dark', label: 'Solarized Dark' },
  { value: 'stackoverflow-dark', label: 'Stack Overflow Dark' },
  { value: 'tokyo-night-dark', label: 'Tokyo Night' },
  { value: 'vs2015', label: 'VS 2015' },
] as const satisfies readonly SyntaxThemeOption[];

export type SyntaxThemeValue = (typeof SYNTAX_THEME_OPTIONS)[number]['value'];

// Default matches the hand-rolled theme bundled in HljsThemeLink.css.
// Selecting a theme overrides those .hljs-* rules because the <link> is
// injected into <head> after the bundled CSS (later in the cascade wins at
// equal specificity, and these are the same specificity).
export const SYNTAX_THEME_DEFAULT: SyntaxThemeValue = 'atom-one-dark';
// Typed `string`, not SyntaxThemeValue: the persisted value comes from
// localStorage and may name a theme from an older build. HljsThemeLink
// resolves anything unrecognized back to the default.
export const SYNTAX_THEME = persistedSignal<string>('SYNTAX_THEME', SYNTAX_THEME_DEFAULT);

// SYNTAX_THEME is a setting (it lives in the Appearance tab) but uses a plain
// persistedSignal rather than settingSignal, so register it explicitly.
markSettingStore(SYNTAX_THEME);
// Autosave (write-through): the Appearance tab applies on change, no Save step;
// "Reset all" (World-only) skips it — see settingsDrafts.ts.
markAutosave(SYNTAX_THEME);
