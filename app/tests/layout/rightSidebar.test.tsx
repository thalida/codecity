import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { RightSidebar } from '@/layout/RightSidebar/RightSidebar';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST, setManifest } from '@/state/stores/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { SELECTION_PANE_DISMISSED, openSelectionPane } from '@/state/stores/ui';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest, PickTarget } from '@/types';
import { flush, drainAsync } from '../_helpers/preact';

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

const DIR_NODE: DirNode = {
  name: 'src',
  type: NodeKind.Directory,
  path: 'src',
  fullPath: '/tmp/project/src',
  children: [],
  children_count: 0,
  children_file_count: 0,
  children_dir_count: 0,
  descendants_count: 3,
  descendants_file_count: 3,
  descendants_dir_count: 0,
  descendants_size: 300,
  descendants_created_min: '2024-01-01T00:00:00Z',
  descendants_modified_max: '2024-02-01T00:00:00Z',
  descendants_ext_breakdown: [{ ext: '.ts', count: 3, size: 300 }],
};

// Build a full Manifest whose tree has exactly one child (a file or a
// directory) at the given path — enough for findNodeByPath's DFS, which
// matches on `path` regardless of nesting depth.
function manifestWithFile(file: FileNode): Manifest {
  return {
    ...EMPTY_MANIFEST,
    tree: { ...EMPTY_MANIFEST.tree, children: [file], children_count: 1, children_file_count: 1 },
  };
}
function manifestWithDir(dir: DirNode): Manifest {
  return {
    ...EMPTY_MANIFEST,
    tree: { ...EMPTY_MANIFEST.tree, children: [dir], children_count: 1, children_dir_count: 1 },
  };
}

// Stub scene handle. The right-sidebar bridge subscribes to
// picker.selection and world.onChange — both need to be live signals
// in the stub so the component picks up selection changes.
function makeSceneHandle() {
  const selection = signal<PickTarget | null>(null);
  const hover = signal<PickTarget | null>(null);
  return {
    world: {
      getManifest() {
        return null;
      },
      getTrees() {
        return null;
      },
      getBuildingByPath() {
        return null;
      },
      getStreetByDir() {
        return null;
      },
    },
    picker: {
      selection,
      hover,
      clearSelection() {
        selection.value = null;
      },
      setSelection(t: PickTarget | null) {
        selection.value = t;
      },
    },
    rig: {
      focusBuilding() {},
      focusStreet() {},
      focusTree() {},
    },
  };
}

describe('RightSidebar', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SELECTION_PANE_DISMISSED.value = false;
    SCENE_HANDLE.value = makeSceneHandle() as never;
    render(<RightSidebar />, container);
    await flush();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    SCENE_HANDLE.value = null;
    TIMELINE_MODE.value = false;
    SELECTION_PANE_DISMISSED.value = false;
  });

  const selectFile = async (file: FileNode) => {
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
    handle.picker.setSelection({
      kind: NodeKind.File,
      file,
      mesh: {} as never,
      data: {} as never,
    });
    await flush();
  };
  const aside = () => container.querySelector<HTMLElement>('aside#right-sidebar')!;
  const isOpen = () => aside().classList.contains('open');

  it('renders an <aside id="right-sidebar"> closed by default', () => {
    const aside = container.querySelector<HTMLElement>('aside#right-sidebar');
    expect(aside).not.toBeNull();
    expect(aside!.classList.contains('open')).toBe(false);
  });

  it('opens with the file preview pane when a file is selected', async () => {
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
    handle.picker.setSelection({
      kind: NodeKind.File,
      file: FILE_NODE,
      mesh: {} as never,
      data: {} as never,
    });
    await flush();

    const aside = container.querySelector<HTMLElement>('aside#right-sidebar')!;
    expect(aside.classList.contains('open')).toBe(true);
    // The file preview pane is mounted (look for its pane title slot).
    expect(aside.querySelector('.pane')).not.toBeNull();
  });

  it('Timeline mode: every selection opens the panel (file, dir, and commit)', async () => {
    TIMELINE_MODE.value = true;
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
    const aside = container.querySelector<HTMLElement>('aside#right-sidebar')!;

    // File selection while scrubbing → panel opens (the sidebar is now the only
    // place a selection is shown; the pane notes it reads HEAD, not the commit).
    handle.picker.setSelection({
      kind: NodeKind.File,
      file: FILE_NODE,
      mesh: {} as never,
      data: {} as never,
    });
    await flush();
    expect(aside.classList.contains('open')).toBe(true);

    // Commit selection also opens.
    handle.picker.setSelection({
      kind: NodeKind.Commit,
      commit: { sha: 'abc1234', date: '2024-01-01', subject: 's', files: 1 } as never,
      mesh: {} as never,
      instanceId: 0,
    });
    await flush();
    expect(aside.classList.contains('open')).toBe(true);
  });

  // #128: excludes now re-fetch the union in Timeline, so the exclude button is
  // offered there too (previously hidden as a would-be no-op).
  it('Timeline mode: the exclude button is available for a selected file', async () => {
    TIMELINE_MODE.value = true;
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
    const aside = container.querySelector<HTMLElement>('aside#right-sidebar')!;
    handle.picker.setSelection({
      kind: NodeKind.File,
      file: FILE_NODE,
      mesh: {} as never,
      data: {} as never,
    });
    await flush();
    expect(aside.querySelector('button[aria-label*="Exclude"]')).not.toBeNull();
  });

  it('renders the resize handle on the inside (left) edge', () => {
    const handle = container.querySelector('.resize-handle--left');
    expect(handle).not.toBeNull();
  });

  // #74: fileState/streetState re-derive from MANIFEST on every read, so a
  // live-update publish refreshes the pane even though the picker's
  // selection snapshot (captured at pick time) is now stale.
  describe('live MANIFEST re-derive', () => {
    const originalManifest = MANIFEST.peek();

    beforeEach(() => {
      // FileTextPreview fetches on mount; stub a small text body so the
      // preview settles without a real server.
      globalThis.fetch = (async () =>
        new Response('const x = 1;\n', { status: 200 })) as unknown as typeof fetch;
    });

    afterEach(() => {
      MANIFEST.value = originalManifest;
    });

    it('file pane reflects a fresh MANIFEST node, not the stale picker snapshot', async () => {
      setManifest(manifestWithFile(FILE_NODE));
      const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
      handle.picker.setSelection({
        kind: NodeKind.File,
        file: FILE_NODE, // the picker's snapshot — becomes stale below
        mesh: {} as never,
        data: {} as never,
      });
      await drainAsync();

      // Small file: the normal text preview renders.
      expect(container.querySelector('.preview-shell')).not.toBeNull();

      // Live update: same path, but now dirty and past the preview size cap.
      // The picker's selection signal is untouched — only MANIFEST changes.
      const updated: FileNode = { ...FILE_NODE, size: 200 * 1024 * 1024, lines: 99, dirty: true };
      setManifest(manifestWithFile(updated));
      await drainAsync();

      expect(container.querySelector('.preview-shell')).toBeNull();
      expect(container.querySelector('.text-card-title')!.textContent).toContain('too large');
    });

    it('street pane reflects a fresh MANIFEST node, not the stale picker snapshot', async () => {
      setManifest(manifestWithDir(DIR_NODE));
      const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
      handle.picker.setSelection({
        kind: NodeKind.Directory,
        dir: DIR_NODE, // the picker's snapshot — becomes stale below
        sidewalk: {} as never,
        street: {} as never,
      });
      await flush();

      expect(container.querySelector('.street-ext-meta')!.textContent).toContain('3');

      // Live update: same path, ext breakdown count bumped (e.g. new/edited
      // files under this directory). The picker's selection is untouched.
      const updated: DirNode = {
        ...DIR_NODE,
        descendants_ext_breakdown: [{ ext: '.ts', count: 9, size: 900 }],
      };
      setManifest(manifestWithDir(updated));
      await flush();

      expect(container.querySelector('.street-ext-meta')!.textContent).toContain('9');
    });
  });

  // The pane's open state is its own: closing it hides the details without
  // forgetting which node is selected (and outlined in the city).
  describe('open state, separate from the selection', () => {
    const close = () =>
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')!.click());

    it('closing hides the pane and leaves the selection standing', async () => {
      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      expect(isOpen()).toBe(true);

      close();
      await flush();

      expect(isOpen()).toBe(false);
      const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
      expect(handle.picker.selection.value).not.toBeNull();
    });

    it('re-asking for the selected node reopens it', async () => {
      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await flush();
      expect(isOpen()).toBe(false);

      // What a click on the already-selected building does (inputHandlers).
      openSelectionPane();
      await flush();

      expect(isOpen()).toBe(true);
    });

    it('picking a different node reopens it', async () => {
      const other: FileNode = { ...FILE_NODE, name: 'other.ts', path: 'src/other.ts' };
      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await flush();
      expect(isOpen()).toBe(false);

      setManifest(manifestWithFile(other));
      await selectFile(other);

      expect(isOpen()).toBe(true);
    });

    it('re-picking a node after deselecting reopens it', async () => {
      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await flush();

      const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeSceneHandle>;
      act(() => handle.picker.clearSelection());
      await flush();

      await selectFile(FILE_NODE);

      expect(isOpen()).toBe(true);
    });

    it('coming back to a node whose pane you closed earlier reopens it', async () => {
      const other: FileNode = { ...FILE_NODE, name: 'other.ts', path: 'src/other.ts' };
      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await flush();

      setManifest(manifestWithFile(other));
      await selectFile(other);
      expect(isOpen()).toBe(true);

      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);

      expect(isOpen()).toBe(true);
    });

    it('stays shut when a rebuild re-resolves the same node to a fresh target', async () => {
      setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await flush();

      // What the picker does on a world rebuild: same path, brand-new PickTarget.
      await selectFile({ ...FILE_NODE });

      expect(isOpen()).toBe(false);
    });

    it('stays shut for no selection at all', async () => {
      SELECTION_PANE_DISMISSED.value = false;
      await flush();
      expect(isOpen()).toBe(false);
    });
  });
});
