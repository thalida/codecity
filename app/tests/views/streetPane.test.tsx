import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { StreetPane } from '@/views/StreetPane/StreetPane';
import type { StreetPaneState } from '@/views/StreetPane/StreetPane';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, ExtBreakdownEntry } from '@/types';
import { ROOT_PATH } from '@/constants/manifest';
import { flush } from '../_helpers/preact';

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

// descendants_ext_breakdown is baked by the backend and read verbatim by
// StreetPane, so it is passed as data rather than recomputed here.
function dir(
  name: string,
  children: (FileNode | DirNode)[] = [],
  breakdown: ExtBreakdownEntry[] = []
): DirNode {
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
    descendants_ext_breakdown: breakdown,
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

  it('lists every extension as a ranked row sorted by count desc', async () => {
    mount();
    const d = dir(
      'src',
      [
        f('a.ts', '.ts', 100),
        f('b.ts', '.ts', 100),
        f('c.ts', '.ts', 100),
        f('readme.md', '.md', 50),
        f('config.json', '.json', 30),
      ],
      [
        { ext: '.ts', count: 3, size: 300 },
        { ext: '.md', count: 1, size: 50 },
        { ext: '.json', count: 1, size: 30 },
      ]
    );
    await setDirectory(d);
    const extRows = Array.from(container.querySelectorAll('.street-ext-row')) as HTMLElement[];
    expect(extRows.length).toBeGreaterThanOrEqual(3);
    // First row is the most common extension (.ts: 3 of 5 files → 60% share).
    // The bar's title names the type in full (the badge truncates); the count
    // and share show on the right.
    expect(extRows[0].querySelector('.street-ext-track')!.getAttribute('title')).toBe(
      'TypeScript (.ts)'
    );
    expect(extRows[0].textContent).toContain('3');
    const fill = extRows[0].querySelector('.street-ext-fill') as HTMLElement;
    expect(fill.style.width).toBe('60%');
  });

  it('labels an extensionless file row as "No extension"', async () => {
    mount();
    const d = dir(
      'bin',
      [f('LICENSE', '', 10), f('run.sh', '.sh', 10)],
      [
        { ext: null, count: 1, size: 10 },
        { ext: '.sh', count: 1, size: 10 },
      ]
    );
    await setDirectory(d);
    const titles = Array.from(container.querySelectorAll('.street-ext-track')).map((t) =>
      t.getAttribute('title')
    );
    expect(titles).toContain('No extension');
  });

  it('onFocus callback fires with the active directory when focus button clicked', async () => {
    const onFocus = vi.fn();
    mount({ onFocus });
    const d = dir('lib', [f('x.ts', '.ts', 100)], [{ ext: '.ts', count: 1, size: 100 }]);
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
    await setDirectory(dir('src', [f('a.ts', '.ts', 100)], [{ ext: '.ts', count: 1, size: 100 }]));
    await setDirectory(null);
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.street-ext-row')).toBeNull();
  });

  describe('exclude action', () => {
    function mountWithExclude(directory: DirNode) {
      const onExclude = vi.fn();
      const s = signal<StreetPaneState>({ directory });
      render(<StreetPane state={s} onExclude={onExclude} />, container);
      return {
        onExclude,
        button: container.querySelector<HTMLButtonElement>('button[aria-label*="Exclude"]'),
      };
    }

    it('hands the directory to onExclude', () => {
      const d = dir('vendor');
      const { onExclude, button } = mountWithExclude(d);
      expect(button).not.toBeNull();
      button!.click();
      expect(onExclude).toHaveBeenCalledWith(d);
    });

    // Excluding the root would empty the city. The button stays anyway, inert
    // and carrying the reason: a rule you can read beats a button that silently
    // isn't there.
    it('shows the exclude button inert on the repo root, with the reason', () => {
      const root = dir('repo');
      (root as { path: string }).path = ROOT_PATH;
      const { onExclude, button } = mountWithExclude(root);
      expect(button).not.toBeNull();
      expect(button!.getAttribute('aria-disabled')).toBe('true');
      expect(button!.getAttribute('title')).toContain('root');
      button!.click();
      expect(onExclude).not.toHaveBeenCalled();
    });
  });
});
