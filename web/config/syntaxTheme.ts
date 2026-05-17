// config/syntaxTheme.ts — User-selected highlight.js syntax theme.
// Subscribed in main.ts to swap a <link id="hljs-theme"> element's href
// so the CSS theme applies immediately without a page reload or re-render.
// Persisted via attachPersistence (Config barrel) so the choice survives
// sessions.

import { atom } from 'nanostores';

export interface SyntaxThemeOption {
  value: string;
  label: string;
}

// Curated DARK theme list. All filenames verified against
// node_modules/highlight.js/styles/ (highlight.js 11.11.1). Light themes
// are intentionally not offered — codecity's UI is a dark theme and bright
// code panels clash visually.
export const SYNTAX_THEME_OPTIONS: SyntaxThemeOption[] = [
  { value: 'atom-one-dark', label: 'One Dark' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'base16/dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
  { value: 'night-owl', label: 'Night Owl' },
  { value: 'tokyo-night-dark', label: 'Tokyo Night' },
  { value: 'a11y-dark', label: 'A11y Dark' },
];

// Default matches the hand-rolled theme that was previously hardcoded in
// styles.css. Changing to a CDN theme overrides those .hljs-* rules because
// the <link> is injected into <head> after styles.css (higher specificity
// wins when cascade order is equal and these are the same specificity).
export const SYNTAX_THEME_DEFAULT = 'atom-one-dark';
export const SYNTAX_THEME = atom<string>(SYNTAX_THEME_DEFAULT);
