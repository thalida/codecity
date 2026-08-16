// What each "take me to this node" command does to the CHROME, which is real
// state these assert against. A focus icon promises the city, so those commands
// clear the panel away; a name in a list promises the thing itself, so those
// open it. The camera half is guarded against a real city in builtCity.test.ts.

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

const COMMIT_TARGET = {
  kind: NodeKind.Commit,
  commit: { sha: 'abc1234' },
} as unknown as PickTarget;

// The picker resolves a ref once and hands back the target; the commands pass
// that target to the rig. UNRESOLVED stands for a ref that matches nothing.
const UNRESOLVED = 'no-such-node';

function makeHandle() {
  const selection = signal<PickTarget | null>(null);
  const calls: string[] = [];
  return {
    calls,
    picker: {
      selection,
      selectByPath(path: string): PickTarget | null {
        calls.push(`selectByPath:${path}`);
        if (path === UNRESOLVED) return null;
        selection.value = FILE_TARGET;
        return FILE_TARGET;
      },
      selectByCommit(sha: string): PickTarget | null {
        calls.push(`selectByCommit:${sha}`);
        if (sha === UNRESOLVED) return null;
        selection.value = COMMIT_TARGET;
        return COMMIT_TARGET;
      },
    },
    rig: {
      focusSelection(sel: PickTarget, mode: FocusMode = FocusMode.Overhead) {
        calls.push(`focusSelection:${sel.kind}:${mode}`);
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
    expect(handle.calls).toEqual(['selectByPath:src/a.ts', 'focusSelection:file:overhead']);
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
    expect(handle.calls).toEqual(['selectByPath:src/a.ts', 'focusSelection:file:overhead']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('focusCommit does the same for a commit', () => {
    focusCommit('abc1234');
    expect(handle.calls).toEqual(['selectByCommit:abc1234', 'focusSelection:commit:overhead']);
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
      'focusSelection:file:recenter',
      'selectByCommit:abc1234',
      'focusSelection:commit:recenter',
      'focusSelection:commit:recenter', // the live selection, left by goToCommit
    ]);
  });

  // Nothing to look at means nothing happens: the chrome does not move for a
  // node the picker could not resolve.
  it('leaves the camera and the chrome alone for a ref that resolves to nothing', () => {
    goToPath(UNRESOLVED);
    focusPath(UNRESOLVED);
    focusCommit(UNRESOLVED);

    expect(handle.calls).toEqual([
      `selectByPath:${UNRESOLVED}`,
      `selectByPath:${UNRESOLVED}`,
      `selectByCommit:${UNRESOLVED}`,
    ]);
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });

  it('focusSelection no-ops when nothing is selected', () => {
    focusSelection();
    expect(handle.calls).toEqual([]);
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
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
