import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { SearchPane } from '@/views/CityView/panes/SearchPane/SearchPane';
import { flush } from '../../../_helpers/preact';
import { NodeKind } from '@/city/types/manifest';

// Only the fields the search pane reads, plus enough extras to pass as a
// FileNode where one is wanted.
const TREE = {
  name: 'project',
  type: NodeKind.Directory,
  path: '.',
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
          extension: '.ts',
          size: 100,
          lines: 10,
          binary: false,
          created: '',
          modified: '',
        },
        {
          name: 'main.ts',
          type: NodeKind.File,
          path: 'src/main.ts',
          extension: '.ts',
          size: 100,
          lines: 10,
          binary: false,
          created: '',
          modified: '',
        },
      ],
    },
    {
      name: 'README.md',
      type: NodeKind.File,
      path: 'README.md',
      extension: '.md',
      size: 100,
      lines: 10,
      binary: false,
      created: '',
      modified: '',
    },
    {
      name: 'logo.png',
      type: NodeKind.File,
      path: 'assets/logo.png',
      extension: '.png',
      size: 100,
      lines: 0,
      binary: true,
      created: '',
      modified: '',
    },
    {
      // The characters of ".png" in order but never contiguous: a fuzzy
      // matcher took this, and a substring one doesn't.
      name: 'parsing.ts',
      type: NodeKind.File,
      path: 'src/parsing.ts',
      extension: '.ts',
      size: 100,
      lines: 10,
      binary: false,
      created: '',
      modified: '',
    },
  ],
};

describe('SearchPane', () => {
  let container: HTMLDivElement;

  function mount(opts: { onSelect?: (p: string) => void } = {}): ReturnType<typeof signal> {
    const manifest = signal<unknown>({ tree: TREE });
    render(
      <SearchPane manifest={manifest as never} onClose={() => {}} onSelect={opts.onSelect} />,
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

    const results = container.querySelectorAll<HTMLButtonElement>('.search-result');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].textContent).toBe('src/coordinator.ts');
    expect(results[0].querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  // Same icon the tree draws, keyed off the same file: the two lists show the
  // same things, so a result is recognisable by the shape the tree taught you.
  it('draws each result with its file icon', async () => {
    mount();
    await typeQuery('coord');

    const icon = container.querySelector<HTMLImageElement>('.search-result .file-icon');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('data-icon-for')).toBe('coordinator.ts');
  });

  it('treats ".png" as a contiguous substring (not per-character fuzzy)', async () => {
    mount();
    await typeQuery('.png');

    const results = container.querySelectorAll<HTMLButtonElement>('.search-result');
    const paths = Array.from(results).map((r) => r.textContent);
    // Only one path contains ".png" as a substring; the other merely has its
    // characters scattered through it.
    expect(paths).toEqual(['assets/logo.png']);
  });

  it('supports whitespace-separated tokens (every token must appear as a substring)', async () => {
    mount();
    await typeQuery('src .ts');

    const paths = Array.from(container.querySelectorAll<HTMLButtonElement>('.search-result')).map(
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

    const results = container.querySelectorAll<HTMLButtonElement>('.search-result');
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

    const first = container.querySelector<HTMLButtonElement>('.search-result')!;
    first.click();
    expect(selected).toBe('src/coordinator.ts');
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
            extension: '.ts',
            size: 100,
            lines: 10,
            binary: false,
            created: '',
            modified: '',
          },
        ],
      },
    };
    await flush();

    const results = container.querySelectorAll<HTMLButtonElement>('.search-result');
    expect(results.length).toBe(1);
    expect(results[0].textContent).toBe('newfile.ts');
  });

  it('arrow keys move focus through the results and back to the input', async () => {
    mount();
    await typeQuery('.ts'); // matches several .ts files
    const input = container.querySelector<HTMLInputElement>('input.search-input')!;
    const buttons = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.search-result'));
    expect(buttons().length).toBeGreaterThan(1);

    const arrow = (key: 'ArrowDown' | 'ArrowUp') =>
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    input.focus();
    arrow('ArrowDown'); // enter the list at the first result
    expect(document.activeElement).toBe(buttons()[0]);
    arrow('ArrowDown'); // next result
    expect(document.activeElement).toBe(buttons()[1]);
    arrow('ArrowUp'); // back up
    expect(document.activeElement).toBe(buttons()[0]);
    arrow('ArrowUp'); // off the top returns to the query field
    expect(document.activeElement).toBe(input);
  });
});
