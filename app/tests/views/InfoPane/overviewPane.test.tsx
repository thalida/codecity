import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { flush } from '../../_helpers/preact';

const { selectPath, focusPath, selectCommit, focusCommit } = vi.hoisted(() => ({
  selectPath: vi.fn(),
  focusPath: vi.fn(),
  selectCommit: vi.fn(),
  focusCommit: vi.fn(),
}));
vi.mock('@/state/stores/scene', () => ({ selectPath, focusPath, selectCommit, focusCommit }));

// Mutable stand-in for the TREES settings signal so we can toggle the Trees
// layer per test (OverviewPane gates the Forest section on TREES.value.ENABLED).
const treesState = vi.hoisted(() => ({ ENABLED: true }));
vi.mock('@/state/stores/settings/trees', () => ({
  TREES: {
    get value() {
      return treesState;
    },
  },
}));

import { OverviewPane } from '@/views/InfoPane/OverviewPane';
import { InfoPane } from '@/views/InfoPane/InfoPane';
import { NodeKind } from '@/types';
import type { Manifest } from '@/types';
import { uniformFileStats } from '../../_helpers/statsFixtures';

const tree = {
  name: 'repo',
  type: NodeKind.Directory,
  path: '',
  fullPath: '/repo',
  children: [
    {
      name: 'a.ts',
      type: NodeKind.File,
      path: 'a.ts',
      fullPath: '/repo/a.ts',
      extension: '.ts',
      size: 10,
      lines: 3,
      binary: false,
      created: '2020-01-01T00:00:00Z',
      modified: '2020-01-01T00:00:00Z',
    },
  ],
  children_count: 1,
  children_file_count: 1,
  children_dir_count: 0,
  descendants_count: 1,
  descendants_file_count: 1,
  descendants_dir_count: 0,
  descendants_size: 10,
  descendants_ext_breakdown: [{ ext: '.ts', count: 1, size: 10 }],
};

// Single-file (a.ts): all building superlatives point to a.ts.
const singleFileStats = uniformFileStats('a.ts', 3, 10);

const manifest: Manifest = {
  root: '/repo',
  scanned_at: '2024-01-01T00:00:00Z',
  signature: 's',
  tree_signature: 't',
  tree: tree as unknown as Manifest['tree'],
  repo: { branch: 'main', remote_url: null, head_sha: null, head_subject: null, dirty: false },
  commits: [],
  busyness: { avg: 1, busy: 2 },
  dateRanges: {
    createdMin: '2020-01-01T00:00:00Z',
    createdMax: '2020-01-01T00:00:00Z',
    modifiedMin: '2020-01-01T00:00:00Z',
    modifiedMax: '2020-01-01T00:00:00Z',
  },
  stats: singleFileStats,
};

// Commit leaders for tests that need forest rows.
const commitStats = {
  ...uniformFileStats('a.ts', 3, 10),
  grandestCommit: { sha: 'abc1234', files: 9 },
  sparsestCommit: { sha: 'abc1234', files: 9 },
  busiestDay: { date: '2022-01-01', count: 1 },
  longestStreakDays: 1,
  authors: [{ name: 'Ada', commits: 1 }],
};

describe('OverviewPane', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    selectPath.mockClear();
    focusPath.mockClear();
    selectCommit.mockClear();
    focusCommit.mockClear();
    treesState.ENABLED = true;
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders the empty state when there is no project', async () => {
    const sig = signal(null);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('No project loaded');
  });

  it('updates when the manifest signal changes (live update)', async () => {
    const sig = signal<Manifest | null>(manifest);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('1 buildings');

    sig.value = {
      ...manifest,
      tree: { ...tree, descendants_file_count: 2 } as unknown as Manifest['tree'],
    };
    await flush();
    expect(container.textContent).toContain('2 buildings');
  });

  it('updates through the InfoPane shell when MANIFEST changes (parent does not re-render)', async () => {
    const sig = signal<Manifest | null>(manifest);
    render(<InfoPane manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('1 buildings');

    sig.value = {
      ...manifest,
      tree: { ...tree, descendants_file_count: 2 } as unknown as Manifest['tree'],
    };
    await flush();
    expect(container.textContent).toContain('2 buildings');
  });

  it('clicking a building landmark focus button selects + focuses its file', async () => {
    const sig = signal(manifest);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    const row = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Tallest building')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    row.querySelector('button')!.click();
    expect(selectPath).toHaveBeenCalledWith('a.ts');
    expect(focusPath).toHaveBeenCalledWith('a.ts');
  });

  it('clicking a commit landmark selects + focuses the commit', async () => {
    const withCommits: Manifest = {
      ...manifest,
      commits: [
        {
          date: '2022-01-01',
          files: 9,
          sha: 'abc1234',
          authors: ['Ada'],
          subject: 'x',
          same_day_total: 1,
        },
      ],
      stats: commitStats,
    };
    const sig = signal(withCommits);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    const row = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Grandest canopy')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    row.querySelector('button')!.click();
    expect(selectCommit).toHaveBeenCalledWith('abc1234');
    expect(focusCommit).toHaveBeenCalledWith('abc1234');
  });

  it('renders non-landmark facts as non-button rows', async () => {
    const withCommits: Manifest = {
      ...manifest,
      commits: [
        {
          date: '2022-01-01',
          files: 9,
          sha: 'abc1234',
          authors: ['Ada'],
          subject: 'x',
          same_day_total: 1,
        },
      ],
      stats: commitStats,
    };
    const sig = signal(withCommits);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    const row = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Busiest day')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    // Non-landmark rows carry no focus button.
    expect(row.querySelector('button')).toBeNull();
  });

  it('gates the Forest section when the Trees layer is disabled', async () => {
    treesState.ENABLED = false;
    const withCommits: Manifest = {
      ...manifest,
      commits: [
        {
          date: '2022-01-01',
          files: 9,
          sha: 'abc1234',
          authors: ['Ada'],
          subject: 'x',
          same_day_total: 1,
        },
      ],
      stats: commitStats,
    };
    const sig = signal(withCommits);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    // Section header still shows, but canopy rows are replaced by a note.
    expect(container.textContent).toContain('Forest');
    expect(container.textContent).toContain('Enable the Trees layer');
    const canopyRow = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Grandest canopy')
    );
    expect(canopyRow).toBeUndefined();
  });
});
