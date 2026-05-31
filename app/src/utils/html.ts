// utils/html.ts — Escape user-supplied text for safe insertion into raw
// HTML strings. Used by code-paths that still build HTML via
// innerHTML / template strings (legacy modal factories, syntax-highlight
// fallback). Preact components don't need this — JSX text is escaped
// automatically.
//
// `escapeHtml` is safe for element-text contexts; `escapeAttr` extends
// it with quote escaping for attribute-value contexts.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
