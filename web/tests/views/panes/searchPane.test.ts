import { describe, it, expect, beforeEach } from 'vitest';
import { buildSearchPane } from '@/views/panes/searchPane.js';
import { NodeKind } from '@/types';

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
          git: null,
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
          git: null,
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
      git: null,
    },
  ],
};

describe('buildSearchPane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the empty hint when no query is set', () => {
    const { pane } = buildSearchPane({ tree: TREE });
    document.body.appendChild(pane);
    const state = pane.querySelector('.search-state-title');
    expect(state).not.toBeNull();
    expect(state!.textContent).toContain('Start typing');
  });

  it('lists fuzzy-matched files for a query and wraps matches in <mark>', () => {
    const { pane } = buildSearchPane({ tree: TREE });
    document.body.appendChild(pane);
    const input = pane.querySelector<HTMLInputElement>('.search-input')!;
    input.value = 'coord';
    input.dispatchEvent(new Event('input'));

    const results = pane.querySelectorAll<HTMLLIElement>('.search-result');
    expect(results.length).toBeGreaterThan(0);
    // src/coordinator.ts ranks first because all five chars of "coord"
    // appear contiguously in the filename.
    expect(results[0].textContent).toBe('src/coordinator.ts');
    expect(results[0].querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  it('matches the file extension as part of the path', () => {
    const { pane } = buildSearchPane({ tree: TREE });
    document.body.appendChild(pane);
    const input = pane.querySelector<HTMLInputElement>('.search-input')!;
    input.value = 'readme.md';
    input.dispatchEvent(new Event('input'));

    const results = pane.querySelectorAll<HTMLLIElement>('.search-result');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].textContent).toBe('README.md');
  });

  it('shows "no matches" when nothing fuzzy-matches', () => {
    const { pane } = buildSearchPane({ tree: TREE });
    document.body.appendChild(pane);
    const input = pane.querySelector<HTMLInputElement>('.search-input')!;
    input.value = 'xyzpdq';
    input.dispatchEvent(new Event('input'));

    const state = pane.querySelector('.search-state-title');
    expect(state).not.toBeNull();
    expect(state!.textContent).toContain('No files');
  });

  it('calls onSelect(path) when a result is clicked', () => {
    let selected: string | null = null;
    const { pane } = buildSearchPane(
      { tree: TREE },
      {
        onSelect: (p: string) => {
          selected = p;
        },
      }
    );
    document.body.appendChild(pane);
    const input = pane.querySelector<HTMLInputElement>('.search-input')!;
    input.value = 'coord';
    input.dispatchEvent(new Event('input'));

    const first = pane.querySelector<HTMLLIElement>('.search-result')!;
    first.click();
    expect(selected).toBe('src/coordinator.ts');
  });

  it('re-indexes when setManifest is called', () => {
    const { pane, api } = buildSearchPane({ tree: TREE });
    document.body.appendChild(pane);
    const input = pane.querySelector<HTMLInputElement>('.search-input')!;
    input.value = 'newfile';
    input.dispatchEvent(new Event('input'));
    expect(pane.querySelector('.search-state-title')!.textContent).toContain('No files');

    api.setManifest({
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
            git: null,
          },
        ],
      },
    });

    const results = pane.querySelectorAll<HTMLLIElement>('.search-result');
    expect(results.length).toBe(1);
    expect(results[0].textContent).toBe('newfile.ts');
  });
});
