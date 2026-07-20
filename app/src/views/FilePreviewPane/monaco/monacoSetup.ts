// monaco/monacoSetup.ts — Monaco wiring for the read-only file preview.
//
// Slim build: the core editor API plus the main-thread Monarch grammars
// (basic-languages) only. The worker-backed language services (TS/JSON/CSS/
// HTML: diagnostics, IntelliSense) are intentionally NOT imported — a
// read-only viewer needs tokenizing highlight, not language analysis, and
// dropping them keeps the lazy chunk far smaller and avoids shipping four
// extra language workers.
//
// Everything here transitively imports monaco-editor, so this module must
// only ever be reached through the lazy MonacoCodeEditor chunk — never from
// the main bundle. The cheap capability check lives in support.ts for that.

// Deep subpaths per monaco-editor's package `exports` map (0.56 remaps
// `./*` → `./esm/vs/*.js`, so the `esm/vs/` prefix is dropped here).
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// Monaco resolves web workers through this global. With no language
// contributions registered, the base editor worker is the only one ever
// requested, so every label maps to it.
(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export { monaco };

// Resolve a file to a registered Monaco language id via its extension,
// reusing Monaco's own grammar registry (no separate ext→lang table to keep
// in sync). Falls back to plaintext.
export function monacoLanguageFor(file: { extension?: string; name?: string }): string {
  const ext = (file.extension || '').toLowerCase();
  if (ext) {
    for (const lang of monaco.languages.getLanguages()) {
      if (lang.extensions?.some((e) => e.toLowerCase() === ext)) return lang.id;
    }
  }
  return 'plaintext';
}

// ── Theme ──────────────────────────────────────────────────────────────────
// Monaco brings its own theme model (token-scope rules + a color map) that
// doesn't map 1:1 to the highlight.js CSS themes. We derive a single Monaco
// theme from codecity's live design tokens instead, so the editor matches the
// app surfaces and tracks the accent/surface presets (#87).

const THEME_NAME = 'codecity';

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Resolve any CSS color string (incl. oklch()) to #rrggbb via a canvas probe —
// the browser does the color-space math. Returns the fallback if the value is
// empty or the browser can't parse it to a plain hex (e.g. an alpha color-mix,
// which serializes as rgba()).
function toHex(cssColor: string, fallback: string): string {
  if (!cssColor) return fallback;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = cssColor;
  const v = ctx.fillStyle;
  return typeof v === 'string' && v.startsWith('#') ? v : fallback;
}

// Monaco rule `foreground` wants the hex WITHOUT the leading '#'; color-map
// values keep it.
function tokenColor(name: string, fallback: string): string {
  return toHex(readVar(name), fallback).slice(1);
}
function mapColor(name: string, fallback: string): string {
  return toHex(readVar(name), fallback);
}

// (Re)define the codecity Monaco theme from the live tokens. Cheap; called on
// each mount so a theme switched while the pane was closed is picked up.
export function ensureMonacoTheme(): string {
  const accent = mapColor('--cc-accent', '#8b7bff');
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: tokenColor('--cc-text-primary', '#d2d4de') },
      {
        token: 'comment',
        foreground: tokenColor('--cc-syntax-comment', '#6b7089'),
        fontStyle: 'italic',
      },
      { token: 'keyword', foreground: tokenColor('--cc-syntax-keyword', '#c792ea') },
      { token: 'string', foreground: tokenColor('--cc-syntax-string', '#a5e2b8') },
      { token: 'regexp', foreground: tokenColor('--cc-syntax-string', '#a5e2b8') },
      { token: 'number', foreground: tokenColor('--cc-syntax-builtin', '#7fd4f5') },
      { token: 'constant', foreground: tokenColor('--cc-syntax-builtin', '#7fd4f5') },
      { token: 'type', foreground: tokenColor('--cc-accent-light', '#b7a0ff') },
      { token: 'type.identifier', foreground: tokenColor('--cc-accent-light', '#b7a0ff') },
      { token: 'variable', foreground: tokenColor('--cc-syntax-variable', '#f0a8b8') },
      { token: 'variable.predefined', foreground: tokenColor('--cc-syntax-builtin', '#7fd4f5') },
      { token: 'function', foreground: accent.slice(1) },
      { token: 'tag', foreground: tokenColor('--cc-syntax-keyword', '#c792ea') },
      { token: 'attribute.name', foreground: tokenColor('--cc-syntax-variable', '#f0a8b8') },
      { token: 'attribute.value', foreground: tokenColor('--cc-syntax-string', '#a5e2b8') },
      { token: 'delimiter', foreground: tokenColor('--cc-text-secondary', '#9498ad') },
      { token: 'operator', foreground: tokenColor('--cc-text-secondary', '#9498ad') },
    ],
    colors: {
      'editor.background': mapColor('--cc-bg-app', '#0d0e14'),
      'editor.foreground': mapColor('--cc-text-primary', '#d2d4de'),
      'editorLineNumber.foreground': mapColor('--cc-text-faint', '#4a4d63'),
      'editorLineNumber.activeForeground': mapColor('--cc-text-secondary', '#9498ad'),
      'editorCursor.foreground': accent,
      'editor.selectionBackground': `${accent}55`,
      'editor.inactiveSelectionBackground': `${accent}2e`,
      'editor.lineHighlightBackground': '#ffffff0a',
      'editorIndentGuide.background1': mapColor('--cc-border-subtle', '#2a2d3f'),
      'editorWidget.background': mapColor('--cc-bg-sidebar', '#16181f'),
      'editorWidget.border': mapColor('--cc-border-subtle', '#2a2d3f'),
    },
  });
  return THEME_NAME;
}
