// views/InfoPane/almanac.ts — pure derivation of the Overview tab's almanac:
// repo superlatives mapped from manifest.stats (server-computed leaders). No
// signals, no DOM, no tree walk — this file decides WHAT to show; the UI (how
// to render it) lives in OverviewPane.tsx. Landmark facts carry the key needed
// to fly the camera there.

import { NodeKind } from '@/types';
import type {
  Manifest,
  DirNode,
  RepoInfo,
  RepoStats,
  FileLeader,
  DirLeader,
  CommitLeader,
} from '@/types';
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
  /** Hover tooltip explaining what the superlative means + its in-world encoding. */
  tip: string;
  /** Present → the primary is a code identifier (a path or sha): rendered
   *  monospace + left-truncated, and the row flies the camera to this landmark
   *  on click. Absent → a plain count/date/name summary fact. */
  landmark?: LandmarkRef;
}

export type AlmanacSectionKey = 'buildings' | 'media' | 'streets' | 'forest' | 'fireflies';

export interface AlmanacSection {
  key: AlmanacSectionKey;
  title: string;
  /** One-line "what is this layer" blurb, shown as the section header tooltip. */
  tip: string;
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

// What each world layer encodes — surfaced as the section header tooltips.
const SECTION_TIPS: Record<AlmanacSectionKey, string> = {
  buildings:
    'Every code file is a building — height from line count, footprint from byte size, brightness from how recently it changed.',
  media: 'Image & video files render as billboard panels, sized by aspect ratio instead of lines.',
  streets: 'Directories are streets; the more files a directory holds, the wider its road.',
  forest:
    'Each commit plants a tree — older commits grow taller, bigger commits grow wider canopies.',
  fireflies:
    'Each distinct commit author is a uniquely colored firefly orbiting the trees they touched.',
};

function isManifest(m: unknown): m is Manifest {
  return !!m && typeof m === 'object' && 'tree' in (m as object) && (m as Manifest).tree != null;
}

// ---- fact builders ------------------------------------------------------
// Landmark facts (file / dir / commit) carry a path or sha primary and a
// landmark key, so the row is clickable. Each returns null when its leader is
// absent, so an empty pool collapses the section to its note. Summary facts
// (statFact) are a plain count/date/name with no landmark.

function fileFact(o: {
  label: string;
  leader: FileLeader | null;
  secondary: (l: FileLeader) => string;
  tip: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: o.leader.path,
    secondary: o.secondary(o.leader),
    tip: o.tip,
    landmark: { kind: NodeKind.File, id: o.leader.path },
  };
}

function dirFact(o: {
  label: string;
  leader: DirLeader | null;
  secondary: (l: DirLeader) => string;
  tip: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: o.leader.path,
    secondary: o.secondary(o.leader),
    tip: o.tip,
    landmark: { kind: NodeKind.Directory, id: o.leader.path },
  };
}

function commitFact(o: {
  label: string;
  leader: CommitLeader | null;
  tip: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: o.leader.sha.slice(0, 7),
    secondary: pluralize(o.leader.files, 'file'),
    tip: o.tip,
    landmark: { kind: NodeKind.Commit, id: o.leader.sha },
  };
}

function statFact(o: {
  label: string;
  primary: string;
  secondary?: string;
  tip: string;
}): AlmanacFact {
  return { label: o.label, primary: o.primary, secondary: o.secondary, tip: o.tip };
}

function compact(facts: (AlmanacFact | null)[]): AlmanacFact[] {
  return facts.filter((f): f is AlmanacFact => f !== null);
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

function buildingsSection(s: RepoStats): AlmanacSection {
  const facts = compact([
    fileFact({
      label: 'Newest building',
      leader: s.newestCreatedFile,
      secondary: (l) => `Created ${formatShortDate(l.created)}`,
      tip: 'Most recently created file, by git history.',
    }),
    fileFact({
      label: 'Oldest building',
      leader: s.oldestCreatedFile,
      secondary: (l) => `Created ${formatShortDate(l.created)}`,
      tip: "Earliest-created file — the city's founding structure.",
    }),
    fileFact({
      label: 'Freshest building',
      leader: s.newestModifiedFile,
      secondary: (l) => `Edited ${formatShortDate(l.modified)}`,
      tip: "File with the newest commit. Edits only count once committed — this is the date that drives a building's brightness.",
    }),
    fileFact({
      label: 'Stalest building',
      leader: s.oldestModifiedFile,
      secondary: (l) => `Edited ${formatShortDate(l.modified)}`,
      tip: 'File whose last commit is the oldest — the dimmest building.',
    }),
    fileFact({
      label: 'Tallest building',
      leader: s.maxLinesFile,
      secondary: (l) => pluralize(l.lines, 'line'),
      tip: "File with the most lines; line count sets a building's height.",
    }),
    fileFact({
      label: 'Shortest building',
      leader: s.minLinesFile,
      secondary: (l) => pluralize(l.lines, 'line'),
      tip: 'File with the fewest lines.',
    }),
    fileFact({
      label: 'Widest building',
      leader: s.maxBytesFile,
      secondary: (l) => formatBytes(l.bytes),
      tip: "Largest file by bytes; file size sets a building's footprint.",
    }),
    fileFact({
      label: 'Narrowest building',
      leader: s.minBytesFile,
      secondary: (l) => formatBytes(l.bytes),
      tip: 'Smallest file by bytes.',
    }),
  ]);
  return {
    key: 'buildings',
    title: 'Buildings',
    tip: SECTION_TIPS.buildings,
    facts,
    note: facts.length ? undefined : 'No code files yet.',
  };
}

function mediaSection(s: RepoStats): AlmanacSection {
  // Media files render as billboards (image/video ad panels) sized by aspect,
  // not lines — a separate class of building with its own superlatives.
  if (s.mediaCount === 0) {
    return {
      key: 'media',
      title: 'Billboards',
      tip: SECTION_TIPS.media,
      facts: [],
      note: 'No images or videos.',
    };
  }
  const sharp = s.maxMediaPixelsFile;
  const facts = compact([
    statFact({
      label: 'Billboards',
      primary: pluralize(s.mediaCount, 'billboard'),
      tip: 'Image & video files — they render as billboard panels sized by aspect.',
    }),
    fileFact({
      label: 'Largest billboard',
      leader: s.maxMediaBytesFile,
      secondary: (l) => formatBytes(l.bytes),
      tip: 'Biggest media file by bytes.',
    }),
    sharp?.media_width && sharp?.media_height
      ? fileFact({
          label: 'Highest resolution',
          leader: sharp,
          secondary: (l) => `${formatCount(l.media_width!)} × ${formatCount(l.media_height!)}`,
          tip: 'Media file with the most pixels.',
        })
      : null,
  ]);
  return { key: 'media', title: 'Billboards', tip: SECTION_TIPS.media, facts };
}

function streetsSection(s: RepoStats): AlmanacSection {
  const facts = compact([
    dirFact({
      label: 'Deepest alley',
      leader: s.maxDepthDir,
      secondary: (l) => `${l.depth} levels deep`,
      tip: 'Most deeply nested directory.',
    }),
    dirFact({
      label: 'Biggest neighborhood',
      leader: s.maxFilesPerDir,
      secondary: (l) => pluralize(l.file_count, 'building'),
      tip: "Directory holding the most files (excluding the repo root); sets a street's width.",
    }),
  ]);
  return {
    key: 'streets',
    title: 'Streets',
    tip: SECTION_TIPS.streets,
    facts,
    note: facts.length ? undefined : 'Everything lives at the root — no sub-directories.',
  };
}

function forestSection(m: Manifest, treesEnabled: boolean): AlmanacSection {
  const base = { key: 'forest', title: 'Forest', tip: SECTION_TIPS.forest } as const;
  // Canopies fly the camera to a tree; with the Trees layer off those targets
  // don't exist, so the notice lives here (not the view) like any empty state.
  if (!treesEnabled) {
    return {
      ...base,
      facts: [],
      note: 'Enable the Trees layer in Settings to explore the forest.',
    };
  }
  if (m.commits.length === 0) {
    return { ...base, facts: [], note: 'No commits yet.' };
  }
  const s = m.stats;
  const facts = compact([
    commitFact({
      label: 'Grandest canopy',
      leader: s.maxFilesPerCommit,
      tip: 'Commit that changed the most files — the widest tree.',
    }),
    commitFact({
      label: 'Sparsest canopy',
      leader: s.minFilesPerCommit,
      tip: 'Commit that changed the fewest files.',
    }),
    s.maxCommitsPerDay
      ? statFact({
          label: 'Busiest day',
          primary: formatShortDate(s.maxCommitsPerDay.date),
          secondary: pluralize(s.maxCommitsPerDay.count, 'commit'),
          tip: 'Calendar day with the most commits.',
        })
      : null,
    statFact({
      label: 'Longest streak',
      primary: pluralize(s.maxCommitStreakDays, 'consecutive day'),
      tip: 'Longest run of consecutive days with commits.',
    }),
  ]);
  return { ...base, facts };
}

function firefliesSection(s: RepoStats): AlmanacSection {
  const base = { key: 'fireflies', title: 'Fireflies', tip: SECTION_TIPS.fireflies } as const;
  if (s.authors.length === 0) {
    return { ...base, facts: [], note: 'No commits yet — no fireflies.' };
  }
  const top = s.authors[0]; // pre-sorted descending by commits from the backend
  return {
    ...base,
    facts: [
      statFact({
        label: 'Fireflies',
        primary: pluralize(s.authors.length, 'author'),
        tip: 'Distinct commit authors; each is a uniquely colored firefly.',
      }),
      statFact({
        label: 'Most prolific author',
        primary: top.name,
        secondary: pluralize(top.commits, 'commit'),
        tip: 'Author with the most commits — the largest firefly.',
      }),
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
  const s = m.stats;
  const sections: AlmanacSection[] = [
    buildingsSection(s),
    mediaSection(s),
    streetsSection(s),
    forestSection(m, treesEnabled),
    firefliesSection(s),
  ];
  return { overview: buildOverview(m), sections };
}
