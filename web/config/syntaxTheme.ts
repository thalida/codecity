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

// Curated theme list. All filenames verified against
// node_modules/highlight.js/styles/ (highlight.js 11.11.1).
export const SYNTAX_THEME_OPTIONS: SyntaxThemeOption[] = [
  { value: 'atom-one-dark', label: 'One Dark' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'atom-one-light', label: 'One Light' },
  { value: 'github', label: 'GitHub Light' },
  { value: 'default', label: 'Default' },
];

// Default matches the hand-rolled theme that was previously hardcoded in
// styles.css. Changing to a CDN theme overrides those .hljs-* rules because
// the <link> is injected into <head> after styles.css (higher specificity
// wins when cascade order is equal and these are the same specificity).
export const SYNTAX_THEME = atom<string>('atom-one-dark');
