import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { RightSidebar } from '@/layout/RightSidebar';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { NodeKind } from '@/types';
import type { FileNode, PickTarget } from '@/types';
import { flush } from '../_helpers/preact';

const FILE_NODE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
  fullPath: '/tmp/project/src/index.ts',
  extension: '.ts',
  size: 1536,
  lines: 50,
  binary: false,
  created: '2024-01-10T09:00:00Z',
  modified: '2024-03-20T10:00:00Z',
};

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
    SCENE_HANDLE.value = makeSceneHandle() as never;
    render(<RightSidebar />, container);
    await flush();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    SCENE_HANDLE.value = null;
  });

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

  it('renders the resize handle on the inside (left) edge', () => {
    const handle = container.querySelector('.sidebar-resize-handle-right');
    expect(handle).not.toBeNull();
  });
});
