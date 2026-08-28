// A canvas pick decides whether the details show. It owns that call: the pane's
// dismissal used to be cleared by an effect watching the selection, which also
// fired on the picker's own bookkeeping (a backdrop save/restore round trip).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { createInputHandlers } from '@/city/interaction/inputHandlers';
import {
  SELECTION_PANE_DISMISSED,
  dismissSelectionPane,
  openSelectionPane,
} from '@/state/stores/chrome';
import { FileNode, NodeKind } from '@/city/types/manifest';
import { PickTarget } from '@/city/types/picker';
import { createEmitter } from '../../_helpers/cityEvents';
import { fakePicker } from '../../_helpers/cityFixtures';
import { attachCityChrome } from '@/state/stores/city';

const fileNode = (path: string): FileNode => ({
  name: path.split('/').pop()!,
  type: NodeKind.File,
  path,
  extension: '.ts',
  size: 10,
  lines: 2,
  binary: false,
  dirty: false,
  created: '2024-01-01T00:00:00Z',
  modified: '2024-01-02T00:00:00Z',
});

const targetFor = (path: string): PickTarget => ({
  kind: NodeKind.File,
  file: fileNode(path),
  mesh: {} as never,
  data: {} as never,
});

describe('canvas pick → selection pane', () => {
  let canvas: HTMLCanvasElement;
  let handlers: { dispose: () => void };
  let picker: ReturnType<typeof fakePicker> & { pickAt: unknown; interpretHit: unknown };
  // What the next pick resolves to; null stands for a click on empty sky.
  let nextTarget: PickTarget | null = null;
  let events: ReturnType<typeof createEmitter>;
  let chromeOff: () => void;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    // The pane opening is the APP's reaction to a pick, so it is wired here
    // exactly as City.tsx wires it.
    events = createEmitter();
    chromeOff = attachCityChrome(events.on);
    nextTarget = null;
    SELECTION_PANE_DISMISSED.value = false;

    picker = Object.assign(fakePicker(), {
      // The raycast is not what this covers: hand the handler a hit whenever a
      // target is staged, and let it do its own interpret/compare.
      pickAt: () => (nextTarget ? { object: { userData: {} } } : null),
      interpretHit: () => nextTarget,
    });

    handlers = createInputHandlers({
      canvas,
      picker: picker as never,
      rig: {
        controls: { addEventListener() {}, removeEventListener() {} },
        camera: { aspect: 1, updateProjectionMatrix() {} },
      } as never,
      renderer: { setSize() {} } as never,
      cityState: {} as never,
      events,
      onResize() {},
      onResetView() {},
      onFocusSelection() {},
      keyboardEnabled: () => true,
    });
  });

  afterEach(() => {
    chromeOff();
    handlers.dispose();
    canvas.remove();
    SELECTION_PANE_DISMISSED.value = false;
  });

  // A press and release in the same spot, inside the click thresholds.
  const clickCanvas = () => {
    canvas.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    canvas.dispatchEvent(
      new window.PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 })
    );
  };

  const pick = (path: string) => {
    nextTarget = targetFor(path);
    clickCanvas();
  };

  it('selects the picked node', () => {
    pick('src/index.ts');
    expect(picker.selection).not.toBeNull();
  });

  it('reopens a pane put away for the previous node', () => {
    pick('src/index.ts');
    dismissSelectionPane();

    pick('src/other.ts');

    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });

  it('reopens the pane when the node picked is the one already selected', () => {
    pick('src/index.ts');
    dismissSelectionPane();

    pick('src/index.ts');

    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });

  it('reopens the pane for a node picked again after a deselect', () => {
    pick('src/index.ts');
    dismissSelectionPane();

    nextTarget = null; // click on empty sky
    clickCanvas();
    expect(picker.selection).toBeNull();

    pick('src/index.ts');

    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });

  // Nothing to show details for, so a deselect leaves the dismissal alone
  // rather than pretending the pane was reopened.
  it('leaves the pane state alone on a click that selects nothing', () => {
    pick('src/index.ts');
    dismissSelectionPane();

    nextTarget = null;
    clickCanvas();

    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
  });

  it('leaves an already-open pane open', () => {
    openSelectionPane();
    pick('src/index.ts');
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });
});
