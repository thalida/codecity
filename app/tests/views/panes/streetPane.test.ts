import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildStreetPane } from '@/views/panes/streetPane.js';
import { NodeKind } from '@/types';
import type { DirNode, FileNode } from '@/types';

function resetDom() {
  document.body.innerHTML = '';
}

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

describe('buildStreetPane', () => {
  beforeEach(resetDom);

  it('returns a .pane wrapper containing a pane header with title "Road"', () => {
    const { pane } = buildStreetPane({});
    expect(pane.classList.contains('pane')).toBe(true);
    expect(pane.querySelector('.pane-header')).not.toBeNull();
  });

  it('renders an empty state when no directory is set', () => {
    const { pane } = buildStreetPane({});
    expect(pane.querySelector('.empty-state')).not.toBeNull();
  });

  it('setDirectory(d) renders direct + descendant counts', () => {
    const { pane, api } = buildStreetPane({});
    const d = dir('src', [f('a.ts', '.ts', 100), f('b.md', '.md', 50)]);
    d.descendants_file_count = 4;
    d.descendants_dir_count = 1;
    d.children = [
      f('a.ts', '.ts', 100),
      f('b.md', '.md', 50),
      dir('sub', [f('c.ts', '.ts', 80), f('d.json', '.json', 30)]),
    ];

    api.setDirectory(d);

    const body = pane.querySelector('.pane-body, .street-body') as HTMLElement;
    // Direct counts
    expect(body.textContent).toMatch(/2.*files/i);
    expect(body.textContent).toMatch(/1.*dirs?/i);
    // Descendant counts
    expect(body.textContent).toMatch(/4.*files/i);
  });

  it('lists every extension in the descendant subtree sorted by count desc', () => {
    const { pane, api } = buildStreetPane({});
    const d = dir('src', [
      f('a.ts', '.ts', 100),
      f('b.ts', '.ts', 100),
      f('c.ts', '.ts', 100),
      f('readme.md', '.md', 50),
      f('config.json', '.json', 30),
    ]);
    api.setDirectory(d);
    const extRows = Array.from(pane.querySelectorAll('.street-ext-row')) as HTMLElement[];
    expect(extRows.length).toBeGreaterThanOrEqual(3);
    // First row is the most common extension (.ts with 3 files).
    expect(extRows[0].textContent).toContain('.ts');
    expect(extRows[0].textContent).toContain('3');
  });

  it('onFocus callback fires with the active directory when focus button clicked', () => {
    const onFocus = vi.fn();
    const { pane, api } = buildStreetPane({ onFocus });
    const d = dir('lib', [f('x.ts', '.ts', 100)]);
    api.setDirectory(d);
    const btn =
      (pane.querySelector('.pane-header button[aria-label*="Focus"]') as HTMLButtonElement) ??
      (pane.querySelector('.pane-header button') as HTMLButtonElement);
    btn!.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(d);
  });

  it('setDirectory(null) returns to the empty state', () => {
    const { pane, api } = buildStreetPane({});
    api.setDirectory(dir('src', [f('a.ts', '.ts', 100)]));
    api.setDirectory(null);
    expect(pane.querySelector('.empty-state')).not.toBeNull();
    expect(pane.querySelector('.street-ext-row')).toBeNull();
  });
});
