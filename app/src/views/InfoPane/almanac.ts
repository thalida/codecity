// views/InfoPane/almanac.ts — pure derivation of the "World Almanac":
// repo superlatives (oldest/tallest building, ...) computed from data already
// loaded client-side. No signals, no DOM.
// Landmark facts carry the key needed to fly the camera there.

import { NodeKind } from '@/types';
import type { Manifest, DirNode, FileNode, RepoInfo, TreeNode } from '@/types';
import { formatShortDate } from '@/utils/dates';
import { formatBytes } from '@/utils/bytes';

export interface LandmarkRef {
  kind: 'file' | 'dir' | 'commit';
  /** file/dir → path; commit → sha. */
  id: string;
}

export interface AlmanacFact {
  label: string;
  /** Headline value — a path, sha, name, date, or count. Truncates when long. */
  primary: string;
  /** Muted metric shown beside the primary (e.g. "1,843 lines", "Created Apr 18, 2026"). */
  secondary?: string;
  /** Render the primary in mono with left-truncation (paths and shas). */
  mono?: boolean;
  /** Present → the row flies the camera to this landmark on click. */
  landmark?: LandmarkRef;
}

export type AlmanacSectionKey = 'buildings' | 'streets' | 'forest' | 'fireflies';

export interface AlmanacSection {
  key: AlmanacSectionKey;
  title: string;
  facts: AlmanacFact[];
}

export interface LanguageStat {
  ext: string;
  count: number;
}

export interface AlmanacOverview {
  name: string;
  founded: string | null;
  totals: { files: number; dirs: number; commits: number; authors: number };
  repo: RepoInfo;
  languages: LanguageStat[];
}

export interface Almanac {
  overview: AlmanacOverview;
  sections: AlmanacSection[];
}

const MAX_LANGUAGES = 6;

function isManifest(m: unknown): m is Manifest {
  return !!m && typeof m === 'object' && 'tree' in (m as object) && (m as Manifest).tree != null;
}

function* walk(node: TreeNode): Generator<TreeNode> {
  yield node;
  if (node.type === NodeKind.Directory) {
    for (const child of node.children) yield* walk(child);
  }
}

function distinctAuthors(commits: Manifest['commits']): number {
  const set = new Set<string>();
  for (const c of commits) for (const a of c.authors) set.add(a);
  return set.size;
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "3 files" / "1 file" — comma-formats the count and pluralizes the noun. */
function pluralize(n: number, noun: string): string {
  return `${fmtCount(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/** ISO date string → epoch ms; NaN for missing/unparseable (never wins a max). */
function dateMs(iso: string | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

/** Pick the file maximizing `score`; ties resolve to the first seen. NaN scores
 *  never win, so files with missing dates are simply skipped as candidates. */
function pickFile(files: FileNode[], score: (f: FileNode) => number): FileNode | null {
  let best: FileNode | null = null;
  let bestScore = -Infinity;
  for (const f of files) {
    const s = score(f);
    if (s > bestScore) {
      bestScore = s;
      best = f;
    }
  }
  return best;
}

function fileFact(label: string, file: FileNode | null, secondary: string): AlmanacFact | null {
  if (!file) return null;
  return { label, primary: file.path, secondary, mono: true, landmark: { kind: 'file', id: file.path } };
}

function buildOverview(m: Manifest): AlmanacOverview {
  const root = m.tree;
  return {
    name: m.display_root || root.name || 'this project',
    founded: m.dateRanges.createdMin ? formatShortDate(m.dateRanges.createdMin) : null,
    totals: {
      files: root.descendants_file_count,
      dirs: root.descendants_dir_count,
      commits: m.commits.length,
      authors: distinctAuthors(m.commits),
    },
    repo: m.repo,
    languages: root.descendants_ext_breakdown
      .slice(0, MAX_LANGUAGES)
      .map((e) => ({ ext: e.ext, count: e.count })),
  };
}

function buildingsSection(files: FileNode[]): AlmanacSection {
  const oldest = pickFile(files, (f) => -dateMs(f.created));
  const newest = pickFile(files, (f) => dateMs(f.created));
  const tallest = pickFile(files, (f) => f.lines);
  const shortest = pickFile(files, (f) => -f.lines);
  const widest = pickFile(files, (f) => f.size);
  const narrowest = pickFile(files, (f) => -f.size);
  const brightest = pickFile(files, (f) => dateMs(f.modified));
  const faded = pickFile(files, (f) => -dateMs(f.modified));
  const created = (f: FileNode | null) => (f ? `Created ${formatShortDate(f.created)}` : '');
  const edited = (f: FileNode | null) => (f ? `Edited ${formatShortDate(f.modified)}` : '');
  const facts = [
    fileFact('Oldest building', oldest, created(oldest)),
    fileFact('Newest building', newest, created(newest)),
    fileFact('Tallest building', tallest, tallest ? pluralize(tallest.lines, 'line') : ''),
    fileFact('Shortest building', shortest, shortest ? pluralize(shortest.lines, 'line') : ''),
    fileFact('Widest building', widest, widest ? formatBytes(widest.size) : ''),
    fileFact('Narrowest building', narrowest, narrowest ? formatBytes(narrowest.size) : ''),
    fileFact('Brightest building', brightest, edited(brightest)),
    fileFact('Most faded building', faded, edited(faded)),
  ];
  return { key: 'buildings', title: 'Buildings', facts: facts.filter((f): f is AlmanacFact => f !== null) };
}

function depth(path: string): number {
  return path ? path.split('/').length : 0;
}

function streetsSection(dirs: DirNode[]): AlmanacSection | null {
  if (dirs.length === 0) return null;
  let deepest = dirs[0];
  let biggest = dirs[0];
  for (const d of dirs) {
    if (depth(d.path) > depth(deepest.path)) deepest = d;
    if (d.descendants_file_count > biggest.descendants_file_count) biggest = d;
  }
  const deepestDepth = depth(deepest.path);
  return {
    key: 'streets',
    title: 'Streets',
    facts: [
      { label: 'Deepest alley', primary: deepest.path, secondary: `${deepestDepth} levels deep`, mono: true, landmark: { kind: 'dir', id: deepest.path } },
      { label: 'Biggest neighborhood', primary: biggest.path, secondary: pluralize(biggest.descendants_file_count, 'building'), mono: true, landmark: { kind: 'dir', id: biggest.path } },
    ],
  };
}

function longestStreak(dates: string[]): number {
  const uniq = [...new Set(dates)].sort();
  if (uniq.length === 0) return 0;
  let best = 1;
  let run = 1;
  const oneDay = 86_400_000;
  for (let i = 1; i < uniq.length; i++) {
    const prev = Date.parse(`${uniq[i - 1]}T00:00:00Z`);
    const cur = Date.parse(`${uniq[i]}T00:00:00Z`);
    if (cur - prev === oneDay) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

function forestSection(commits: Manifest['commits']): AlmanacSection | null {
  if (commits.length === 0) return null;
  let grandest = commits[0];
  let sparsest = commits[0];
  let busiest = commits[0];
  for (const c of commits) {
    if (c.files > grandest.files) grandest = c;
    if (c.files < sparsest.files) sparsest = c;
    if (c.same_day_total > busiest.same_day_total) busiest = c;
  }
  const streak = longestStreak(commits.map((c) => c.date));
  return {
    key: 'forest',
    title: 'Forest',
    facts: [
      { label: 'Grandest canopy', primary: grandest.sha.slice(0, 7), secondary: pluralize(grandest.files, 'file'), mono: true, landmark: { kind: 'commit', id: grandest.sha } },
      { label: 'Sparsest canopy', primary: sparsest.sha.slice(0, 7), secondary: pluralize(sparsest.files, 'file'), mono: true, landmark: { kind: 'commit', id: sparsest.sha } },
      { label: 'Busiest day', primary: formatShortDate(busiest.date), secondary: pluralize(busiest.same_day_total, 'commit') },
      { label: 'Longest streak', primary: pluralize(streak, 'consecutive day') },
    ],
  };
}

function firefliesSection(commits: Manifest['commits']): AlmanacSection | null {
  if (commits.length === 0) return null;
  const tally = new Map<string, number>();
  for (const c of commits) for (const author of c.authors) tally.set(author, (tally.get(author) ?? 0) + 1);
  let topAuthor = '';
  let topCount = -1;
  for (const [author, count] of tally) {
    if (count > topCount) {
      topCount = count;
      topAuthor = author;
    }
  }
  return {
    key: 'fireflies',
    title: 'Fireflies',
    facts: [
      { label: 'Fireflies', primary: pluralize(tally.size, 'author') },
      { label: 'Most prolific author', primary: topAuthor, secondary: pluralize(topCount, 'commit') },
    ],
  };
}

export function computeAlmanac(m: Manifest | DirNode | null | undefined): Almanac | null {
  if (!isManifest(m)) return null;
  const files: FileNode[] = [];
  const dirs: DirNode[] = [];
  for (const node of walk(m.tree)) {
    if (node.type === NodeKind.File) files.push(node);
    else if (node.type === NodeKind.Directory && node !== m.tree) dirs.push(node);
  }
  if (files.length === 0) return null;
  const sections: AlmanacSection[] = [buildingsSection(files)];
  const streets = streetsSection(dirs);
  if (streets) sections.push(streets);
  const forest = forestSection(m.commits);
  if (forest) sections.push(forest);
  const fireflies = firefliesSection(m.commits);
  if (fireflies) sections.push(fireflies);
  return { overview: buildOverview(m), sections };
}
