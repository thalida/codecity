// monaco/support.ts — capability gate for the Monaco preview. Kept in its
// own module (no monaco-editor import) so the main bundle can ask "should we
// use Monaco?" without pulling monaco-editor out of its lazy chunk.

// Monaco needs a real browser layout engine (matchMedia, DOM measuring).
// jsdom (unit tests) and any SSR context lack it, so callers fall back to the
// highlight.js preview there.
export function monacoSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}
