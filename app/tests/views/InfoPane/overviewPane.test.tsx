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

import { OverviewPane, flavorBlurb } from '@/views/InfoPane/OverviewPane';
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
    minCreated: '2020-01-01T00:00:00Z',
    maxCreated: '2020-01-01T00:00:00Z',
    minModified: '2020-01-01T00:00:00Z',
    maxModified: '2020-01-01T00:00:00Z',
  },
  stats: singleFileStats,
};

// Commit leaders for tests that need forest rows.
const commitStats = {
  ...uniformFileStats('a.ts', 3, 10),
  maxFilesPerCommit: { sha: 'abc1234', files: 9 },
  minFilesPerCommit: { sha: 'abc1234', files: 9 },
  maxCommitsPerDay: { date: '2022-01-01', count: 1 },
  maxCommitStreakDays: 1,
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
    expect(container.textContent).toContain('1 building ');

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
    expect(container.textContent).toContain('1 building ');

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
      el.textContent?.includes('Tallest')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    (row as HTMLElement).click();
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
      el.textContent?.includes('Grandest')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    (row as HTMLElement).click();
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
      el.textContent?.includes('Busiest')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    // Non-landmark rows carry no focus button.
    expect(row.querySelector('button')).toBeNull();
  });

  it('renders a flavor blurb (age + dominant language), not raw counts', async () => {
    const sig = signal(manifest);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    const blurb = container.querySelector('.almanac-blurb');
    expect(blurb).toBeTruthy();
    // "An? <age> city of 1 building, mostly TypeScript." — age is live (depends
    // on the clock), so match the shape rather than an exact age.
    expect(blurb!.textContent).toMatch(/^An? .+ city of 1 building, mostly TypeScript\.$/);
    // The old counts-blurb is gone (and with it the "1 fireflies" plural bug).
    expect(container.textContent).not.toContain('sprawls across');
  });

  it('flavorBlurb weaves age + scale + language with a correct article', () => {
    expect(flavorBlurb('8-year-old', 312, 'Python')).toBe(
      'An 8-year-old city of 312 buildings, mostly Python.'
    );
    expect(flavorBlurb('2-year-old', 312, 'Python')).toBe(
      'A 2-year-old city of 312 buildings, mostly Python.'
    );
    expect(flavorBlurb('11-month-old', 5, 'Go')).toBe(
      'An 11-month-old city of 5 buildings, mostly Go.'
    );
    // Singular building, and clauses drop out when their input is absent.
    expect(flavorBlurb('1-year-old', 1, 'CSS')).toBe(
      'A 1-year-old city of 1 building, mostly CSS.'
    );
    expect(flavorBlurb('', 312, 'Python')).toBe('A city of 312 buildings, mostly Python.');
    expect(flavorBlurb('5-day-old', 0, null)).toBe('A 5-day-old city.');
    expect(flavorBlurb('', 0, null)).toBe('');
  });

  it('renders a language composition bar mirroring the legend, each segment titled', async () => {
    const sig = signal(manifest);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    expect(container.querySelector('.almanac-langbar')).toBeTruthy();
    const segs = Array.from(container.querySelectorAll('.almanac-langbar-seg'));
    expect(segs.length).toBeGreaterThan(0);
    // The lone .ts segment is named, counted, and shows its share on hover.
    expect(segs[0].getAttribute('title')).toBe('TypeScript · 1 file (100%)');
  });

  it('the Latest row flies the camera to the head commit and shows the branch chip', async () => {
    const withHead: Manifest = {
      ...manifest,
      repo: { ...manifest.repo, head_sha: 'deadbeefcafe', head_subject: 'Fix the thing' },
      stats: { ...singleFileStats, commitDates: { oldest: '2020-01-01', newest: '2024-03-10' } },
    };
    const sig = signal(withHead);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    expect(container.querySelector('.almanac-branch')?.textContent).toBe('main');
    const latest = container.querySelector('.almanac-latest') as HTMLElement;
    expect(latest).toBeTruthy();
    expect(latest.textContent).toContain('deadbee');
    latest.click();
    expect(selectCommit).toHaveBeenCalledWith('deadbeefcafe');
    expect(focusCommit).toHaveBeenCalledWith('deadbeefcafe');
  });

  it('renders Latest as a static (non-button) row when the Trees layer is off', async () => {
    treesState.ENABLED = false;
    const withHead: Manifest = {
      ...manifest,
      repo: { ...manifest.repo, head_sha: 'deadbeefcafe', head_subject: 'Fix the thing' },
      stats: { ...singleFileStats, commitDates: { oldest: '2020-01-01', newest: '2024-03-10' } },
    };
    const sig = signal(withHead);
    render(<OverviewPane manifest={sig as never} />, container);
    await flush();
    const latest = container.querySelector('.almanac-latest') as HTMLElement;
    expect(latest).toBeTruthy();
    expect(latest.tagName).toBe('DIV'); // not a button — no dead-end click
    expect(latest.textContent).toContain('deadbee');
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
      el.textContent?.includes('Grandest')
    );
    expect(canopyRow).toBeUndefined();
  });
});
