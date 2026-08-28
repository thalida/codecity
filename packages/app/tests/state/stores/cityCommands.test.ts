// What each "take me to this node" command does to the CHROME, which is real
// state these assert against. A focus icon promises the city, so those commands
// clear the panel away; a name in a list promises the thing itself, so those
// open it. The camera half is guarded against a real city in builtCity.test.ts.

import { FocusMode, NodeKind, PickTarget } from '@codecity/city';
import type { FocusRef } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import {
  SCENE_HANDLE,
  focusPath,
  focusCommit,
  focusSelection,
  goToPath,
  goToCommit,
} from '@/state/stores/city';
import { SELECTION_PANE_DISMISSED, dismissSelectionPane } from '@/state/stores/chrome';

const FILE_TARGET = {
  kind: NodeKind.File,
  file: { name: 'a.ts', path: 'src/a.ts', type: NodeKind.File },
} as unknown as PickTarget;

const COMMIT_TARGET = {
  kind: NodeKind.Commit,
  commit: { sha: 'abc1234' },
} as unknown as PickTarget;

// A ref that matches nothing, which the city answers false to.
const UNRESOLVED = 'no-such-node';

// Pointing the camera is the CITY's job and is tested against a real one in
// builtCity.test.ts. What this file is about is the other half: what the chrome
// does once the city says whether there was anything to look at. So the city is
// stubbed at its contract — `focus(ref, mode) -> did it land?` — rather than
// having its internals restated here.
function makeHandle() {
  const selection = signal<PickTarget | null>(null);
  const calls: string[] = [];
  return {
    calls,
    selection,
    focus(ref: FocusRef, mode: FocusMode = FocusMode.Overhead): boolean {
      if (ref === null) {
        if (!selection.peek()) return false;
        calls.push(`focus:selection:${mode}`);
        return true;
      }
      const name = 'sha' in ref ? ref.sha : ref.path;
      if (name === UNRESOLVED) {
        calls.push(`miss:${name}`);
        return false;
      }
      selection.value = 'sha' in ref ? COMMIT_TARGET : FILE_TARGET;
      calls.push(`focus:${name}:${mode}`);
      return true;
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
    expect(handle.calls).toEqual(['focus:src/a.ts:overhead']);
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
    expect(handle.calls).toEqual(['focus:src/a.ts:overhead']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('focusCommit does the same for a commit', () => {
    focusCommit('abc1234');
    expect(handle.calls).toEqual(['focus:abc1234:overhead']);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  // What the URL restore asks for: the same commands, framed so the camera
  // keeps the angle it loaded at instead of swinging overhead.
  it('passes a focus mode through to the scene, whichever command carries it', () => {
    goToPath('src/a.ts', FocusMode.Recenter);
    goToCommit('abc1234', FocusMode.Recenter);
    focusSelection(FocusMode.Recenter);

    expect(handle.calls).toEqual([
      'focus:src/a.ts:recenter',
      'focus:abc1234:recenter',
      'focus:selection:recenter', // the live selection, left by goToCommit
    ]);
  });

  // Nothing to look at means nothing happens: the chrome does not move for a
  // node the picker could not resolve.
  it('leaves the camera and the chrome alone for a ref that resolves to nothing', () => {
    goToPath(UNRESOLVED);
    focusPath(UNRESOLVED);
    focusCommit(UNRESOLVED);

    expect(handle.calls).toEqual([
      `miss:${UNRESOLVED}`,
      `miss:${UNRESOLVED}`,
      `miss:${UNRESOLVED}`,
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
