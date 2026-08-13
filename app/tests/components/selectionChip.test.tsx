// The chip is the only thing on screen that says something is selected once its
// pane is closed, and the only pointer-reachable way to clear one.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { SelectionChip } from '@/components/SelectionChip/SelectionChip';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { SELECTION_PANE_DISMISSED, dismissSelectionPane } from '@/state/stores/ui';
import { NodeKind } from '@/types';
import type { FileNode, PickTarget } from '@/types';
import { flush } from '../_helpers/preact';

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

function makeHandle() {
  const selection = signal<PickTarget | null>(null);
  return {
    picker: {
      selection,
      clearSelection() {
        selection.value = null;
      },
    },
  };
}

describe('SelectionChip', () => {
  let container: HTMLDivElement;
  const chip = () => container.querySelector('.selection-chip');

  const select = async () => {
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeHandle>;
    handle.picker.selection.value = {
      kind: NodeKind.File,
      file: FILE,
      mesh: {} as never,
      data: {} as never,
    };
    await flush();
  };
  const dismiss = async () => {
    dismissSelectionPane();
    await flush();
  };

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SELECTION_PANE_DISMISSED.value = false;
    SCENE_HANDLE.value = makeHandle() as never;
    render(<SelectionChip />, container);
    await flush();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    SCENE_HANDLE.value = null;
    SELECTION_PANE_DISMISSED.value = false;
  });

  it('stays out of the way with nothing selected', () => {
    expect(chip()).toBeNull();
  });

  it('stays out of the way while the pane is showing the same node', async () => {
    await select();
    expect(chip()).toBeNull();
  });

  it('appears once that selection’s pane is dismissed', async () => {
    await select();
    await dismiss();
    expect(chip()).not.toBeNull();
    expect(chip()!.textContent).toContain('index.ts');
  });

  // The chip stands in for a closed pane, so it carries the same file/dir badge
  // that pane's header would have.
  it('carries the extension badge for a file', async () => {
    await select();
    await dismiss();

    const badge = chip()!.querySelector('.path-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('ts');
    expect(badge!.classList.contains('is-dir')).toBe(false);
  });

  it('carries the dir badge for a directory', async () => {
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeHandle>;
    handle.picker.selection.value = {
      kind: NodeKind.Directory,
      dir: { name: 'styles', type: NodeKind.Directory, path: 'src/styles' } as never,
      sidewalk: {} as never,
      street: {} as never,
    };
    await flush();
    await dismiss();

    const badge = chip()!.querySelector('.path-badge');
    expect(badge!.textContent).toBe('dir');
    expect(badge!.classList.contains('is-dir')).toBe(true);
    expect(chip()!.textContent).toContain('styles');
  });

  it('leaves a commit unbadged, like its pane', async () => {
    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeHandle>;
    handle.picker.selection.value = {
      kind: NodeKind.Commit,
      commit: { sha: 'abc1234def5678' } as never,
      mesh: {} as never,
      instanceId: 0,
    };
    await flush();
    await dismiss();

    expect(chip()!.querySelector('.path-badge')).toBeNull();
    expect(chip()!.textContent).toContain('abc1234');
  });

  it('clears the selection from its ✕', async () => {
    await select();
    await dismiss();

    act(() => container.querySelector<HTMLButtonElement>('.selection-chip-clear')!.click());
    await flush();

    const handle = SCENE_HANDLE.peek() as unknown as ReturnType<typeof makeHandle>;
    expect(handle.picker.selection.value).toBeNull();
    expect(chip()).toBeNull();
  });

  it('reopens the pane from its label, and stands down when it does', async () => {
    await select();
    await dismiss();

    act(() => container.querySelector<HTMLButtonElement>('.selection-chip-label')!.click());
    await flush();

    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
    expect(chip()).toBeNull();
  });
});
