import { DirNode, FileNode, Manifest, NodeKind, PickTarget } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CitySidebarRight } from '@/features/city/components/CitySidebarRight/CitySidebarRight';
import { createCityChrome, type CityChromeState } from '@/features/city/state/sidebar';
import { renderWithCity, type FakeCity } from '../../../_helpers/cityChrome';

import { EMPTY_MANIFEST } from '@codecity/city/testing';
import { drainAsync } from '../../../_helpers/preact';

const FILE_NODE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
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

// A manifest with one child at the given path: findNodeByPath matches on path
// whatever the depth, so nothing deeper is needed.
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

describe('CitySidebarRight', () => {
  let container: HTMLDivElement;
  let handle: FakeCity;
  let chrome: CityChromeState;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    chrome = createCityChrome();
    handle = renderWithCity(<CitySidebarRight />, container, undefined, chrome);
    // The world the panes reach for their meshes; the city itself has none.
    (handle as unknown as { world: unknown }).world = {
      getManifest: () => null,
      getTrees: () => null,
      getBuildingByPath: () => null,
      getStreetByDir: () => null,
    };
    await drainAsync();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  const selectFile = async (file: FileNode) => {
    handle.picker.setSelection({
      kind: NodeKind.File,
      file,
      mesh: {} as never,
      data: {} as never,
    });
    await drainAsync();
  };
  const aside = () => container.querySelector<HTMLElement>('aside#city-sidebar-right')!;
  const isOpen = () => aside().classList.contains('open');

  it('renders an <aside id="city-sidebar-right"> closed by default', () => {
    const aside = container.querySelector<HTMLElement>('aside#city-sidebar-right');
    expect(aside).not.toBeNull();
    expect(aside!.classList.contains('open')).toBe(false);
  });

  it('opens with the file preview pane when a file is selected', async () => {
    handle.picker.setSelection({
      kind: NodeKind.File,
      file: FILE_NODE,
      mesh: {} as never,
      data: {} as never,
    });
    await drainAsync();

    const aside = container.querySelector<HTMLElement>('aside#city-sidebar-right')!;
    expect(aside.classList.contains('open')).toBe(true);
    // The file preview pane is mounted (look for its pane title slot).
    expect(aside.querySelector('.pane')).not.toBeNull();
  });

  it('Timeline mode: every selection opens the panel (file, dir, and commit)', async () => {
    handle.timeline.enter();
    const aside = container.querySelector<HTMLElement>('aside#city-sidebar-right')!;

    // File selection while scrubbing → panel opens (the sidebar is now the only
    // place a selection is shown; the pane notes it reads HEAD, not the commit).
    handle.picker.setSelection({
      kind: NodeKind.File,
      file: FILE_NODE,
      mesh: {} as never,
      data: {} as never,
    });
    await drainAsync();
    expect(aside.classList.contains('open')).toBe(true);

    // Commit selection also opens.
    handle.picker.setSelection({
      kind: NodeKind.Commit,
      commit: { sha: 'abc1234', date: '2024-01-01', subject: 's', files: 1 } as never,
      mesh: {} as never,
      instanceId: 0,
    });
    await drainAsync();
    expect(aside.classList.contains('open')).toBe(true);
  });

  // #128: excludes now re-fetch the union in Timeline, so the exclude button is
  // offered there too (previously hidden as a would-be no-op).
  it('Timeline mode: the exclude button is available for a selected file', async () => {
    handle.timeline.enter();
    const aside = container.querySelector<HTMLElement>('aside#city-sidebar-right')!;
    handle.picker.setSelection({
      kind: NodeKind.File,
      file: FILE_NODE,
      mesh: {} as never,
      data: {} as never,
    });
    await drainAsync();
    expect(aside.querySelector('button[aria-label*="Exclude"]')).not.toBeNull();
  });

  it('renders the resize handle on the inside (left) edge', () => {
    const handle = container.querySelector('.resize-handle--left');
    expect(handle).not.toBeNull();
  });

  // The pane states re-derive from MANIFEST on every read, so a live update
  // refreshes them even though the selection snapshot is stale.
  describe('live MANIFEST re-derive', () => {
    beforeEach(() => {
      // FileTextPreview fetches on mount; stub a small text body so the
      // preview settles without a real server.
      globalThis.fetch = (async () =>
        new Response('const x = 1;\n', { status: 200 })) as unknown as typeof fetch;
    });

    it('file pane reflects a fresh MANIFEST node, not the stale picker snapshot', async () => {
      handle.setManifest(manifestWithFile(FILE_NODE));
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
      handle.setManifest(manifestWithFile(updated));
      await drainAsync();

      expect(container.querySelector('.preview-shell')).toBeNull();
      expect(container.querySelector('.text-card-title')!.textContent).toContain('too large');
    });

    it('street pane reflects a fresh MANIFEST node, not the stale picker snapshot', async () => {
      handle.setManifest(manifestWithDir(DIR_NODE));
      handle.picker.setSelection({
        kind: NodeKind.Directory,
        dir: DIR_NODE, // the picker's snapshot — becomes stale below
        sidewalk: {} as never,
        street: {} as never,
      });
      await drainAsync();

      expect(container.querySelector('.street-ext-meta')!.textContent).toContain('3');

      // Live update: same path, ext breakdown count bumped (e.g. new/edited
      // files under this directory). The picker's selection is untouched.
      const updated: DirNode = {
        ...DIR_NODE,
        descendants_ext_breakdown: [{ ext: '.ts', count: 9, size: 900 }],
      };
      handle.setManifest(manifestWithDir(updated));
      await drainAsync();

      expect(container.querySelector('.street-ext-meta')!.textContent).toContain('9');
    });
  });

  // The pane's open state is its own: closing it hides the details without
  // forgetting which node is selected (and outlined in the city).
  describe('open state, separate from the selection', () => {
    const close = () =>
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')!.click());

    it('closing hides the pane and leaves the selection standing', async () => {
      handle.setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      expect(isOpen()).toBe(true);

      close();
      await drainAsync();

      expect(isOpen()).toBe(false);
      expect(handle.picker.selection).not.toBeNull();
    });

    it('re-asking for the selected node reopens it', async () => {
      handle.setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await drainAsync();
      expect(isOpen()).toBe(false);

      // What a click on the already-selected building does (inputHandlers).
      chrome.openDetails();
      await drainAsync();

      expect(isOpen()).toBe(true);
    });

    // Reopening is the picking side's call (covered in inputHandlersPick).
    // Here: a selection landing on its own must move nothing.
    it('stays shut when a rebuild re-resolves the same node to a fresh target', async () => {
      handle.setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      close();
      await drainAsync();

      // What the picker does on a world rebuild: same path, brand-new PickTarget.
      await selectFile({ ...FILE_NODE });

      expect(isOpen()).toBe(false);
    });

    // Focusing is asking to look at the thing, which the pane is in front of.
    // Desktop too: this used to clear the way only on a phone.
    it('the Focus button puts the pane away and keeps the selection', async () => {
      handle.setManifest(manifestWithFile(FILE_NODE));
      await selectFile(FILE_NODE);
      expect(isOpen()).toBe(true);

      act(() =>
        container.querySelector<HTMLButtonElement>('button[title^="Focus the camera"]')!.click()
      );
      await drainAsync();

      expect(isOpen()).toBe(false);
      expect(handle.picker.selection).not.toBeNull();
    });

    it('stays shut for no selection at all', async () => {
      chrome.detailsDismissed.value = false;
      await drainAsync();
      expect(isOpen()).toBe(false);
    });
  });
});
