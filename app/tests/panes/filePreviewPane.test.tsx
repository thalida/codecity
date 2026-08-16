import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import {
  FilePreviewPane,
  PreviewKind,
  _previewKind,
} from '@/panes/FilePreviewPane/FilePreviewPane';
import type { FilePreviewPaneState } from '@/panes/FilePreviewPane/FilePreviewPane';
import { NodeKind } from '@/types';
import type { FileNode } from '@/types';
// A text preview settles across an effect, a fetch chain and a rAF, and jsdom's
// rAF is a ~16ms timer: drainAsync yields macrotasks too, or it races that.
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
  dirty: false,
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
    // A small text body by default, so the editor renders without a server;
    // individual tests override globalThis.fetch.
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
    // .editor-body is the marker the assertion targets, whichever wrapper
    // class the pane puts around it.
    expect(pane.querySelector('.editor-body')).not.toBeNull();
  });

  it('renders a pane header with a title element', () => {
    mount();
    expect(container.querySelector('.pane-header')).not.toBeNull();
    expect(container.querySelector('.text-pane-title')).not.toBeNull();
  });

  it('starts in the empty state (no file) with "No file" title', async () => {
    mount();
    // The empty state is mounted from an effect, so it lands one commit
    // later: drain before asserting on the body.
    await drainAsync();
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.text-pane-title')!.textContent).toBe('No file');
  });

  it('setFile(file) replaces the empty state with preview content and shows the filename', async () => {
    mount();
    await setFile(FILE_NODE);
    // An .empty-state can reappear inside the shell after a failure, but the
    // body must no longer be ONLY a state message.
    expect(container.querySelector('.preview-shell')).not.toBeNull();
    // The title is a path breadcrumb; its leaf segment is the filename.
    expect(container.querySelector('.text-pane-title .is-leaf')!.textContent).toBe('index.ts');
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
    expect(container.querySelector('.text-pane-title .is-leaf')!.textContent).toBe('utils.ts');
  });

  const BINARY_NODE: FileNode = {
    name: 'data.db',
    type: NodeKind.File,
    path: 'data/data.db',
    fullPath: '/tmp/project/data.db',
    extension: '.db',
    size: 50000,
    lines: 0,
    binary: true,
    binaryType: 'SQLite database',
    dirty: false,
    created: '2024-01-10T09:00:00Z',
    modified: '2024-03-20T10:00:00Z',
  };

  it('renders a data card (type + size + dates) for a binary file, not garbled text', async () => {
    mount();
    await setFile(BINARY_NODE);
    // The data card, not the syntax-highlighted text dump: only the card shows
    // the detected type + formatted size.
    const card = container.querySelector('.binary-card');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('SQLite database'); // detected type
    expect(card!.textContent).toContain('48.8 KB'); // formatted size
    expect(container.querySelector('.binary-fingerprint-frame')).not.toBeNull();
  });

  it('embeds the fetched fingerprint as a data-URL image', async () => {
    const b64 = 'iVBORw0KGgoAAAANSg==';
    globalThis.fetch = (async (url: string) =>
      String(url).includes('/api/fingerprints')
        ? new Response(JSON.stringify({ '/tmp/project/data.db': { b64 } }), { status: 200 })
        : new Response('', { status: 200 })) as unknown as typeof fetch;

    mount();
    await setFile(BINARY_NODE);
    // The fingerprint fetch coalesces on a 16ms timer; drain past it.
    await act(async () => {
      await drainAsync(40, 1);
    });
    const img = container.querySelector('.binary-fingerprint') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(`data:image/png;base64,${b64}`);
  });

  it('re-fetches content when a still-selected file is edited (mtime changes)', async () => {
    // A live-update poll re-derives the selected FileNode with the same path
    // but a newer mtime; the preview must re-fetch, not wait for a re-select.
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response('body\n', { status: 200 });
    }) as unknown as typeof fetch;
    mount();
    await setFile(FILE_NODE);
    const afterFirst = urls.length;
    expect(afterFirst).toBeGreaterThan(0);
    // Same path, newer mtime + size — what an edit-then-poll yields.
    await setFile({ ...FILE_NODE, modified: '2026-07-19T12:00:00Z', size: 1600 });
    expect(urls.length).toBeGreaterThan(afterFirst);
    // The refetch URL carries the mtime cache-buster so the browser can't serve
    // the stale body for the unchanged path.
    expect(urls[urls.length - 1]).toContain('mtime=');
  });

  it('falls through to preview (no "too large" state) for a 10 MB file', async () => {
    mount();
    await setFile({ ...FILE_NODE, size: 10 * 1024 * 1024 });
    // Below the cap, so no "too large" gate: the shell mounts while the fetch
    // flies, and the tier is picked once it answers.
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

    // jsdom ships no FontFace, so this stubs one plus a byte-returning fetch;
    // `loads` decides whether FontFace.load() resolves.
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
