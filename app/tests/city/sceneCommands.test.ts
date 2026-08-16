// Two kinds of "take me to this node", split by what the control you clicked
// showed you. A focus icon promises the city, so those commands clear the panel
// out of the way; a name in a list promises the thing itself, so those open the
// details. Both take the focus mode: only the framing differs by caller.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import {
  SCENE_HANDLE,
  focusPath,
  focusCommit,
  focusSelection,
  goToPath,
  goToCommit,
} from '@/city/sceneHandle';
import { FocusMode } from '@/city/render/cameraRig';
import { SELECTION_PANE_DISMISSED, dismissSelectionPane } from '@/state/stores/chrome';
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
    focusByPath(path: string, mode: FocusMode = FocusMode.Overhead) {
      calls.push(`focusByPath:${path}:${mode}`);
    },
    rig: {
      focusTree(sha: string, mode: FocusMode = FocusMode.Overhead) {
        calls.push(`focusTree:${sha}:${mode}`);
      },
      focusSelection(_sel: PickTarget, mode: FocusMode = FocusMode.Overhead) {
        calls.push(`focusSelection:${mode}`);
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
    expect(handle.calls).toEqual(['selectByPath:src/a.ts', 'focusByPath:src/a.ts:overhead']);
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
    expect(handle.calls).toEqual(['selectByPath:src/a.ts', 'focusByPath:src/a.ts:overhead']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('focusCommit does the same for a commit', () => {
    focusCommit('abc1234');
    expect(handle.calls).toEqual(['selectByCommit:abc1234', 'focusTree:abc1234:overhead']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  // What the URL restore asks for: the same commands, framed so the camera
  // keeps the angle it loaded at instead of swinging overhead.
  it('passes a focus mode through to the scene, whichever command carries it', () => {
    goToPath('src/a.ts', FocusMode.Recenter);
    goToCommit('abc1234', FocusMode.Recenter);
    focusSelection(FocusMode.Recenter);

    expect(handle.calls).toEqual([
      'selectByPath:src/a.ts',
      'focusByPath:src/a.ts:recenter',
      'selectByCommit:abc1234',
      'focusTree:abc1234:recenter',
      'focusSelection:recenter',
    ]);
  });

  it('every command no-ops before the scene boots', () => {
    SCENE_HANDLE.value = null;
    goToPath('src/a.ts');
    goToCommit('abc1234');
    focusPath('src/a.ts');
    focusCommit('abc1234');
    focusSelection();
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });
});
