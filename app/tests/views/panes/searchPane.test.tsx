import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { SearchPane } from '@/views/panes/SearchPane';
import { NodeKind } from '@/types';

// Preact schedules signal-driven re-renders on the microtask queue.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Minimal manifest fixture — fields that the search pane reads:
// tree.children[].path, .name, .type. Extras carried so it parses as a
// FileNode-shaped object where needed.
const TREE = {
  name: 'project',
  type: NodeKind.Directory,
  path: '',
  children: [
    {
      name: 'src',
      type: NodeKind.Directory,
      path: 'src',
      children: [
        {
          name: 'coordinator.ts',
          type: NodeKind.File,
          path: 'src/coordinator.ts',
          fullPath: '/tmp/p/src/coordinator.ts',
          extension: '.ts',
          size: 100,
          lines: 10,
          binary: false,
          created: '',
          modified: '',
          git: { created: null, modified: null },
        },
        {
          name: 'main.ts',
          type: NodeKind.File,
          path: 'src/main.ts',
          fullPath: '/tmp/p/src/main.ts',
          extension: '.ts',
          size: 100,
          lines: 10,
          binary: false,
          created: '',
          modified: '',
          git: { created: null, modified: null },
        },
      ],
    },
    {
      name: 'README.md',
      type: NodeKind.File,
      path: 'README.md',
      fullPath: '/tmp/p/README.md',
      extension: '.md',
      size: 100,
      lines: 10,
      binary: false,
      created: '',
      modified: '',
      git: { created: null, modified: null },
    },
    {
      name: 'logo.png',
      type: NodeKind.File,
      path: 'assets/logo.png',
      fullPath: '/tmp/p/assets/logo.png',
      extension: '.png',
      size: 100,
      lines: 0,
      binary: true,
      created: '',
      modified: '',
      git: { created: null, modified: null },
    },
    {
      // Has '.', 'p', 'n', 'g' chars in order but no contiguous ".png":
      // old fuzzy matcher would have matched this when typing ".png";
      // the new token-substring matcher excludes it.
      name: 'parsing.ts',
      type: NodeKind.File,
      path: 'src/parsing.ts',
      fullPath: '/tmp/p/src/parsing.ts',
      extension: '.ts',
      size: 100,
      lines: 10,
      binary: false,
      created: '',
      modified: '',
      git: { created: null, modified: null },
    },
  ],
};

describe('SearchPane', () => {
  let container: HTMLDivElement;

  function mount(
    opts: { onSelect?: (p: string) => void; onFocus?: (p: string) => void } = {}
  ): ReturnType<typeof signal> {
    const manifest = signal<unknown>({ tree: TREE });
    render(
      <SearchPane
        manifest={manifest as never}
        onClose={() => {}}
        onSelect={opts.onSelect}
        onFocus={opts.onFocus}
      />,
      container
    );
    return manifest;
  }

  async function typeQuery(value: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input.search-input')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
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

  it('renders the empty hint when no query is set', () => {
    mount();
    const state = container.querySelector('.text-card-title');
    expect(state).not.toBeNull();
    expect(state!.textContent).toContain('Start typing');
  });

  it('lists substring-matched files for a query and wraps matches in <mark>', async () => {
    mount();
    await typeQuery('coord');

    const results = container.querySelectorAll<HTMLLIElement>('.search-result');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].textContent).toBe('src/coordinator.ts');
    expect(results[0].querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  it('treats ".png" as a contiguous substring (not per-character fuzzy)', async () => {
    mount();
    await typeQuery('.png');

    const results = container.querySelectorAll<HTMLLIElement>('.search-result');
    const paths = Array.from(results).map((r) => r.textContent);
    // Only assets/logo.png contains ".png" as a substring. parsing.ts
    // contains '.', 'p', 'n', 'g' characters but never the contiguous
    // ".png" → excluded.
    expect(paths).toEqual(['assets/logo.png']);
  });

  it('supports whitespace-separated tokens (every token must appear as a substring)', async () => {
    mount();
    await typeQuery('src .ts');

    const paths = Array.from(container.querySelectorAll<HTMLLIElement>('.search-result')).map(
      (r) => r.textContent
    );
    expect(paths).toContain('src/coordinator.ts');
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/parsing.ts');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('assets/logo.png');
  });

  it('matches the file extension as part of the path', async () => {
    mount();
    await typeQuery('readme.md');

    const results = container.querySelectorAll<HTMLLIElement>('.search-result');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].textContent).toBe('README.md');
  });

  it('shows "no matches" when nothing fuzzy-matches', async () => {
    mount();
    await typeQuery('xyzpdq');

    const state = container.querySelector('.text-card-title');
    expect(state).not.toBeNull();
    expect(state!.textContent).toContain('No files');
  });

  it('calls onSelect(path) when a result is single-clicked', async () => {
    let selected: string | null = null;
    mount({
      onSelect: (p: string) => {
        selected = p;
      },
    });
    await typeQuery('coord');

    const first = container.querySelector<HTMLLIElement>('.search-result')!;
    first.click();
    expect(selected).toBe('src/coordinator.ts');
  });

  it('calls onFocus(path) when a result is double-clicked', async () => {
    let focused: string | null = null;
    mount({
      onFocus: (p: string) => {
        focused = p;
      },
    });
    await typeQuery('coord');

    const first = container.querySelector<HTMLLIElement>('.search-result')!;
    first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(focused).toBe('src/coordinator.ts');
  });

  it('re-indexes when the manifest signal changes', async () => {
    const manifest = mount();
    await typeQuery('newfile');
    expect(container.querySelector('.text-card-title')!.textContent).toContain('No files');

    manifest.value = {
      tree: {
        ...TREE,
        children: [
          ...TREE.children,
          {
            name: 'newfile.ts',
            type: NodeKind.File,
            path: 'newfile.ts',
            fullPath: '/tmp/p/newfile.ts',
            extension: '.ts',
            size: 100,
            lines: 10,
            binary: false,
            created: '',
            modified: '',
            git: { created: null, modified: null },
          },
        ],
      },
    };
    await flush();

    const results = container.querySelectorAll<HTMLLIElement>('.search-result');
    expect(results.length).toBe(1);
    expect(results[0].textContent).toBe('newfile.ts');
  });
});
