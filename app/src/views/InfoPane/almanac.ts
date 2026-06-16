// views/InfoPane/almanac.ts — pure derivation of the "World Almanac":
// repo superlatives (oldest/tallest building, ...) computed from data already
// loaded client-side. No signals, no DOM — WorldPane renders the result.
// Landmark facts carry the key needed to fly the camera there.

import { NodeKind } from '@/types';
import type { Manifest, DirNode, FileNode, RepoInfo, TreeNode } from '@/types';
import { formatShortDate } from '@/utils/dates';

export interface LandmarkRef {
  kind: 'file' | 'dir' | 'commit';
  /** file/dir → path; commit → sha. */
  id: string;
}

export interface AlmanacFact {
  label: string;
  value: string;
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
  return !!m && typeof m === 'object' && 'tree' in (m as object) && !!(m as Manifest).tree;
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

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
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

function fileFact(label: string, file: FileNode | null, detail: string): AlmanacFact | null {
  if (!file) return null;
  return { label, value: `${file.path} · ${detail}`, landmark: { kind: 'file', id: file.path } };
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
  const tallest = pickFile(files, (f) => f.lines);
  const shortest = pickFile(files, (f) => -f.lines);
  const widest = pickFile(files, (f) => f.size);
  const narrowest = pickFile(files, (f) => -f.size);
  const facts = [
    fileFact('Oldest building', pickFile(files, (f) => -dateMs(f.created)), 'first raised'),
    fileFact('Newest building', pickFile(files, (f) => dateMs(f.created)), 'most recently raised'),
    fileFact('Tallest building', tallest, tallest ? `${fmt(tallest.lines)} lines` : ''),
    fileFact('Shortest building', shortest, shortest ? `${fmt(shortest.lines)} lines` : ''),
    fileFact('Widest building', widest, widest ? formatBytes(widest.size) : ''),
    fileFact('Narrowest building', narrowest, narrowest ? formatBytes(narrowest.size) : ''),
    fileFact('Brightest building', pickFile(files, (f) => dateMs(f.modified)), 'freshly touched'),
    fileFact('Most faded building', pickFile(files, (f) => -dateMs(f.modified)), 'long untouched'),
  ];
  return { key: 'buildings', title: 'Buildings', facts: facts.filter((f): f is AlmanacFact => f !== null) };
}

export function computeAlmanac(m: Manifest | DirNode | null | undefined): Almanac | null {
  if (!isManifest(m)) return null;
  const files: FileNode[] = [];
  for (const node of walk(m.tree)) {
    if (node.type === NodeKind.File) files.push(node);
  }
  if (files.length === 0) return null;
  return { overview: buildOverview(m), sections: [buildingsSection(files)] };
}
