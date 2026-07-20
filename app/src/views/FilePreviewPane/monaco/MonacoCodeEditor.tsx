// monaco/MonacoCodeEditor.tsx — read-only Monaco editor for the file preview.
//
// Lazy-loaded as its own chunk (see FilePreviewPane's lazy() import) so
// monaco-editor never enters the initial city bundle; it's only fetched the
// first time a text file is previewed, and only in a real browser
// (support.ts gates jsdom/SSR to the highlight.js fallback).

import './MonacoCodeEditor.css';
import { useRef } from 'preact/hooks';
import { useEffect } from 'preact/hooks';
import { Info } from 'lucide-preact';
import type { FileNode } from '@/types';
import { formatBytes } from '@/utils/bytes';
import { monaco, ensureMonacoTheme, monacoLanguageFor } from './monacoSetup';

// Above this size we drop the minimap + folding so scrolling stays smooth on
// multi-MB files. Monaco also stops tokenizing very large models on its own,
// so it degrades further above ~20MB without extra help here.
const HEAVY_FEATURES_MAX_BYTES = 2 * 1024 * 1024;

interface MonacoCodeEditorProps {
  text: string;
  file: FileNode;
}

export default function MonacoCodeEditor({ text, file }: MonacoCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sizeBytes = typeof file.size === 'number' ? file.size : text.length;
  const heavy = sizeBytes > HEAVY_FEATURES_MAX_BYTES;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const theme = ensureMonacoTheme();
    const fontFamily =
      getComputedStyle(document.documentElement).getPropertyValue('--cc-font-mono').trim() ||
      'monospace';

    const editor = monaco.editor.create(host, {
      value: text,
      language: monacoLanguageFor(file),
      theme,
      readOnly: true,
      // Mark the underlying textarea readonly too, so nothing (IME, paste) can
      // mutate the buffer and the a11y tree reports it as read-only.
      domReadOnly: true,
      automaticLayout: true,
      ariaLabel: file.name || 'File preview',
      fontFamily,
      fontSize: 12,
      lineHeight: 18,
      minimap: { enabled: !heavy },
      folding: !heavy,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      contextmenu: true,
      wordWrap: 'off',
      stickyScroll: { enabled: false },
      overviewRulerLanes: 0,
      scrollbar: { useShadows: false },
    });

    return () => {
      editor.getModel()?.dispose();
      editor.dispose();
    };
  }, [file.fullPath, file.modified, text, heavy]);

  return (
    <div class="monaco-preview">
      {heavy && (
        <div class="code-editor-banner card-banner">
          <Info class="icon" />
          <span>
            Large file ({formatBytes(sizeBytes)}) — minimap and folding are off to keep scrolling
            smooth.
          </span>
        </div>
      )}
      <div ref={hostRef} class="monaco-host" />
    </div>
  );
}
