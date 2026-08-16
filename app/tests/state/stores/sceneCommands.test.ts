// Two kinds of "take me to this node", split by what the control you clicked
// showed you. A focus icon promises the city, so those commands clear the panel
// out of the way; a name in a list promises the thing itself, so those open the
// details. The commands carry that difference, not their call sites.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { SCENE_HANDLE, focusPath, focusCommit, goToPath } from '@/state/stores/scene';
import { SELECTION_PANE_DISMISSED, dismissSelectionPane } from '@/state/stores/sidebars';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types';

const FILE_TARGET = {
  kind: NodeKind.File,
  file: { name: 'a.ts', path: 'src/a.ts', type: NodeKind.File },
} as unknown as PickTarget;

function makeHandle() {
  const selection = signal<PickTarget | null>(null);
  const calls: string[] = [];
  return {
    calls,
    picker: {
      selection,
      selectByPath(path: string) {
        calls.push(`selectByPath:${path}`);
        selection.value = FILE_TARGET;
      },
      selectByCommit(sha: string) {
        calls.push(`selectByCommit:${sha}`);
      },
    },
    focusByPath(path: string) {
      calls.push(`focusByPath:${path}`);
    },
    rig: {
      focusTree(sha: string) {
        calls.push(`focusTree:${sha}`);
      },
    },
  };
}

describe('scene navigation commands', () => {
  let handle: ReturnType<typeof makeHandle>;

  beforeEach(() => {
    handle = makeHandle();
    SCENE_HANDLE.value = handle as never;
    SELECTION_PANE_DISMISSED.value = false;
  });

  afterEach(() => {
    SCENE_HANDLE.value = null;
    SELECTION_PANE_DISMISSED.value = false;
  });

  it('goToPath selects, moves the camera, and shows the details', () => {
    goToPath('src/a.ts');
    expect(handle.calls).toEqual(['selectByPath:src/a.ts', 'focusByPath:src/a.ts']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });

  // The details are what you asked for by clicking the name, so an earlier
  // dismissal of this same node doesn't get to withhold them.
  it('goToPath reopens details you had put away for that node', () => {
    goToPath('src/a.ts');
    dismissSelectionPane();
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);

    goToPath('src/a.ts');

    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });

  it('focusPath selects, moves the camera, and clears the panel away', () => {
    focusPath('src/a.ts');
    expect(handle.calls).toEqual(['selectByPath:src/a.ts', 'focusByPath:src/a.ts']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('focusCommit does the same for a commit', () => {
    focusCommit('abc1234');
    expect(handle.calls).toEqual(['selectByCommit:abc1234', 'focusTree:abc1234']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('every command no-ops before the scene boots', () => {
    SCENE_HANDLE.value = null;
    goToPath('src/a.ts');
    focusPath('src/a.ts');
    focusCommit('abc1234');
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });
});
