import { Manifest, NodeKind } from '@codecity/city';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { flush } from '../../../../_helpers/preact';

// The row wears a focus icon, so it behaves like every other focus control:
// one command that selects, takes the camera there, and clears the panel away.
const { focusPath, focusCommit } = vi.hoisted(() => ({
  focusPath: vi.fn(),
  focusCommit: vi.fn(),
}));
vi.mock('@/state/stores/city', () => ({ focusPath, focusCommit }));

// Mutable stand-in for the TREES settings signal so we can toggle the Trees
// layer per test (OverviewTab gates the Forest section on TREES.value.ENABLED).
const treesState = vi.hoisted(() => ({ ENABLED: true }));
vi.mock('@/state/settings/cityStores', () => ({
  CITY_STORES: {
    TREES: {
      get value() {
        return treesState;
      },
    },
  },
}));

import { OverviewTab } from '@/views/CityView/panes/InfoPane/tabs/OverviewTab/OverviewTab';
import { InfoPane } from '@/views/CityView/panes/InfoPane/InfoPane';
import { commits as buildCommits } from '@codecity/city/testing';
import { uniformFileStats } from '@codecity/city/testing';

const tree = {
  name: 'repo',
  type: NodeKind.Directory,
  path: '.',
  children: [
    {
      name: 'a.ts',
      type: NodeKind.File,
      path: 'a.ts',
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
  src: '/repo',
  branch: null,
  scanned_at: '2024-01-01T00:00:00Z',
  content_signature: 's',
  structure_signature: 't',
  layout_signature: 'l',
  pending: [],
  readmePath: null,
  readmeModified: null,
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
  maxFilesPerCommit: { sha: 'abc1234', files: 9, date: '2022-01-01' },
  minFilesPerCommit: { sha: 'abc1234', files: 9, date: '2022-01-01' },
  oldestCommit: { sha: 'abc1234', files: 9, date: '2022-01-01' },
  newestCommit: { sha: 'abc1234', files: 9, date: '2022-01-01' },
  maxCommitsPerDay: { date: '2022-01-01', count: 1 },
  maxCommitStreakDays: 1,
  authors: [{ name: 'Ada', commits: 1, hue: 0 }],
};

describe('OverviewTab', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    focusPath.mockClear();
    focusCommit.mockClear();
    treesState.ENABLED = true;
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders the empty state when there is no project', async () => {
    const sig = signal(null);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('No project loaded');
  });

  // The pane opens straight into its first section. The Legend guards the same
  // copy, and two of the Overview's empty-state notes had em-dashes.
  it('keeps all visible copy free of em-dashes (house style: colons/commas)', async () => {
    const sig = signal(manifest);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).not.toContain('—');
  });

  it('opens with a section, not a preamble', async () => {
    const sig = signal(manifest);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    expect(container.querySelector('.almanac-intro')).toBeNull();
    expect(container.querySelector('.almanac-name')).toBeNull();
    expect(container.querySelector('.almanac-meta')).toBeNull();
    expect(container.querySelector('.almanac > .almanac-section')).toBeTruthy();
  });

  it('updates when the manifest signal changes (live update)', async () => {
    const sig = signal<Manifest | null>(manifest);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('a.ts');

    // A fresh scan whose superlatives land on a different file: the facts
    // themselves re-derive, so the rows name the new winner.
    sig.value = { ...manifest, stats: uniformFileStats('b.ts', 9, 90) };
    await flush();
    expect(container.textContent).toContain('b.ts');
    expect(container.textContent).not.toContain('a.ts');
  });

  it('updates through the InfoPane shell when MANIFEST changes (parent does not re-render)', async () => {
    const sig = signal<Manifest | null>(manifest);
    render(<InfoPane manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('a.ts');

    // A fresh scan whose superlatives land on a different file: the facts
    // themselves re-derive, so the rows name the new winner.
    sig.value = { ...manifest, stats: uniformFileStats('b.ts', 9, 90) };
    await flush();
    expect(container.textContent).toContain('b.ts');
    expect(container.textContent).not.toContain('a.ts');
  });

  it('clicking a building landmark focuses its file', async () => {
    const sig = signal(manifest);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    const row = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Tallest')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    (row as HTMLElement).click();
    expect(focusPath).toHaveBeenCalledWith('a.ts');
  });

  it('clicking a commit landmark focuses the commit', async () => {
    const withCommits: Manifest = {
      ...manifest,
      commits: [
        buildCommits({ date: '2022-01-01', files: 9, sha: 'abc1234', authors: ['Ada'] })[0],
      ],
      stats: commitStats,
    };
    const sig = signal(withCommits);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    const row = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Grandest')
    ) as HTMLElement;
    expect(row).toBeTruthy();
    (row as HTMLElement).click();
    expect(focusCommit).toHaveBeenCalledWith('abc1234');
  });

  it('renders non-landmark facts as non-button rows', async () => {
    const withCommits: Manifest = {
      ...manifest,
      commits: [
        buildCommits({ date: '2022-01-01', files: 9, sha: 'abc1234', authors: ['Ada'] })[0],
      ],
      stats: commitStats,
    };
    const sig = signal(withCommits);
    render(<OverviewTab manifest={sig as never} />, container);
    await flush();
    const row = Array.from(container.querySelectorAll('.almanac-fact')).find((el) =>
      el.textContent?.includes('Busiest')
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
        buildCommits({ date: '2022-01-01', files: 9, sha: 'abc1234', authors: ['Ada'] })[0],
      ],
      stats: commitStats,
    };
    const sig = signal(withCommits);
    render(<OverviewTab manifest={sig as never} />, container);
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

describe('InfoPane shell', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const tabByLabel = (label: string) =>
    Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent === label
    ) as HTMLButtonElement;

  it('opens on Overview and switches to Legend on click', async () => {
    render(<InfoPane manifest={signal(null) as never} />, container);
    await flush();
    expect(tabByLabel('Overview').getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Legend').getAttribute('aria-selected')).toBe('false');

    tabByLabel('Legend').click();
    await flush();
    expect(tabByLabel('Legend').getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Overview').getAttribute('aria-selected')).toBe('false');
  });
});
