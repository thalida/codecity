// state/stores/settings/syntaxTheme.ts — User-selected editor color theme for
// the file preview. Drives the Monaco editor's theme (see
// FilePreviewPane/monaco/monacoSetup.ts). Persisted via attachPersistence
// (Config barrel) so the choice survives sessions.

import { persistedSignal } from '@/state/persist';
import { markSettingStore, markAutosave } from '@/state/settingsSchema';

export interface SyntaxThemeOption {
  value: string;
  label: string;
}

// Curated DARK theme list. 'codecity' is derived at runtime from the app's
// design tokens (tracks the accent/surface presets, #87); the rest are
// TextMate themes vendored from monaco-themes — each `value` matches a
// FilePreviewPane/monaco/themes/<value>.json file. Light themes are
// intentionally not offered (codecity's UI is dark; bright code panels clash).
// Alphabetized by display label, with the codecity default pinned first.
export const SYNTAX_THEME_OPTIONS: SyntaxThemeOption[] = [
  { value: 'codecity', label: 'Codecity' },
  { value: 'cobalt2', label: 'Cobalt2' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'monoindustrial', label: 'Monoindustrial' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'night-owl', label: 'Night Owl' },
  { value: 'nord', label: 'Nord' },
  { value: 'oceanic-next', label: 'Oceanic Next' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'tomorrow-night-eighties', label: 'Tomorrow Night Eighties' },
  { value: 'twilight', label: 'Twilight' },
];

// Default is the token-derived theme that matches the app surfaces.
export const SYNTAX_THEME_DEFAULT = 'codecity';
export const SYNTAX_THEME = persistedSignal<string>('SYNTAX_THEME', SYNTAX_THEME_DEFAULT);

// SYNTAX_THEME is a setting (it lives in the Appearance tab) but uses a plain
// persistedSignal rather than settingSignal, so register it explicitly.
markSettingStore(SYNTAX_THEME);
// Autosave (write-through): the Appearance tab applies on change, no Save step;
// "Reset all" (World-only) skips it — see settingsDrafts.ts.
markAutosave(SYNTAX_THEME);
