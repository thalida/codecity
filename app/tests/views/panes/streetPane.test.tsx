import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { StreetPane } from '@/views/panes/StreetPane';
import type { StreetPaneState } from '@/views/panes/StreetPane';
import { NodeKind } from '@/types';
import type { DirNode, FileNode } from '@/types';
import { flush } from '../../_helpers/preact';

function f(name: string, ext: string, size: number, lines = 0): FileNode {
  return {
    name,
    type: NodeKind.File,
    path: `src/${name}`,
    fullPath: `/tmp/src/${name}`,
    extension: ext,
    size,
    lines,
    binary: false,
    created: null,
    modified: null,
    git: null,
  } as unknown as FileNode;
}

function dir(name: string, children: (FileNode | DirNode)[] = []): DirNode {
  return {
    name,
    type: NodeKind.Directory,
    path: name === '.' ? '.' : name,
    fullPath: `/tmp/${name}`,
    children,
    children_file_count: children.filter((c) => c.type === NodeKind.File).length,
    children_dir_count: children.filter((c) => c.type === NodeKind.Directory).length,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
  } as unknown as DirNode;
}

describe('StreetPane', () => {
  let container: HTMLDivElement;
  let state: ReturnType<typeof signal<StreetPaneState>>;

  function mount(opts: { onFocus?: (d: DirNode) => void } = {}): void {
    state = signal<StreetPaneState>({ directory: null });
    render(<StreetPane state={state} onClose={() => {}} onFocus={opts.onFocus} />, container);
  }

  async function setDirectory(d: DirNode | null): Promise<void> {
    state.value = { directory: d };
    await flush();
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders a .pane wrapper containing a pane header with title "Road"', () => {
    mount();
    const pane = container.querySelector('.pane');
    expect(pane).not.toBeNull();
    expect(container.querySelector('.pane-header')).not.toBeNull();
    expect(container.querySelector('.text-pane-title')!.textContent).toContain('Road');
  });

  it('renders an empty state when no directory is set', () => {
    mount();
    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('setDirectory(d) renders direct + descendant counts', async () => {
    mount();
    const d = dir('src', [f('a.ts', '.ts', 100), f('b.md', '.md', 50)]);
    d.descendants_file_count = 4;
    d.descendants_dir_count = 1;
    d.children = [
      f('a.ts', '.ts', 100),
      f('b.md', '.md', 50),
      dir('sub', [f('c.ts', '.ts', 80), f('d.json', '.json', 30)]),
    ];

    await setDirectory(d);

    const body = container.querySelector('.pane-body, .street-body') as HTMLElement;
    // Direct counts
    expect(body.textContent).toMatch(/2.*files/i);
    expect(body.textContent).toMatch(/1.*dirs?/i);
    // Descendant counts
    expect(body.textContent).toMatch(/4.*files/i);
  });

  it('lists every extension in the descendant subtree sorted by count desc', async () => {
    mount();
    const d = dir('src', [
      f('a.ts', '.ts', 100),
      f('b.ts', '.ts', 100),
      f('c.ts', '.ts', 100),
      f('readme.md', '.md', 50),
      f('config.json', '.json', 30),
    ]);
    await setDirectory(d);
    const extRows = Array.from(container.querySelectorAll('.street-ext-row')) as HTMLElement[];
    expect(extRows.length).toBeGreaterThanOrEqual(3);
    // First row is the most common extension (.ts with 3 files).
    expect(extRows[0].textContent).toContain('.ts');
    expect(extRows[0].textContent).toContain('3');
  });

  it('onFocus callback fires with the active directory when focus button clicked', async () => {
    const onFocus = vi.fn();
    mount({ onFocus });
    const d = dir('lib', [f('x.ts', '.ts', 100)]);
    await setDirectory(d);
    const btn =
      (container.querySelector('.pane-header button[aria-label*="Focus"]') as HTMLButtonElement) ??
      (container.querySelector('.pane-header button') as HTMLButtonElement);
    btn!.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(d);
  });

  it('setDirectory(null) returns to the empty state', async () => {
    mount();
    await setDirectory(dir('src', [f('a.ts', '.ts', 100)]));
    await setDirectory(null);
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.street-ext-row')).toBeNull();
  });
});
