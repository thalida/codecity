// state/stores/settings/syntaxTheme.ts — User-selected highlight.js syntax theme.
// Rendered by the HljsThemeLink component to swap a <link id="hljs-theme"> element's href
// so the CSS theme applies immediately without a page reload or re-render.
// Persisted via attachPersistence (Config barrel) so the choice survives
// sessions.

import { persistedSignal } from '@/state/persist';
import { markSettingStore } from '@/state/settingsSchema';

export interface SyntaxThemeOption {
  value: string;
  label: string;
}

// Curated DARK theme list. All filenames verified against
// node_modules/highlight.js/styles/ (highlight.js 11.11.1). Light themes
// are intentionally not offered — codecity's UI is a dark theme and bright
// code panels clash visually. Alphabetized by display label.
export const SYNTAX_THEME_OPTIONS: SyntaxThemeOption[] = [
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
];

// Default matches the hand-rolled theme bundled in HljsThemeLink.css.
// Changing to a CDN theme overrides those .hljs-* rules because the <link>
// is injected into <head> after the bundled CSS (later in the cascade wins
// at equal specificity, and these are the same specificity).
export const SYNTAX_THEME_DEFAULT = 'atom-one-dark';
export const SYNTAX_THEME = persistedSignal<string>('SYNTAX_THEME', SYNTAX_THEME_DEFAULT);

// Theme-picker writes directly to this signal (no draft layer — the CSS
// link swaps instantly). stageResetAll() reads this flag and resets
// directly too, so "Reset all" doesn't leave behind a phantom draft.
(SYNTAX_THEME as unknown as { _skipDrafts?: boolean })._skipDrafts = true;

// SYNTAX_THEME is a setting (it lives in the File Preview section) but uses a
// plain persistedSignal rather than settingSignal, so register it explicitly so
// "Reset all" still resets it (non-settings persisted state is NOT registered).
markSettingStore(SYNTAX_THEME);
