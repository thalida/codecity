// The switcher parks the city as a backdrop and puts everything back on
// dismiss. "Everything" includes whether the selection's pane was minimised to
// its chip: re-selecting fires the store's reopen effect, so a restore that
// stops at the selection springs a panel the user had put away back open.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { useSwitcherShowcase } from '@/hooks/useSwitcherShowcase';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { CURRENT_SOURCE } from '@/state/stores/source';
import {
  SELECTION_PANE_DISMISSED,
  openProjectsView,
  closeProjectsView,
  dismissSelectionPane,
  openSelectionPane,
} from '@/state/stores/ui';
import { NodeKind } from '@/types';
import type { FileNode, PickTarget, PickerSelectionKey } from '@/types';
import { flush, drainAsync } from '../_helpers/preact';

const FILE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
  fullPath: '/tmp/p/src/index.ts',
  extension: '.ts',
  size: 10,
  lines: 2,
  binary: false,
  dirty: false,
  created: '2024-01-01T00:00:00Z',
  modified: '2024-01-02T00:00:00Z',
};

const targetFor = (path: string): PickTarget => ({
  kind: NodeKind.File,
  file: { ...FILE, path },
  mesh: {} as never,
  data: {} as never,
});

// Selecting writes the same picker signals the real one does, so the hook's
// save/restore runs against real signal plumbing rather than stubs.
function makeHandle() {
  const selection = signal<PickTarget | null>(null);
  const selectionKey = signal<PickerSelectionKey | null>(null);
  return {
    picker: {
      selection,
      selectionKey,
      clearSelection() {
        selection.value = null;
        selectionKey.value = null;
      },
      selectByPath(path: string) {
        selection.value = targetFor(path);
        selectionKey.value = { kind: NodeKind.File, path };
      },
      selectByCommit() {},
    },
    rig: {
      getPose: () => null,
      applyPose() {},
      enterShowcase() {},
      exitShowcase() {},
    },
  };
}

function Harness() {
  useSwitcherShowcase();
  return null;
}

describe('useSwitcherShowcase', () => {
  let container: HTMLDivElement;

  const openSwitcher = async () => {
    openProjectsView();
    await flush();
  };
  const closeSwitcher = async () => {
    closeProjectsView();
    await flush();
  };

  beforeEach(async () => {
    // jsdom ships no matchMedia, and the hook asks it whether to auto-rotate.
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as never;
    container = document.createElement('div');
    document.body.appendChild(container);
    CURRENT_SOURCE.value = { src: '/tmp/p' };
    SCENE_HANDLE.value = makeHandle() as never;
    SCENE_HANDLE.peek()!.picker.selectByPath(FILE.path);
    openSelectionPane();
    render(<Harness />, container);
    // The hook installs its effect from a useEffect, which Preact defers to a
    // macrotask; a single flush lands before it exists.
    await drainAsync(3, 20);
  });

  afterEach(async () => {
    closeProjectsView();
    render(null, container);
    container.remove();
    SCENE_HANDLE.value = null;
    CURRENT_SOURCE.value = null;
    openSelectionPane();
    await flush();
  });

  it('puts the selection back on dismiss', async () => {
    await openSwitcher();
    expect(SCENE_HANDLE.peek()!.picker.selection.value).toBeNull();

    await closeSwitcher();
    expect(SCENE_HANDLE.peek()!.picker.selection.value).not.toBeNull();
  });

  // The bug: the pane was minimised to its chip, and closing the switcher
  // reopened it over the city.
  it('leaves a minimised pane minimised', async () => {
    dismissSelectionPane();
    await flush();

    await openSwitcher();
    await closeSwitcher();

    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('leaves an open pane open', async () => {
    await openSwitcher();
    await closeSwitcher();

    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });
});
