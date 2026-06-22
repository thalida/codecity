// views/InfoPane/almanac.ts — pure derivation of the Overview tab's almanac:
// repo superlatives mapped from manifest.stats (server-computed leaders). No
// signals, no DOM, no tree walk — this file decides WHAT to show; the UI (how
// to render it) lives in OverviewPane.tsx. Landmark facts carry the key needed
// to fly the camera there.

import { NodeKind } from '@/types';
import type { Manifest, DirNode, RepoInfo, FileLeader, DirLeader, CommitLeader } from '@/types';
import { formatShortDate, humanSpan } from '@/utils/dates';
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
  /** Dimension name. Consecutive facts sharing it render as one bound min↔max
   *  duo (e.g. "Height" over Shortest + Tallest) instead of two loose rows. */
  group?: string;
}

export type AlmanacSectionKey = 'buildings' | 'media' | 'streets' | 'forest' | 'fireflies';

export interface AlmanacSection {
  key: AlmanacSectionKey;
  title: string;
  /** One-line "what is this layer" blurb, shown as the section header tooltip. */
  tip: string;
  /** Summary line under the header — a count + one aggregate ("315 fireflies ·
   *  ~40 commits each"). Gives every section the same opening rhythm. */
  overview: string;
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
  /** File types beyond the shown top languages, and the files they cover —
   *  surfaced as a trailing "+N more" so the chip list accounts for the whole
   *  repo, not just the top few. Both 0 when nothing is truncated. */
  moreLanguages: number;
  moreLanguageFiles: number;
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
  group?: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: o.leader.path,
    secondary: o.secondary(o.leader),
    tip: o.tip,
    group: o.group,
    landmark: { kind: NodeKind.File, id: o.leader.path },
  };
}

function dirFact(o: {
  label: string;
  leader: DirLeader | null;
  secondary: (l: DirLeader) => string;
  tip: string;
  group?: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: o.leader.path,
    secondary: o.secondary(o.leader),
    tip: o.tip,
    group: o.group,
    landmark: { kind: NodeKind.Directory, id: o.leader.path },
  };
}

function commitFact(o: {
  label: string;
  leader: CommitLeader | null;
  tip: string;
  group?: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: o.leader.sha.slice(0, 7),
    secondary: pluralize(o.leader.files, 'file'),
    tip: o.tip,
    group: o.group,
    landmark: { kind: NodeKind.Commit, id: o.leader.sha },
  };
}

function statFact(o: {
  label: string;
  primary: string;
  secondary?: string;
  tip: string;
  group?: string;
}): AlmanacFact {
  return {
    label: o.label,
    primary: o.primary,
    secondary: o.secondary,
    tip: o.tip,
    group: o.group,
  };
}

function compact(facts: (AlmanacFact | null)[]): AlmanacFact[] {
  return facts.filter((f): f is AlmanacFact => f !== null);
}

/** Rounded "X per Y" for an overview average, or null when the inputs can't
 *  produce a real number (n ≤ 0, or a non-finite total from a pre-totals
 *  cached manifest) — so the caller drops the "· ~N each" clause instead of
 *  rendering NaN. */
function perEach(total: number, n: number): number | null {
  return n > 0 && Number.isFinite(total) ? Math.round(total / n) : null;
}

function buildOverview(m: Manifest): AlmanacOverview {
  const root = m.tree;
  const exts = root.descendants_ext_breakdown; // sorted by count desc on the backend
  const rest = exts.slice(MAX_LANGUAGES);
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
    languages: exts.slice(0, MAX_LANGUAGES).map((e) => ({ ext: e.ext, count: e.count })),
    moreLanguages: rest.length,
    moreLanguageFiles: rest.reduce((sum, e) => sum + e.count, 0),
  };
}

function buildingsSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  // Four min↔max duos — the dimension (Age / Last touched / Height / Footprint)
  // carries the noun, so the endpoint labels stay terse and the metric column
  // shows the bare value. Pair members must stay adjacent (the view groups
  // consecutive same-`group` facts).
  const facts = compact([
    fileFact({
      group: 'Age',
      label: 'Oldest',
      leader: s.oldestCreatedFile,
      secondary: (l) => formatShortDate(l.created),
      tip: "Earliest-created file, by git history — the city's founding structure.",
    }),
    fileFact({
      group: 'Age',
      label: 'Newest',
      leader: s.newestCreatedFile,
      secondary: (l) => formatShortDate(l.created),
      tip: 'Most recently created file, by git history.',
    }),
    fileFact({
      group: 'Last touched',
      label: 'Stalest',
      leader: s.oldestModifiedFile,
      secondary: (l) => formatShortDate(l.modified),
      tip: 'File whose last commit is the oldest — the dimmest building.',
    }),
    fileFact({
      group: 'Last touched',
      label: 'Freshest',
      leader: s.newestModifiedFile,
      secondary: (l) => formatShortDate(l.modified),
      tip: "File with the newest commit — the date that drives a building's brightness.",
    }),
    fileFact({
      group: 'Height',
      label: 'Shortest',
      leader: s.minLinesFile,
      secondary: (l) => pluralize(l.lines, 'line'),
      tip: 'File with the fewest lines.',
    }),
    fileFact({
      group: 'Height',
      label: 'Tallest',
      leader: s.maxLinesFile,
      secondary: (l) => pluralize(l.lines, 'line'),
      tip: "File with the most lines; line count sets a building's height.",
    }),
    fileFact({
      group: 'Footprint',
      label: 'Narrowest',
      leader: s.minBytesFile,
      secondary: (l) => formatBytes(l.bytes),
      tip: 'Smallest file by bytes.',
    }),
    fileFact({
      group: 'Footprint',
      label: 'Widest',
      leader: s.maxBytesFile,
      secondary: (l) => formatBytes(l.bytes),
      tip: "Largest file by bytes; file size sets a building's footprint.",
    }),
  ]);
  // Buildings = non-media files; media render as billboards in their own section.
  const count = Math.max(0, m.tree.descendants_file_count - s.mediaCount);
  const avgLines = perEach(s.totalLines, count);
  const overview =
    pluralize(count, 'building') +
    (avgLines !== null ? ` · ~${formatCount(avgLines)} lines each` : '');
  return {
    key: 'buildings',
    title: 'Buildings',
    tip: SECTION_TIPS.buildings,
    overview,
    facts,
    note: facts.length ? undefined : 'No code files yet.',
  };
}

function mediaSection(m: Manifest): AlmanacSection {
  // Media files render as billboards (image/video ad panels) sized by aspect,
  // not lines — a separate class of building with its own superlatives.
  const s = m.stats;
  const overview = pluralize(s.mediaCount, 'billboard');
  if (s.mediaCount === 0) {
    return {
      key: 'media',
      title: 'Billboards',
      tip: SECTION_TIPS.media,
      overview,
      facts: [],
      note: 'No images or videos.',
    };
  }
  const bytesFmt = (l: FileLeader) => formatBytes(l.bytes);
  const resFmt = (l: FileLeader) =>
    `${formatCount(l.media_width!)} × ${formatCount(l.media_height!)}`;
  const hasRes = (f: FileLeader | null): f is FileLeader => !!(f?.media_width && f?.media_height);
  // Pairs only when the endpoints are genuinely different files — a one-image
  // repo has no spread, so a Smallest/Largest split would just repeat the file.
  const lo = s.minMediaBytesFile;
  const hi = s.maxMediaBytesFile;
  const sizePair = !!(lo && hi && lo.path !== hi.path);
  const loRes = s.minMediaPixelsFile;
  const hiRes = s.maxMediaPixelsFile;
  const resPair = hasRes(loRes) && hasRes(hiRes) && loRes.path !== hiRes.path;
  // No spread (typically a single billboard): one spotlight row with the file's
  // size + resolution combined, rather than two lopsided one-item groups.
  if (!sizePair && !resPair && hi) {
    const dims = hasRes(hiRes) ? ` · ${resFmt(hiRes)}` : '';
    return {
      key: 'media',
      title: 'Billboards',
      tip: SECTION_TIPS.media,
      overview,
      facts: compact([
        fileFact({
          label: '',
          leader: hi,
          secondary: (l) => `${bytesFmt(l)}${dims}`,
          tip: 'The lone billboard — its byte size and pixel resolution.',
        }),
      ]),
    };
  }
  const facts = compact([
    sizePair
      ? fileFact({
          group: 'Size',
          label: 'Smallest',
          leader: lo,
          secondary: bytesFmt,
          tip: 'Smallest media file by bytes.',
        })
      : null,
    fileFact({
      group: 'Size',
      label: 'Largest',
      leader: hi,
      secondary: bytesFmt,
      tip: 'Biggest media file by bytes.',
    }),
    resPair
      ? fileFact({
          group: 'Resolution',
          label: 'Lowest',
          leader: loRes,
          secondary: resFmt,
          tip: 'Media file with the fewest pixels.',
        })
      : null,
    hasRes(hiRes)
      ? fileFact({
          group: 'Resolution',
          label: 'Highest',
          leader: hiRes,
          secondary: resFmt,
          tip: 'Media file with the most pixels.',
        })
      : null,
  ]);
  return { key: 'media', title: 'Billboards', tip: SECTION_TIPS.media, overview, facts };
}

function streetsSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  const dirs = m.tree.descendants_dir_count;
  const avgFiles = perEach(m.tree.descendants_file_count, dirs);
  const overview =
    pluralize(dirs, 'street') +
    (avgFiles !== null ? ` · ~${formatCount(avgFiles)} files each` : '');
  const facts = compact([
    dirFact({
      group: 'Standouts',
      label: 'Deepest',
      leader: s.maxDepthDir,
      secondary: (l) => `${l.depth} levels deep`,
      tip: 'Most deeply nested directory.',
    }),
    dirFact({
      group: 'Standouts',
      label: 'Biggest',
      leader: s.maxFilesPerDir,
      secondary: (l) => pluralize(l.file_count, 'building'),
      tip: "Directory holding the most files (excluding the repo root); sets a street's width.",
    }),
  ]);
  return {
    key: 'streets',
    title: 'Streets',
    tip: SECTION_TIPS.streets,
    overview,
    facts,
    note: facts.length ? undefined : 'Everything lives at the root — no sub-directories.',
  };
}

function forestSection(m: Manifest, treesEnabled: boolean): AlmanacSection {
  const trees = m.commits.length;
  const cd = m.stats.commitDates;
  const span = cd.oldest && cd.newest ? humanSpan(cd.oldest, cd.newest) : '';
  const overview = `${pluralize(trees, 'tree')}${span ? ` · ${span} of history` : ''}`;
  const base = { key: 'forest', title: 'Forest', tip: SECTION_TIPS.forest, overview } as const;
  // Canopies fly the camera to a tree; with the Trees layer off those targets
  // don't exist, so the notice lives here (not the view) like any empty state.
  if (!treesEnabled) {
    return {
      ...base,
      facts: [],
      note: 'Enable the Trees layer in Settings to explore the forest.',
    };
  }
  if (trees === 0) {
    return { ...base, facts: [], note: 'No commits yet.' };
  }
  const s = m.stats;
  const facts = compact([
    commitFact({
      group: 'Canopy',
      label: 'Sparsest',
      leader: s.minFilesPerCommit,
      tip: 'Commit that changed the fewest files — the smallest tree.',
    }),
    commitFact({
      group: 'Canopy',
      label: 'Grandest',
      leader: s.maxFilesPerCommit,
      tip: 'Commit that changed the most files — the widest tree.',
    }),
    s.maxCommitsPerDay
      ? statFact({
          group: 'Activity',
          label: 'Busiest',
          primary: formatShortDate(s.maxCommitsPerDay.date),
          secondary: pluralize(s.maxCommitsPerDay.count, 'commit'),
          tip: 'Calendar day with the most commits.',
        })
      : null,
    statFact({
      group: 'Activity',
      label: 'Streak',
      primary: pluralize(s.maxCommitStreakDays, 'consecutive day'),
      tip: 'Longest run of consecutive days with commits.',
    }),
  ]);
  return { ...base, facts };
}

function firefliesSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  const count = s.authors.length;
  const avgCommits = perEach(m.commits.length, count);
  // 'firefly' is irregular, so pluralize (naive +s) won't do.
  const noun = count === 1 ? 'firefly' : 'fireflies';
  const each = avgCommits !== null ? ` · ~${formatCount(avgCommits)} commits each` : '';
  const overview = `${formatCount(count)} ${noun}${each}`;
  const base = {
    key: 'fireflies',
    title: 'Fireflies',
    tip: SECTION_TIPS.fireflies,
    overview,
  } as const;
  if (count === 0) {
    return { ...base, facts: [], note: 'No commits yet — no fireflies.' };
  }
  // authors is pre-sorted descending by commits; [0] is the most active, the
  // last the least. Show the pair (low→high, like the other sections) when
  // there's more than one author, else just the top.
  const most = s.authors[0];
  const least = s.authors[count - 1];
  const mostFact = statFact({
    group: 'Contributors',
    label: 'Most active',
    primary: most.name,
    secondary: pluralize(most.commits, 'commit'),
    tip: 'Author with the most commits — the largest firefly.',
  });
  const facts =
    count >= 2
      ? [
          statFact({
            group: 'Contributors',
            label: 'Least active',
            primary: least.name,
            secondary: pluralize(least.commits, 'commit'),
            tip: 'Author with the fewest commits.',
          }),
          mostFact,
        ]
      : [mostFact];
  return { ...base, facts };
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
