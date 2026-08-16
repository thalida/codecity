import { describe, it, expect } from 'vitest';
import { computeAlmanac } from '@/views/CityView/panes/InfoPane/almanac';
import { NodeKind } from '@/types';
import type { Manifest, FileNode, DirNode, RepoStats } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';
import { commits as buildCommits } from '../../../../_helpers/commits';
import { fileLeader, uniformFileStats } from '../../../../_helpers/statsFixtures';

function file(partial: Partial<FileNode> & { name: string; path: string }): FileNode {
  return {
    type: NodeKind.File,
    fullPath: `/repo/${partial.path}`,
    extension: '.ts',
    size: 100,
    lines: 10,
    binary: false,
    dirty: false,
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
    descendants_created_min: null,
    descendants_modified_max: null,
    descendants_ext_breakdown: [{ ext: '.ts', count: files, size: 0 }],
  };
}

function manifest(tree: DirNode, overrides: Partial<Manifest> = {}): Manifest {
  return {
    root: '/repo',
    pending: [],
    readmePath: null,
    readmeModified: null,
    scanned_at: '2024-01-01T00:00:00Z',
    content_signature: 's',
    structure_signature: 't',
    layout_signature: 'l',
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

describe('computeAlmanac — buildings + media', () => {
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

  // The leaders this fixture is built to produce: old.ts oldest and smallest,
  // new.ts newest and largest by bytes, tall.ts the tallest.
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
  it('shows an Uncommitted fact when dirtyFileCount > 0', () => {
    const dirty = computeAlmanac(
      manifest(tree, { stats: { ...buildingsStats, dirtyFileCount: 4 } })
    )!;
    const f = dirty.sections
      .find((s) => s.key === 'buildings')!
      .facts.find((f) => f.label === 'Uncommitted');
    expect(f?.primary).toBe('4 files');
    expect(f?.landmark).toBeUndefined();
  });
  it('omits the Uncommitted fact when clean', () => {
    expect(fact('buildings', 'Uncommitted')).toBeUndefined();
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
    // A lone billboard collapses to one row under a "Spotlight" group (no
    // lopsided pair groups) carrying both its byte size and pixel resolution.
    expect(media.facts).toHaveLength(1);
    expect(media.facts[0].group).toBe('Spotlight');
    expect(media.facts[0].label).toBe('Only');
    expect(media.facts[0].landmark).toEqual({ kind: 'file', id: 'pic.png' });
    expect(media.facts[0].secondary).toContain('1,920'); // resolution
    expect(media.facts[0].secondary).toMatch(/KB|B/); // and byte size
    expect(media.facts.every((f) => f.tip)).toBe(true);
  });
  it('pairs media into Size + Resolution duos when there are 2+ distinct files', () => {
    const tree2 = dir('repo', '', [
      file({
        name: 'sm.png',
        path: 'sm.png',
        mediaKind: 'image',
        media_width: 10,
        media_height: 10,
      }),
      file({
        name: 'lg.png',
        path: 'lg.png',
        mediaKind: 'image',
        media_width: 1920,
        media_height: 1080,
      }),
    ]);
    const stats: RepoStats = {
      ...uniformFileStats('code.ts', 40, 400),
      mediaCount: 2,
      maxMediaBytesFile: fileLeader('lg.png', 0, 9000),
      minMediaBytesFile: fileLeader('sm.png', 0, 100),
      maxMediaPixelsFile: {
        ...fileLeader('lg.png', 0, 9000),
        media_width: 1920,
        media_height: 1080,
      },
      minMediaPixelsFile: { ...fileLeader('sm.png', 0, 100), media_width: 10, media_height: 10 },
    };
    const media = computeAlmanac(manifest(tree2, { stats }))!.sections.find(
      (s) => s.key === 'media'
    )!;
    const byLabel = (l: string) => media.facts.find((f) => f.label === l)!;
    expect(byLabel('Smallest').group).toBe('Size');
    expect(byLabel('Largest').group).toBe('Size');
    expect(byLabel('Lowest').group).toBe('Resolution');
    expect(byLabel('Highest').group).toBe('Resolution');
    expect(byLabel('Smallest').landmark).toEqual({ kind: 'file', id: 'sm.png' });
    expect(byLabel('Lowest').landmark).toEqual({ kind: 'file', id: 'sm.png' });
  });
  it('keeps the Billboards section with a note when there is no media', () => {
    const media = a!.sections.find((s) => s.key === 'media')!;
    expect(media.facts).toHaveLength(0);
    expect(media.note).toMatch(/No images or videos/);
  });

  it('excludes binaries from buildings and gives them a Data section with byte leaders', () => {
    const withBinary = dir('repo', '', [
      file({ name: 'code.ts', path: 'code.ts', lines: 40, size: 400 }),
      file({ name: 'small.db', path: 'small.db', lines: 0, size: 800, binary: true }),
      file({ name: 'big.wasm', path: 'big.wasm', lines: 0, size: 50000, binary: true }),
    ]);
    const stats: RepoStats = {
      ...uniformFileStats('code.ts', 40, 400),
      binaryCount: 2,
      minBinaryBytesFile: fileLeader('small.db', 0, 800),
      maxBinaryBytesFile: fileLeader('big.wasm', 0, 50000),
    };
    const m = computeAlmanac(manifest(withBinary, { stats }))!;
    const buildings = m.sections.find((s) => s.key === 'buildings')!;
    const data = m.sections.find((s) => s.key === 'data')!;
    // 3 files − 2 binaries = 1 building; binaries never win a code superlative.
    expect(buildings.facts.every((f) => f.landmark?.id !== 'big.wasm')).toBe(true);
    // Data section: byte Size pair over the binary leaders.
    const byLabel = (l: string) => data.facts.find((f) => f.label === l)!;
    expect(byLabel('Smallest').landmark).toEqual({ kind: 'file', id: 'small.db' });
    expect(byLabel('Largest').landmark).toEqual({ kind: 'file', id: 'big.wasm' });
  });

  it('keeps the Data section with a note when there are no binaries', () => {
    const data = a!.sections.find((s) => s.key === 'data')!;
    expect(data.facts).toHaveLength(0);
    expect(data.note).toMatch(/No binary files/);
  });
});

describe('computeAlmanac — streets, forest, fireflies', () => {
  const deep = dir('deep', 'src/a/b', [file({ name: 'x.ts', path: 'src/a/b/x.ts' })]);
  const src = {
    ...dir('src', 'src', [deep, file({ name: 'm.ts', path: 'src/m.ts' })]),
    descendants_file_count: 5,
  };
  const tree = dir('repo', '', [src as DirNode, file({ name: 'r.ts', path: 'r.ts' })]);

  const commits = buildCommits(
    { date: '2022-01-01', files: 2, sha: 'aaa', authors: ['Ada'], same_day_total: 1 },
    { date: '2022-01-02', files: 40, sha: 'bbb', authors: ['Ada', 'Bo'], same_day_total: 3 },
    { date: '2022-01-03', files: 1, sha: 'ccc', authors: ['Bo'], same_day_total: 3 },
    { date: '2022-02-10', files: 5, sha: 'ddd', authors: ['Ada'], same_day_total: 1 }
  );

  // The leaders this fixture is built to produce: src/a/b deepest and
  // narrowest, src widest, bbb the biggest commit and ccc the smallest.
  const DIR_LEADER_DEEP = {
    path: 'src/a/b',
    depth: 3,
    children: 1,
    descendants: 1,
    created: '2020-01-01T00:00:00Z',
    modified: '2020-02-02T00:00:00Z',
  };
  // Fireflies: Ada (3 commits), Bo (2 commits)
  const sfStats: RepoStats = {
    ...EMPTY_REPO_STATS,
    maxDepthDir: DIR_LEADER_DEEP,
    maxChildrenDir: { ...DIR_LEADER_DEEP, path: 'src', depth: 1, children: 6, descendants: 12 },
    minChildrenDir: DIR_LEADER_DEEP,
    oldestCreatedDir: {
      ...DIR_LEADER_DEEP,
      path: 'src/old',
      created: '2019-03-04T00:00:00Z',
    },
    newestCreatedDir: {
      ...DIR_LEADER_DEEP,
      path: 'src/new',
      created: '2024-08-09T00:00:00Z',
    },
    maxFilesPerCommit: { sha: 'bbb', files: 40, date: '2022-01-02' },
    minFilesPerCommit: { sha: 'ccc', files: 1, date: '2022-01-03' },
    oldestCommit: { sha: 'aaa', files: 2, date: '2022-01-01' },
    newestCommit: { sha: 'ddd', files: 5, date: '2022-02-10' },
    commitCount: 4,
    maxCommitsPerDay: { date: '2022-01-02', count: 3 },
    maxCommitStreakDays: 3,
    authors: [
      { name: 'Ada', commits: 3, hue: 0 },
      { name: 'Bo', commits: 2, hue: 0 },
    ],
  };

  const a = computeAlmanac(manifest(tree, { commits, stats: sfStats }))!;
  const section = (key: string) => a.sections.find((s) => s.key === key)!;
  const fact = (key: string, label: string) => section(key).facts.find((f) => f.label === label)!;

  it('deepest alley = deepest directory, excluding root', () => {
    expect(fact('streets', 'Deepest').landmark).toEqual({
      kind: NodeKind.Directory,
      id: 'src/a/b',
    });
  });
  it('biggest street = most direct children, with its count in the metric', () => {
    const f = fact('streets', 'Biggest');
    expect(f.landmark).toEqual({ kind: NodeKind.Directory, id: 'src' });
    expect(f.secondary).toBe('6 children');
    expect(f.group).toBe('Size');
  });
  it('smallest street = fewest direct children (paired with biggest)', () => {
    const f = fact('streets', 'Smallest');
    expect(f.landmark).toEqual({ kind: NodeKind.Directory, id: 'src/a/b' });
    expect(f.secondary).toBe('1 child');
    expect(f.group).toBe('Size');
  });
  it('grandest canopy = commit touching most files', () => {
    expect(fact('forest', 'Grandest').landmark).toEqual({ kind: 'commit', id: 'bbb' });
  });
  it('sparsest canopy = commit touching fewest files', () => {
    expect(fact('forest', 'Sparsest').landmark).toEqual({ kind: 'commit', id: 'ccc' });
  });
  it('busiest day is non-landmark and names the date', () => {
    const f = fact('forest', 'Busiest');
    expect(f.landmark).toBeUndefined();
    expect(f.secondary).toContain('3');
  });
  // A street's dates come from its subtree, so the leader is the street that
  // holds the file, not each parent that contains it (stats.py breaks the tie).
  it('names the oldest and newest streets with their dates', () => {
    expect(fact('streets', 'Oldest').primary).toBe('src/old');
    expect(fact('streets', 'Oldest').secondary).toContain('2019');
    expect(fact('streets', 'Newest').primary).toBe('src/new');
    expect(fact('streets', 'Newest').secondary).toContain('2024');
  });
  it('drops the street age rows when the scan has no dated directories', () => {
    const b = computeAlmanac(manifest(tree, { commits, stats: EMPTY_REPO_STATS }))!;
    const streets = b.sections.find((s) => s.key === 'streets')!;
    expect(streets.facts.some((f) => f.label === 'Oldest')).toBe(false);
  });

  // The history's ends lead the section and are rows you can visit: the date is
  // what you read, the sha is how the camera gets there.
  it('opens the forest with visitable first and latest commits', () => {
    const forest = section('forest');
    expect(forest.facts[0].label).toBe('First');
    expect(forest.facts[1].label).toBe('Latest');
    expect(forest.facts[0].landmark).toEqual({ kind: 'commit', id: 'aaa' });
    expect(forest.facts[1].landmark).toEqual({ kind: 'commit', id: 'ddd' });
    expect(forest.facts[0].secondary).toBe('aaa');
  });

  it('longest streak counts consecutive days', () => {
    expect(fact('forest', 'Streak').primary).toContain('3');
  });
  it('names the most active contributor', () => {
    expect(fact('fireflies', 'Most active').primary).toContain('Ada');
  });
  it('pairs most + least active contributors when there are 2+ authors', () => {
    expect(fact('fireflies', 'Most active').primary).toContain('Ada'); // 3 commits
    expect(fact('fireflies', 'Least active').primary).toContain('Bo'); // 2 commits
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
