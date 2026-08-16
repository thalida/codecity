// User-selected highlight.js syntax theme, persisted; HljsThemeLink swaps the
// <link> href so it applies without a reload.

import { persistedSignal } from '@/state/persist';
import { markSettingStore, markAutosave } from '@/state/settingsSchema';

export interface SyntaxThemeOption {
  value: string;
  label: string;
}

// Curated DARK themes only (bright panels clash with the UI), alphabetized. `as
// const` keys HljsThemeLink's map: a new theme fails typecheck until its CSS imports.
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

// Default matches HljsThemeLink.css's bundled theme; a selected theme's <link>
// lands later in <head>, so it wins the cascade at equal specificity.
export const SYNTAX_THEME_DEFAULT: SyntaxThemeValue = 'atom-one-dark';
// `string`, not SyntaxThemeValue: localStorage may hold a theme from an older
// build; HljsThemeLink resolves unknowns to the default.
export const SYNTAX_THEME = persistedSignal<string>('SYNTAX_THEME', SYNTAX_THEME_DEFAULT);

// SYNTAX_THEME is a setting (it lives in the Appearance tab) but uses a plain
// persistedSignal rather than settingSignal, so register it explicitly.
markSettingStore(SYNTAX_THEME);
// Autosave (write-through): the Appearance tab applies on change, no Save step;
// "Reset all" (World-only) skips it — see settingsDrafts.ts.
markAutosave(SYNTAX_THEME);
