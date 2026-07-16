import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import {
  FilePreviewPane,
  PreviewKind,
  _previewKind,
} from '@/views/FilePreviewPane/FilePreviewPane';
import type { FilePreviewPaneState } from '@/views/FilePreviewPane/FilePreviewPane';
import { NodeKind } from '@/types';
import type { FileNode } from '@/types';
// Settling a FilePreviewPane render for a TEXT file involves three interleaved
// schedulers: the body useEffect (mounts .preview-shell, kicks off
// fetchFileText()), the fetch chain (fetch() then resp.text()), and a
// requestAnimationFrame that builds the code editor. jsdom's rAF fires on a
// ~16ms timer, so draining only microtasks races the rAF callback — drainAsync
// alternates microtask drains with real macrotask yields to cover all hops.
import { drainAsync } from '../_helpers/preact';

const FILE_NODE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
  fullPath: '/tmp/project/src/index.ts',
  extension: '.ts',
  size: 1536,
  lines: 50,
  binary: false,
  created: '2024-01-10T09:00:00Z',
  modified: '2024-03-20T10:00:00Z',
};

describe('FilePreviewPane', () => {
  let container: HTMLDivElement;
  let state: ReturnType<typeof signal<FilePreviewPaneState>>;

  function mount(opts: { onClose?: () => void; onFocus?: (f: FileNode) => void } = {}): void {
    state = signal<FilePreviewPaneState>({ file: null });
    render(
      <FilePreviewPane state={state} onClose={opts.onClose} onFocus={opts.onFocus} />,
      container
    );
  }

  // setFile(file) on the old factory maps to assigning the signal value and
  // letting the body useEffect + fetch + rAF settle.
  async function setFile(file: FileNode | null): Promise<void> {
    await act(async () => {
      state.value = { file };
    });
    await drainAsync();
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Text path fetches via fetchFileText → fetch() → resp.text(). Default
    // every fetch to a small text body so the code editor renders without a
    // real server. Individual tests can override globalThis.fetch.
    globalThis.fetch = (async () =>
      new Response('export const x = 1;\nconst y = 2;\n', {
        status: 200,
      })) as unknown as typeof fetch;
  });

  afterEach(() => {
    // Unmount so the body useEffect cleanup runs and any in-flight fetch /
    // rAF callback lands on a detached host instead of the live tree.
    render(null, container);
    container.remove();
  });

  it('returns a .pane wrapper containing a .editor-body', () => {
    mount();
    const pane = container.querySelector('.pane') as HTMLElement;
    expect(pane.classList.contains('pane')).toBe(true);
    // Pane renders the body as `.pane-body editor-body`; the original
    // factory used `.pane editor-body`. The .editor-body marker is what the
    // assertion targets and it is unchanged.
    expect(pane.querySelector('.editor-body')).not.toBeNull();
  });

  it('renders a pane header with a title element', () => {
    mount();
    expect(container.querySelector('.pane-header')).not.toBeNull();
    expect(container.querySelector('.text-pane-title')).not.toBeNull();
  });

  it('starts in the empty state (no file) with "No file" title', async () => {
    mount();
    // The empty-state body is mounted imperatively in a useEffect (the
    // original factory built it synchronously), so it appears one commit
    // later — drain before asserting on the body content.
    await drainAsync();
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.text-pane-title')!.textContent).toBe('No file');
  });

  it('setFile(file) replaces the empty state with preview content and shows the filename', async () => {
    mount();
    await setFile(FILE_NODE);
    // .empty-state can re-appear inside the shell after a fetch failure, but
    // the body should no longer be ONLY a state message — a .preview-shell
    // wrapper is the file path's first child.
    expect(container.querySelector('.preview-shell')).not.toBeNull();
    // The title shows just the leaf filename (compact sidebar header — the
    // full path lives in the sitewide app header).
    expect(container.querySelector('.text-pane-title')!.textContent).toBe('index.ts');
  });

  it('setFile(null) returns to the empty state and the "No file" title', async () => {
    mount();
    await setFile(FILE_NODE);
    await setFile(null);
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.preview-shell')).toBeNull();
    expect(container.querySelector('.text-pane-title')!.textContent).toBe('No file');
  });

  it('successive setFile calls leave a single body content tree', async () => {
    mount();
    await setFile(FILE_NODE);
    await setFile({ ...FILE_NODE, name: 'utils.ts', path: 'src/utils.ts' });
    // exactly one preview-shell, no leftover from the first call
    expect(container.querySelectorAll('.preview-shell').length).toBe(1);
    expect(container.querySelector('.text-pane-title')!.textContent).toBe('utils.ts');
  });

  it('falls through to preview (no "too large" state) for a 10 MB file', async () => {
    mount();
    await setFile({ ...FILE_NODE, size: 10 * 1024 * 1024 });
    // 10 MB is below the 100 MB cap → no client-side "too large" gate; the
    // preview-shell scaffold gets mounted while the fetch flies (the
    // rendering tier is selected after the response arrives).
    expect(container.querySelector('.preview-shell')).not.toBeNull();
    const stateTitle = container.querySelector('.text-card-title');
    if (stateTitle) expect(stateTitle.textContent).not.toContain('too large');
  });

  it('shows the "too large" state for files above the 100 MB API cap', async () => {
    mount();
    await setFile({ ...FILE_NODE, size: 200 * 1024 * 1024 });
    expect(container.querySelector('.preview-shell')).toBeNull();
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.text-card-title')!.textContent).toContain('too large');
  });

  describe('font specimen', () => {
    const FONT_NODE: FileNode = {
      ...FILE_NODE,
      name: 'Inter.woff2',
      path: 'fonts/Inter.woff2',
      fullPath: '/tmp/project/fonts/Inter.woff2',
      extension: '.woff2',
      binary: true,
    };

    // A minimal valid TrueType signature (0x00010000) padded to a few bytes.
    const TTF_BYTES = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const LFS_POINTER = new TextEncoder().encode(
      'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 4\n'
    );

    // jsdom ships no FontFace/document.fonts and the component now fetches the
    // bytes itself, so stub a controllable FontFace plus a fetch that returns a
    // chosen byte body. `loads` controls whether FontFace.load() resolves.
    let origFontFace: unknown;
    let origFonts: unknown;
    let loadCalls = 0;
    function installFont(bytes: Uint8Array, loads = true): void {
      loadCalls = 0;
      class FakeFontFace {
        family: string;
        constructor(family: string) {
          this.family = family;
        }
        load(): Promise<FakeFontFace> {
          loadCalls += 1;
          return loads ? Promise.resolve(this) : Promise.reject(new Error('bad font table'));
        }
      }
      origFontFace = (globalThis as Record<string, unknown>).FontFace;
      origFonts = (document as unknown as Record<string, unknown>).fonts;
      (globalThis as Record<string, unknown>).FontFace = FakeFontFace;
      (document as unknown as Record<string, unknown>).fonts = { add() {}, delete() {} };
      globalThis.fetch = (async () =>
        new Response(bytes.buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch;
    }
    afterEach(() => {
      (globalThis as Record<string, unknown>).FontFace = origFontFace;
      (document as unknown as Record<string, unknown>).fonts = origFonts;
    });

    it('_previewKind maps font extensions to Font', () => {
      expect(_previewKind({ extension: '.woff2' })).toBe(PreviewKind.Font);
      expect(_previewKind({ extension: '.WOFF' })).toBe(PreviewKind.Font);
      expect(_previewKind({ extension: '.ttf' })).toBe(PreviewKind.Font);
      expect(_previewKind({ extension: '.otf' })).toBe(PreviewKind.Font);
      // Non-fonts still fall through to text.
      expect(_previewKind({ extension: '.ts' })).toBe(PreviewKind.Text);
    });

    it('renders a specimen (alphabet + pangram + glyph grid) once the face loads', async () => {
      installFont(TTF_BYTES);
      mount();
      await setFile(FONT_NODE);
      const specimen = container.querySelector('.font-specimen') as HTMLElement;
      expect(specimen).not.toBeNull();
      expect(specimen.textContent).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      expect(specimen.textContent).toContain('The quick brown fox jumps over the lazy dog');
      // Repertoire grid renders a cell per glyph (well past the 26-letter alphabet).
      expect(container.querySelectorAll('.font-specimen-glyph').length).toBeGreaterThan(26);
    });

    it('rejects a Git LFS pointer without attempting to decode it', async () => {
      installFont(LFS_POINTER);
      mount();
      await setFile(FONT_NODE);
      expect(container.querySelector('.font-specimen')).toBeNull();
      expect(container.querySelector('.empty-state')).not.toBeNull();
      expect(container.querySelector('.text-card-sub')!.textContent).toContain('Git LFS');
      // The whole point: never hand non-font bytes to the browser's decoder.
      expect(loadCalls).toBe(0);
    });

    it('falls back to a graceful notice when a real font fails to parse', async () => {
      installFont(TTF_BYTES, false);
      mount();
      await setFile(FONT_NODE);
      expect(container.querySelector('.font-specimen')).toBeNull();
      expect(container.querySelector('.empty-state')).not.toBeNull();
      expect(container.querySelector('.text-card-title')!.textContent).toContain('font');
      expect(loadCalls).toBe(1);
    });
  });

  it('renders the × close button only when onClose is provided', () => {
    // No onClose (and no onFocus) → header renders no trailing icon button.
    mount();
    expect(container.querySelector('.pane-header .btn-icon:last-child')).toBeNull();

    // Tear down the no-close mount before remounting into the same container.
    render(null, container);

    let closed = false;
    mount({
      onClose: () => {
        closed = true;
      },
    });
    const btn = container.querySelector(
      '.pane-header .btn-icon:last-child'
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(closed).toBe(true);
  });
});
