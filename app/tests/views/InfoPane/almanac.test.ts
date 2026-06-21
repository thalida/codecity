import { describe, it, expect } from 'vitest';
import { computeAlmanac } from '@/views/InfoPane/almanac';
import { NodeKind } from '@/types';
import type { Manifest, FileNode, DirNode, RepoStats } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';
import { fileLeader, uniformFileStats } from '../../_helpers/statsFixtures';

function file(partial: Partial<FileNode> & { name: string; path: string }): FileNode {
  return {
    type: NodeKind.File,
    fullPath: `/repo/${partial.path}`,
    extension: '.ts',
    size: 100,
    lines: 10,
    binary: false,
    created: '2020-01-01T00:00:00Z',
    modified: '2020-01-01T00:00:00Z',
    ...partial,
  };
}

function dir(name: string, path: string, children: (FileNode | DirNode)[]): DirNode {
  const files = children.filter((c) => c.type === NodeKind.File).length;
  const dirs = children.filter((c) => c.type === NodeKind.Directory).length;
  return {
    name,
    type: NodeKind.Directory,
    path,
    fullPath: `/repo/${path}`,
    children,
    children_count: children.length,
    children_file_count: files,
    children_dir_count: dirs,
    descendants_count: children.length,
    descendants_file_count: files,
    descendants_dir_count: dirs,
    descendants_size: 0,
    descendants_ext_breakdown: [{ ext: '.ts', count: files, size: 0 }],
  };
}

function manifest(tree: DirNode, overrides: Partial<Manifest> = {}): Manifest {
  return {
    root: '/repo',
    scanned_at: '2024-01-01T00:00:00Z',
    signature: 's',
    tree_signature: 't',
    tree,
    repo: { branch: 'main', remote_url: null, head_sha: null, head_subject: null, dirty: false },
    commits: [],
    busyness: { avg: 1, busy: 2 },
    dateRanges: {
      minCreated: '2020-01-01T00:00:00Z',
      maxCreated: '2023-01-01T00:00:00Z',
      minModified: '2020-01-01T00:00:00Z',
      maxModified: '2023-01-01T00:00:00Z',
    },
    stats: EMPTY_REPO_STATS,
    ...overrides,
  };
}

describe('computeAlmanac — overview + buildings', () => {
  const tree = dir('repo', '', [
    file({
      name: 'old.ts',
      path: 'old.ts',
      lines: 5,
      size: 50,
      created: '2020-01-01T00:00:00Z',
      modified: '2021-06-01T00:00:00Z',
    }),
    file({
      name: 'tall.ts',
      path: 'tall.ts',
      lines: 999,
      size: 80,
      created: '2021-01-01T00:00:00Z',
      modified: '2020-02-01T00:00:00Z',
    }),
    file({
      name: 'new.ts',
      path: 'new.ts',
      lines: 10,
      size: 4000,
      created: '2023-01-01T00:00:00Z',
      modified: '2023-01-01T00:00:00Z',
    }),
  ]);

  // oldestCreatedFile = old.ts (created 2020), newestCreatedFile = new.ts (created 2023)
  // newestModifiedFile = new.ts (modified 2023), oldestModifiedFile = tall.ts (modified 2020-02)
  // maxLinesFile = tall.ts (999 lines), minLinesFile = old.ts (5 lines)
  // maxBytesFile = new.ts (4000 bytes), minBytesFile = old.ts (50 bytes)
  const buildingsStats: RepoStats = {
    ...EMPTY_REPO_STATS,
    oldestCreatedFile: fileLeader('old.ts', 5, 50, '2020-01-01T00:00:00Z', '2021-06-01T00:00:00Z'),
    newestCreatedFile: fileLeader(
      'new.ts',
      10,
      4000,
      '2023-01-01T00:00:00Z',
      '2023-01-01T00:00:00Z'
    ),
    newestModifiedFile: fileLeader(
      'new.ts',
      10,
      4000,
      '2023-01-01T00:00:00Z',
      '2023-01-01T00:00:00Z'
    ),
    oldestModifiedFile: fileLeader(
      'tall.ts',
      999,
      80,
      '2021-01-01T00:00:00Z',
      '2020-02-01T00:00:00Z'
    ),
    maxLinesFile: fileLeader('tall.ts', 999, 80, '2021-01-01T00:00:00Z', '2020-02-01T00:00:00Z'),
    minLinesFile: fileLeader('old.ts', 5, 50, '2020-01-01T00:00:00Z', '2021-06-01T00:00:00Z'),
    maxBytesFile: fileLeader('new.ts', 10, 4000, '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z'),
    minBytesFile: fileLeader('old.ts', 5, 50, '2020-01-01T00:00:00Z', '2021-06-01T00:00:00Z'),
  };

  const a = computeAlmanac(manifest(tree, { stats: buildingsStats }));

  it('returns null for null manifest', () => {
    expect(computeAlmanac(null)).toBeNull();
  });
  it('overview totals come from the root node', () => {
    expect(a!.overview.totals.files).toBe(3);
    expect(a!.overview.totals.dirs).toBe(0);
  });
  it('overview name + branch', () => {
    expect(a!.overview.name).toBe('repo');
    expect(a!.overview.repo.branch).toBe('main');
  });
  it('languages come from root ext breakdown', () => {
    expect(a!.overview.languages[0]).toEqual({ ext: '.ts', count: 3 });
  });

  function fact(key: string, label: string) {
    const section = a!.sections.find((s) => s.key === key)!;
    return section.facts.find((f) => f.label === label)!;
  }

  it('tallest building = most lines, clickable to its file', () => {
    const f = fact('buildings', 'Tallest');
    expect(f.primary).toBe('tall.ts');
    expect(f.secondary).toContain('999');
    expect(f.landmark).toEqual({ kind: 'file', id: 'tall.ts' });
  });
  it('pairs min/max facts under a shared dimension', () => {
    expect(fact('buildings', 'Tallest').group).toBe('Height');
    expect(fact('buildings', 'Shortest').group).toBe('Height');
    expect(fact('buildings', 'Oldest').group).toBe('Age');
  });
  it('date superlatives show a formatted date in the secondary', () => {
    // The dimension (Age / Last touched) carries created-vs-modified, so the
    // metric is the bare formatted date. (TZ-agnostic: just assert the shape.)
    expect(fact('buildings', 'Oldest').secondary).toMatch(/\w{3} \d{1,2}, \d{4}/);
    expect(fact('buildings', 'Freshest').secondary).toMatch(/\w{3} \d{1,2}, \d{4}/);
  });
  it('oldest building = earliest created', () => {
    expect(fact('buildings', 'Oldest').landmark).toEqual({ kind: 'file', id: 'old.ts' });
  });
  it('newest building = latest created', () => {
    expect(fact('buildings', 'Newest').landmark).toEqual({ kind: 'file', id: 'new.ts' });
  });
  it('widest building = largest bytes', () => {
    expect(fact('buildings', 'Widest').landmark).toEqual({ kind: 'file', id: 'new.ts' });
  });
  it('shortest building = fewest lines', () => {
    expect(fact('buildings', 'Shortest').landmark).toEqual({ kind: 'file', id: 'old.ts' });
  });
  it('narrowest building = smallest bytes', () => {
    expect(fact('buildings', 'Narrowest').landmark).toEqual({
      kind: 'file',
      id: 'old.ts',
    });
  });
  it('freshest building = most recently modified', () => {
    expect(fact('buildings', 'Freshest').landmark).toEqual({ kind: 'file', id: 'new.ts' });
  });
  it('stalest building = longest since modified', () => {
    expect(fact('buildings', 'Stalest').landmark).toEqual({ kind: 'file', id: 'tall.ts' });
  });
  it('splits media into its own Billboards section', () => {
    const withMedia = dir('repo', '', [
      file({ name: 'code.ts', path: 'code.ts', lines: 40, size: 400 }),
      file({
        name: 'pic.png',
        path: 'pic.png',
        lines: 0,
        size: 9000,
        mediaKind: 'image',
        media_width: 1920,
        media_height: 1080,
      }),
    ]);
    // Buildings: all leaders = code.ts (media excluded from building leaders).
    // Media: maxMediaBytesFile = pic.png, maxMediaPixelsFile = pic.png @ 1920×1080.
    const mediaStats: RepoStats = {
      ...uniformFileStats('code.ts', 40, 400),
      mediaCount: 1,
      maxMediaBytesFile: fileLeader('pic.png', 0, 9000),
      maxMediaPixelsFile: {
        ...fileLeader('pic.png', 0, 9000),
        media_width: 1920,
        media_height: 1080,
      },
    };
    const m = computeAlmanac(manifest(withMedia, { stats: mediaStats }))!;
    const buildings = m.sections.find((s) => s.key === 'buildings')!;
    const media = m.sections.find((s) => s.key === 'media')!;
    // Media never appears as a building superlative (not even Widest by bytes).
    expect(buildings.facts.every((f) => f.landmark?.id !== 'pic.png')).toBe(true);
    expect(buildings.facts.find((f) => f.label === 'Widest')!.landmark).toEqual({
      kind: 'file',
      id: 'code.ts',
    });
    // It's the largest, highest-resolution billboard instead.
    expect(media.facts.find((f) => f.label === 'Largest billboard')!.landmark).toEqual({
      kind: 'file',
      id: 'pic.png',
    });
    expect(media.facts.find((f) => f.label === 'Highest resolution')!.secondary).toContain('1,920');
    expect(media.facts.every((f) => f.tip)).toBe(true);
  });
  it('keeps the Billboards section with a note when there is no media', () => {
    const media = a!.sections.find((s) => s.key === 'media')!;
    expect(media.facts).toHaveLength(0);
    expect(media.note).toMatch(/No images or videos/);
  });
});

describe('computeAlmanac — streets, forest, fireflies', () => {
  const deep = dir('deep', 'src/a/b', [file({ name: 'x.ts', path: 'src/a/b/x.ts' })]);
  const src = {
    ...dir('src', 'src', [deep, file({ name: 'm.ts', path: 'src/m.ts' })]),
    descendants_file_count: 5,
  };
  const tree = dir('repo', '', [src as DirNode, file({ name: 'r.ts', path: 'r.ts' })]);

  const commits = [
    { date: '2022-01-01', files: 2, sha: 'aaa', authors: ['Ada'], subject: 'a', same_day_total: 1 },
    {
      date: '2022-01-02',
      files: 40,
      sha: 'bbb',
      authors: ['Ada', 'Bo'],
      subject: 'b',
      same_day_total: 3,
    },
    { date: '2022-01-03', files: 1, sha: 'ccc', authors: ['Bo'], subject: 'c', same_day_total: 3 },
    { date: '2022-02-10', files: 5, sha: 'ddd', authors: ['Ada'], subject: 'd', same_day_total: 1 },
  ];

  // Streets: maxDepthDir = src/a/b (3 levels), maxFilesPerDir = src (5 files)
  // Forest: maxFilesPerCommit = bbb (40 files), minFilesPerCommit = ccc (1 file)
  //         maxCommitsPerDay = 2022-01-02 (3 commits), maxCommitStreakDays = 3
  // Fireflies: Ada (3 commits), Bo (2 commits)
  const sfStats: RepoStats = {
    ...EMPTY_REPO_STATS,
    maxDepthDir: { path: 'src/a/b', depth: 3, file_count: 1 },
    maxFilesPerDir: { path: 'src', depth: 1, file_count: 5 },
    maxFilesPerCommit: { sha: 'bbb', files: 40 },
    minFilesPerCommit: { sha: 'ccc', files: 1 },
    maxCommitsPerDay: { date: '2022-01-02', count: 3 },
    maxCommitStreakDays: 3,
    authors: [
      { name: 'Ada', commits: 3 },
      { name: 'Bo', commits: 2 },
    ],
  };

  const a = computeAlmanac(manifest(tree, { commits, stats: sfStats }))!;
  const section = (key: string) => a.sections.find((s) => s.key === key)!;
  const fact = (key: string, label: string) => section(key).facts.find((f) => f.label === label)!;

  it('deepest alley = deepest directory, excluding root', () => {
    expect(fact('streets', 'Deepest alley').landmark).toEqual({
      kind: NodeKind.Directory,
      id: 'src/a/b',
    });
  });
  it('biggest neighborhood = max descendant files, excluding root', () => {
    expect(fact('streets', 'Biggest neighborhood').landmark).toEqual({
      kind: NodeKind.Directory,
      id: 'src',
    });
  });
  it('grandest canopy = commit touching most files', () => {
    expect(fact('forest', 'Grandest').landmark).toEqual({ kind: 'commit', id: 'bbb' });
  });
  it('sparsest canopy = commit touching fewest files', () => {
    expect(fact('forest', 'Sparsest').landmark).toEqual({ kind: 'commit', id: 'ccc' });
  });
  it('busiest day is non-landmark and names the date', () => {
    const f = fact('forest', 'Busiest day');
    expect(f.landmark).toBeUndefined();
    expect(f.secondary).toContain('3');
  });
  it('longest streak counts consecutive days', () => {
    expect(fact('forest', 'Longest streak').primary).toContain('3');
  });
  it('fireflies count distinct authors and name the most prolific', () => {
    expect(fact('fireflies', 'Fireflies').primary).toContain('2');
    expect(fact('fireflies', 'Most prolific author').primary).toContain('Ada');
  });
  it('attaches a tooltip to every fact', () => {
    for (const s of a.sections)
      for (const f of s.facts) expect(f.tip, `${s.key}/${f.label}`).toBeTruthy();
  });
  it('keeps forest + fireflies sections with an empty-state note when there are no commits', () => {
    const b = computeAlmanac(manifest(tree, { commits: [], stats: EMPTY_REPO_STATS }))!;
    const forest = b.sections.find((s) => s.key === 'forest')!;
    const fireflies = b.sections.find((s) => s.key === 'fireflies')!;
    expect(forest.facts).toHaveLength(0);
    expect(forest.note).toMatch(/No commits/);
    expect(fireflies.facts).toHaveLength(0);
    expect(fireflies.note).toMatch(/No commits/);
  });
  it('keeps the streets section with a note when there are no subdirectories', () => {
    const flatTree = dir('repo', '', [file({ name: 'a.ts', path: 'a.ts' })]);
    const b = computeAlmanac(manifest(flatTree, { commits, stats: EMPTY_REPO_STATS }))!;
    const streets = b.sections.find((s) => s.key === 'streets')!;
    expect(streets.facts).toHaveLength(0);
    expect(streets.note).toBeTruthy();
  });
  it('gates the forest section behind the Trees layer', () => {
    const b = computeAlmanac(manifest(tree, { commits, stats: sfStats }), false)!;
    const forest = b.sections.find((s) => s.key === 'forest')!;
    expect(forest.facts).toHaveLength(0);
    expect(forest.note).toMatch(/Trees layer/);
  });
});
