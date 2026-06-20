// views/InfoPane/almanac.ts — pure derivation of the Overview tab's almanac:
// repo superlatives mapped from manifest.stats (server-computed leaders).
// No signals, no DOM, no tree walk.
// Landmark facts carry the key needed to fly the camera there.

import { NodeKind } from '@/types';
import type { Manifest, DirNode, RepoInfo, FileLeader, DirLeader, CommitLeader } from '@/types';
import { formatShortDate } from '@/utils/dates';
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

function fileFact(
  label: string,
  leader: FileLeader | null,
  secondary: (l: FileLeader) => string,
  tip: string
): AlmanacFact | null {
  if (!leader) return null;
  return {
    label,
    primary: leader.path,
    secondary: secondary(leader),
    mono: true,
    tip,
    landmark: { kind: NodeKind.File, id: leader.path },
  };
}

function dirFact(
  label: string,
  leader: DirLeader | null,
  secondary: string,
  tip: string
): AlmanacFact | null {
  if (!leader) return null;
  return {
    label,
    primary: leader.path,
    secondary,
    mono: true,
    tip,
    landmark: { kind: NodeKind.Directory, id: leader.path },
  };
}

function commitFact(label: string, leader: CommitLeader | null, tip: string): AlmanacFact | null {
  if (!leader) return null;
  return {
    label,
    primary: leader.sha.slice(0, 7),
    secondary: pluralize(leader.files, 'file'),
    mono: true,
    tip,
    landmark: { kind: NodeKind.Commit, id: leader.sha },
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
    founded: m.dateRanges.minCreated ? formatShortDate(m.dateRanges.minCreated) : null,
    totals: {
      files: root.descendants_file_count,
      dirs: root.descendants_dir_count,
      commits: m.commits.length,
      authors: m.stats.authors.length,
    },
    repo: m.repo,
    languages: root.descendants_ext_breakdown
      .slice(0, MAX_LANGUAGES)
      .map((e) => ({ ext: e.ext, count: e.count })),
  };
}

function buildingsSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  const facts = [
    fileFact(
      'Newest building',
      s.newestCreatedFile,
      (l) => `Created ${formatShortDate(l.created)}`,
      'Most recently created file, by git history.'
    ),
    fileFact(
      'Oldest building',
      s.oldestCreatedFile,
      (l) => `Created ${formatShortDate(l.created)}`,
      "Earliest-created file — the city's founding structure."
    ),
    fileFact(
      'Freshest building',
      s.newestModifiedFile,
      (l) => `Edited ${formatShortDate(l.modified)}`,
      "File with the newest commit. Edits only count once committed — this is the date that drives a building's brightness."
    ),
    fileFact(
      'Stalest building',
      s.oldestModifiedFile,
      (l) => `Edited ${formatShortDate(l.modified)}`,
      'File whose last commit is the oldest — the dimmest building.'
    ),
    fileFact(
      'Tallest building',
      s.maxLinesFile,
      (l) => pluralize(l.lines, 'line'),
      "File with the most lines; line count sets a building's height."
    ),
    fileFact(
      'Shortest building',
      s.minLinesFile,
      (l) => pluralize(l.lines, 'line'),
      'File with the fewest lines.'
    ),
    fileFact(
      'Widest building',
      s.maxBytesFile,
      (l) => formatBytes(l.bytes),
      "Largest file by bytes; file size sets a building's footprint."
    ),
    fileFact(
      'Narrowest building',
      s.minBytesFile,
      (l) => formatBytes(l.bytes),
      'Smallest file by bytes.'
    ),
  ].filter((f): f is AlmanacFact => f !== null);

  if (facts.length === 0) {
    return { key: 'buildings', title: 'Buildings', facts: [], note: 'No code files yet.' };
  }
  return { key: 'buildings', title: 'Buildings', facts };
}

function mediaSection(m: Manifest): AlmanacSection {
  // Media files render as billboards (image/video ad panels) sized by aspect,
  // not lines — a separate class of building with its own superlatives.
  const s = m.stats;
  if (s.mediaCount === 0) {
    return { key: 'media', title: 'Billboards', facts: [], note: 'No images or videos.' };
  }
  const facts = [
    {
      label: 'Billboards',
      primary: pluralize(s.mediaCount, 'billboard'),
      tip: 'Image & video files — they render as billboard panels sized by aspect.',
    } as AlmanacFact,
    fileFact(
      'Largest billboard',
      s.maxMediaBytesFile,
      (l) => formatBytes(l.bytes),
      'Biggest media file by bytes.'
    ),
    s.maxMediaPixelsFile?.media_width && s.maxMediaPixelsFile?.media_height
      ? fileFact(
          'Highest resolution',
          s.maxMediaPixelsFile,
          (l) => `${formatCount(l.media_width!)} × ${formatCount(l.media_height!)}`,
          'Media file with the most pixels.'
        )
      : null,
  ].filter((f): f is AlmanacFact => f !== null);

  return { key: 'media', title: 'Billboards', facts };
}

function streetsSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  const facts = [
    dirFact(
      'Deepest alley',
      s.maxDepthDir,
      s.maxDepthDir ? `${s.maxDepthDir.depth} levels deep` : '',
      'Most deeply nested directory.'
    ),
    dirFact(
      'Biggest neighborhood',
      s.maxFilesPerDir,
      s.maxFilesPerDir ? pluralize(s.maxFilesPerDir.file_count, 'building') : '',
      "Directory holding the most files (excluding the repo root); sets a street's width."
    ),
  ].filter((f): f is AlmanacFact => f !== null);

  if (facts.length === 0) {
    return {
      key: 'streets',
      title: 'Streets',
      facts: [],
      note: 'Everything lives at the root — no sub-directories.',
    };
  }
  return { key: 'streets', title: 'Streets', facts };
}

function forestSection(m: Manifest, treesEnabled: boolean): AlmanacSection {
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
  const s = m.stats;
  if (m.commits.length === 0) {
    return { key: 'forest', title: 'Forest', facts: [], note: 'No commits yet.' };
  }
  const facts = [
    commitFact(
      'Grandest canopy',
      s.maxFilesPerCommit,
      'Commit that changed the most files — the widest tree.'
    ),
    commitFact('Sparsest canopy', s.minFilesPerCommit, 'Commit that changed the fewest files.'),
    s.maxCommitsPerDay
      ? ({
          label: 'Busiest day',
          primary: formatShortDate(s.maxCommitsPerDay.date),
          secondary: pluralize(s.maxCommitsPerDay.count, 'commit'),
          tip: 'Calendar day with the most commits.',
        } as AlmanacFact)
      : null,
    {
      label: 'Longest streak',
      primary: pluralize(s.maxCommitStreakDays, 'consecutive day'),
      tip: 'Longest run of consecutive days with commits.',
    } as AlmanacFact,
  ].filter((f): f is AlmanacFact => f !== null);

  return { key: 'forest', title: 'Forest', facts };
}

function firefliesSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  if (s.authors.length === 0) {
    return {
      key: 'fireflies',
      title: 'Fireflies',
      facts: [],
      note: 'No commits yet — no fireflies.',
    };
  }
  // authors is pre-sorted descending by commits from the backend.
  const top = s.authors[0];
  return {
    key: 'fireflies',
    title: 'Fireflies',
    facts: [
      {
        label: 'Fireflies',
        primary: pluralize(s.authors.length, 'author'),
        tip: 'Distinct commit authors; each is a uniquely colored firefly.',
      },
      {
        label: 'Most prolific author',
        primary: top.name,
        secondary: pluralize(top.commits, 'commit'),
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
  if (!m.stats) return null;
  const sections: AlmanacSection[] = [
    buildingsSection(m),
    mediaSection(m),
    streetsSection(m),
    forestSection(m, treesEnabled),
    firefliesSection(m),
  ];
  return { overview: buildOverview(m), sections };
}
