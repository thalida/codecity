import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { StreetPane } from '@/views/StreetPane/StreetPane';
import type { StreetPaneState } from '@/views/StreetPane/StreetPane';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, ExtBreakdownEntry } from '@/types';
import { flush } from '../_helpers/preact';

// Mirror the backend's per-dir extension aggregation (api/scan.py) so test
// fixtures carry a realistic descendants_ext_breakdown — StreetPane reads
// that baked field rather than walking the subtree itself.
function _extBreakdown(children: (FileNode | DirNode)[]): ExtBreakdownEntry[] {
  const byExt = new Map<string, { count: number; size: number }>();
  function walk(node: FileNode | DirNode): void {
    if (node.type === NodeKind.File) {
      const ext = (node.extension || '(none)').toLowerCase();
      const cur = byExt.get(ext) || { count: 0, size: 0 };
      cur.count += 1;
      cur.size += node.size || 0;
      byExt.set(ext, cur);
      return;
    }
    for (const c of node.children || []) walk(c);
  }
  for (const c of children) walk(c);
  return Array.from(byExt, ([ext, v]) => ({ ext, ...v })).sort((a, b) => b.count - a.count);
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
    descendants_ext_breakdown: _extBreakdown(children),
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

  it('summary shows descendant totals; meta shows direct structure', async () => {
    mount();
    const d = dir('src', [f('a.ts', '.ts', 100), f('b.md', '.md', 50)]);
    d.descendants_file_count = 4;
    d.descendants_dir_count = 1;
    d.descendants_size = 260;
    d.children = [
      f('a.ts', '.ts', 100),
      f('b.md', '.md', 50),
      dir('sub', [f('c.ts', '.ts', 80), f('d.json', '.json', 30)]),
    ];
    d.children_file_count = 2;
    d.children_dir_count = 1;
    d.descendants_ext_breakdown = _extBreakdown(d.children);

    await setDirectory(d);

    const body = container.querySelector('.street-body') as HTMLElement;
    // Summary line: descendant file total.
    expect(container.querySelector('.street-summary')!.textContent).toMatch(/4\s*files/i);
    // Meta line: direct structure (files + folders here).
    expect(container.querySelector('.street-meta')!.textContent).toMatch(/2\s*files/i);
    expect(container.querySelector('.street-meta')!.textContent).toMatch(/1\s*folder/i);
    expect(body).not.toBeNull();
  });

  it('meta line appends nested folder count when descendants exceed direct dirs', async () => {
    mount();
    const d = dir('src', [f('a.ts', '.ts', 100)]);
    d.children_dir_count = 2;
    d.descendants_dir_count = 5; // deeper than the direct subfolders
    await setDirectory(d);
    const meta = container.querySelector('.street-meta')!.textContent!;
    expect(meta).toMatch(/2\s*folders\s*here/i);
    expect(meta).toMatch(/5\s*nested/i);
  });

  it('lists every extension as a ranked row sorted by count desc', async () => {
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
    // First row is the most common extension (.ts with 3 files), and its bar
    // fill is the full-width reference (100%). The exact ext lives in the row
    // title (the badge truncates); the count shows in the bar.
    expect(extRows[0].getAttribute('title')).toBe('.ts');
    expect(extRows[0].textContent).toContain('3');
    const fill = extRows[0].querySelector('.street-ext-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
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
