// syntaxTheme.ts — highlight.js theme loader. Swaps the
// <link id="hljs-theme"> element's href so the chosen highlight.js CSS
// theme loads immediately without a re-render. The .hljs-* token classes
// are already in the DOM; only the colours change. Called once on boot
// (after attachPersistence hydrates the stored choice) and again on every
// subsequent SYNTAX_THEME change.

const HLJS_VERSION = '11.11.1';

export function applyHljsTheme(theme: string): void {
  const id = 'hljs-theme';
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://cdn.jsdelivr.net/npm/highlight.js@${HLJS_VERSION}/styles/${theme}.min.css`;
}
