// views/InfoPane/almanac.ts — pure derivation of the Overview tab's almanac:
// repo superlatives (oldest/tallest building, ...) computed from data already
// loaded client-side. No signals, no DOM.
// Landmark facts carry the key needed to fly the camera there.

import { NodeKind } from '@/types';
import type { Manifest, DirNode, FileNode, RepoInfo, TreeNode } from '@/types';
import { formatShortDate, dateMs } from '@/utils/dates';
import { formatBytes } from '@/utils/bytes';
import { formatCount, pluralize } from '@/utils/format';
import { labelFromSource } from '@/utils/sources';

export type LandmarkKind = NodeKind.File | NodeKind.Directory | NodeKind.Commit;

export interface LandmarkRef {
  kind: LandmarkKind;
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
  /** Hover tooltip explaining what the superlative means + its in-world encoding. */
  tip: string;
  /** Present → the row flies the camera to this landmark on click. */
  landmark?: LandmarkRef;
}

export type AlmanacSectionKey = 'buildings' | 'media' | 'streets' | 'forest' | 'fireflies';

export interface AlmanacSection {
  key: AlmanacSectionKey;
  title: string;
  facts: AlmanacFact[];
  /** Shown in place of facts when the section has none — an empty state or a
   *  gated notice (e.g. the Trees layer is off). */
  note?: string;
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

function fileFact(
  label: string,
  file: FileNode | null,
  secondary: string,
  tip: string
): AlmanacFact | null {
  if (!file) return null;
  return {
    label,
    primary: file.path,
    secondary,
    mono: true,
    tip,
    landmark: { kind: NodeKind.File, id: file.path },
  };
}

function buildOverview(m: Manifest): AlmanacOverview {
  const root = m.tree;
  return {
    // Prefer a concise "owner/repo" (or folder basename) over the raw URL —
    // the full remote URL still appears, clickable, in the meta list.
    name:
      labelFromSource(m.repo.remote_url ?? m.display_root ?? root.name) ??
      root.name ??
      'this project',
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
  if (files.length === 0) {
    return { key: 'buildings', title: 'Buildings', facts: [], note: 'No code files yet.' };
  }
  // Height encodes line count, but binary files report 0 lines, so restrict the
  // line-based picks to text files; byte/date picks span every code building.
  const textFiles = files.filter((f) => !f.binary);
  const oldest = pickFile(files, (f) => -dateMs(f.created));
  const newest = pickFile(files, (f) => dateMs(f.created));
  const tallest = pickFile(textFiles, (f) => f.lines);
  const shortest = pickFile(textFiles, (f) => -f.lines);
  const widest = pickFile(files, (f) => f.size);
  const narrowest = pickFile(files, (f) => -f.size);
  const freshest = pickFile(files, (f) => dateMs(f.modified));
  const stalest = pickFile(files, (f) => -dateMs(f.modified));
  const created = (f: FileNode | null) => (f ? `Created ${formatShortDate(f.created)}` : '');
  const edited = (f: FileNode | null) => (f ? `Edited ${formatShortDate(f.modified)}` : '');
  const facts = [
    fileFact(
      'Newest building',
      newest,
      created(newest),
      'Most recently created file, by git history.'
    ),
    fileFact(
      'Oldest building',
      oldest,
      created(oldest),
      'Earliest-created file — the city’s founding structure.'
    ),
    fileFact(
      'Freshest building',
      freshest,
      edited(freshest),
      'File with the newest commit. Edits only count once committed — this is the date that drives a building’s brightness.'
    ),
    fileFact(
      'Stalest building',
      stalest,
      edited(stalest),
      'File whose last commit is the oldest — the dimmest building.'
    ),
    fileFact(
      'Tallest building',
      tallest,
      tallest ? pluralize(tallest.lines, 'line') : '',
      'File with the most lines; line count sets a building’s height.'
    ),
    fileFact(
      'Shortest building',
      shortest,
      shortest ? pluralize(shortest.lines, 'line') : '',
      'File with the fewest lines.'
    ),
    fileFact(
      'Widest building',
      widest,
      widest ? formatBytes(widest.size) : '',
      'Largest file by bytes; file size sets a building’s footprint.'
    ),
    fileFact(
      'Narrowest building',
      narrowest,
      narrowest ? formatBytes(narrowest.size) : '',
      'Smallest file by bytes.'
    ),
  ];
  return {
    key: 'buildings',
    title: 'Buildings',
    facts: facts.filter((f): f is AlmanacFact => f !== null),
  };
}

/** Pixel area of a media file, or NaN when its dimensions are unknown. */
function pixels(f: FileNode): number {
  return f.media_width && f.media_height ? f.media_width * f.media_height : NaN;
}

function mediaSection(media: FileNode[]): AlmanacSection {
  // Media files render as billboards (image/video ad panels) sized by aspect,
  // not lines — a separate class of building with its own superlatives.
  if (media.length === 0) {
    return { key: 'media', title: 'Billboards', facts: [], note: 'No images or videos.' };
  }
  const largest = pickFile(media, (f) => f.size);
  const sharpest = pickFile(media, pixels);
  const facts = [
    {
      label: 'Billboards',
      primary: pluralize(media.length, 'billboard'),
      tip: 'Image & video files — they render as billboard panels sized by aspect.',
    } as AlmanacFact,
    fileFact(
      'Largest billboard',
      largest,
      largest ? formatBytes(largest.size) : '',
      'Biggest media file by bytes.'
    ),
    fileFact(
      'Highest resolution',
      sharpest,
      sharpest && sharpest.media_width && sharpest.media_height
        ? `${formatCount(sharpest.media_width)} × ${formatCount(sharpest.media_height)}`
        : '',
      'Media file with the most pixels.'
    ),
  ];
  return {
    key: 'media',
    title: 'Billboards',
    facts: facts.filter((f): f is AlmanacFact => f !== null),
  };
}

function depth(path: string): number {
  return path ? path.split('/').length : 0;
}

function streetsSection(dirs: DirNode[]): AlmanacSection {
  if (dirs.length === 0) {
    return {
      key: 'streets',
      title: 'Streets',
      facts: [],
      note: 'Everything lives at the root — no sub-directories.',
    };
  }
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
      {
        label: 'Deepest alley',
        primary: deepest.path,
        secondary: `${deepestDepth} levels deep`,
        mono: true,
        tip: 'Most deeply nested directory.',
        landmark: { kind: NodeKind.Directory, id: deepest.path },
      },
      {
        label: 'Biggest neighborhood',
        primary: biggest.path,
        secondary: pluralize(biggest.descendants_file_count, 'building'),
        mono: true,
        tip: 'Directory holding the most files (excluding the repo root); sets a street’s width.',
        landmark: { kind: NodeKind.Directory, id: biggest.path },
      },
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

function forestSection(commits: Manifest['commits'], treesEnabled: boolean): AlmanacSection {
  // Canopies fly the camera to a tree; with the Trees layer off those targets
  // don't exist, so the notice lives here (not the view) like any empty state.
  if (!treesEnabled) {
    return {
      key: 'forest',
      title: 'Forest',
      facts: [],
      note: 'Enable the Trees layer in Settings to explore the forest.',
    };
  }
  if (commits.length === 0) {
    return { key: 'forest', title: 'Forest', facts: [], note: 'No commits yet.' };
  }
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
      {
        label: 'Grandest canopy',
        primary: grandest.sha.slice(0, 7),
        secondary: pluralize(grandest.files, 'file'),
        mono: true,
        tip: 'Commit that changed the most files — the widest tree.',
        landmark: { kind: NodeKind.Commit, id: grandest.sha },
      },
      {
        label: 'Sparsest canopy',
        primary: sparsest.sha.slice(0, 7),
        secondary: pluralize(sparsest.files, 'file'),
        mono: true,
        tip: 'Commit that changed the fewest files.',
        landmark: { kind: NodeKind.Commit, id: sparsest.sha },
      },
      {
        label: 'Busiest day',
        primary: formatShortDate(busiest.date),
        secondary: pluralize(busiest.same_day_total, 'commit'),
        tip: 'Calendar day with the most commits.',
      },
      {
        label: 'Longest streak',
        primary: pluralize(streak, 'consecutive day'),
        tip: 'Longest run of consecutive days with commits.',
      },
    ],
  };
}

function firefliesSection(commits: Manifest['commits']): AlmanacSection {
  if (commits.length === 0) {
    return {
      key: 'fireflies',
      title: 'Fireflies',
      facts: [],
      note: 'No commits yet — no fireflies.',
    };
  }
  const tally = new Map<string, number>();
  for (const c of commits)
    for (const author of c.authors) tally.set(author, (tally.get(author) ?? 0) + 1);
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
      {
        label: 'Fireflies',
        primary: pluralize(tally.size, 'author'),
        tip: 'Distinct commit authors; each is a uniquely colored firefly.',
      },
      {
        label: 'Most prolific author',
        primary: topAuthor,
        secondary: pluralize(topCount, 'commit'),
        tip: 'Author with the most commits — the largest firefly.',
      },
    ],
  };
}

/**
 * Build the almanac from a manifest. Every section is always present — empty
 * ones carry a `note` empty-state rather than vanishing. `treesEnabled` gates
 * the Forest section's contents (canopies fly to trees that don't exist when
 * the layer is off). Returns null only when there's no project at all.
 */
export function computeAlmanac(
  m: Manifest | DirNode | null | undefined,
  treesEnabled = true
): Almanac | null {
  if (!isManifest(m)) return null;
  const files: FileNode[] = [];
  const dirs: DirNode[] = [];
  for (const node of walk(m.tree)) {
    if (node.type === NodeKind.File) files.push(node);
    else if (node.type === NodeKind.Directory && node !== m.tree) dirs.push(node);
  }
  if (files.length === 0) return null;
  const buildingFiles = files.filter((f) => f.mediaKind == null);
  const mediaFiles = files.filter((f) => f.mediaKind != null);
  const sections: AlmanacSection[] = [
    buildingsSection(buildingFiles),
    mediaSection(mediaFiles),
    streetsSection(dirs),
    forestSection(m.commits, treesEnabled),
    firefliesSection(m.commits),
  ];
  return { overview: buildOverview(m), sections };
}
