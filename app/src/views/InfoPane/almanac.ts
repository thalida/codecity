// views/InfoPane/almanac.ts — pure derivation of the Overview tab's almanac:
// repo superlatives mapped from manifest.stats (server-computed leaders). No
// signals, no DOM, no tree walk — this file decides WHAT to show; the UI (how
// to render it) lives in OverviewPane.tsx. Landmark facts carry the key needed
// to fly the camera there.

import { NodeKind } from '@/types';
import type { Manifest, DirNode, FileLeader, DirLeader, CommitLeader } from '@/types';
import { formatShortDate } from '@/utils/dates';
import { formatBytes } from '@/utils/bytes';
import { formatCount, pluralize } from '@/utils/format';

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

export type AlmanacSectionKey = 'buildings' | 'media' | 'data' | 'streets' | 'forest' | 'fireflies';

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

export interface Almanac {
  sections: AlmanacSection[];
}

export interface LayerCue {
  /** The visual property, e.g. "Height". */
  label: string;
  /** The repo-data factor that drives it, e.g. "line count". */
  detail: string;
}

export interface LayerLegend {
  key: AlmanacSectionKey;
  title: string;
  /** One-line "what this layer is". */
  lead: string;
  /** The cue → meaning rows that make up the map key. */
  cues: LayerCue[];
}

// What each world layer encodes, in world-build order. The single source for
// the Legend subtab and the Overview section-header tooltips (composed via
// layerTip), so the two can't drift. Kept to the salient, viewer-noticeable
// encodings, not every downstream shader detail.
export const LAYER_LEGEND: LayerLegend[] = [
  {
    key: 'buildings',
    title: 'Buildings',
    lead: 'Every file is a building',
    cues: [
      { label: 'Height', detail: 'line count' },
      { label: 'Footprint', detail: 'file size' },
      { label: 'Color & roof icon', detail: 'file type' },
      { label: 'Brightness', detail: 'how recently it changed' },
      { label: 'Grime', detail: "how long it's existed" },
      { label: 'Flat slab', detail: 'an empty file: no walls, no windows' },
    ],
  },
  {
    key: 'media',
    title: 'Billboards',
    lead: 'Image and video files wear themselves as a billboard facade',
    cues: [
      { label: 'Shape', detail: "the file's aspect ratio" },
      { label: 'Width', detail: 'file size' },
      { label: 'Video', detail: 'adds a play button' },
    ],
  },
  {
    key: 'data',
    title: 'Data',
    lead: 'Binary files are windowless, wearing a fingerprint of their bytes',
    cues: [
      { label: 'Size', detail: 'file size (both footprint and height)' },
      { label: 'Facade', detail: "a fingerprint of the file's bytes" },
    ],
  },
  {
    key: 'streets',
    title: 'Streets',
    lead: 'Directories are streets',
    cues: [
      { label: 'Width', detail: 'how many files it holds' },
      { label: 'Length', detail: 'how much it contains' },
      { label: 'Label', detail: 'the directory name' },
    ],
  },
  {
    key: 'forest',
    title: 'Forest',
    lead: 'Each commit plants a tree',
    cues: [
      { label: 'Height', detail: 'older commits grow taller' },
      { label: 'Canopy', detail: 'wider for bigger commits' },
      { label: 'Color', detail: "how busy the commit's day was" },
      { label: 'Position', detail: 'older commits sit nearer the center' },
    ],
  },
  {
    key: 'fireflies',
    title: 'Fireflies',
    lead: 'Each commit author is a firefly, orbiting the trees (commits) they touched',
    cues: [
      { label: 'Color', detail: 'unique per author' },
      { label: 'Size', detail: 'how many commits they made' },
    ],
  },
];

const LAYER_BY_KEY = Object.fromEntries(LAYER_LEGEND.map((l) => [l.key, l])) as Record<
  AlmanacSectionKey,
  LayerLegend
>;

/** The layer's encodings as one tooltip string: the lead sentence followed by
 *  its cue → meaning pairs. */
function layerTip(l: LayerLegend): string {
  return `${l.lead}. ${l.cues.map((c) => `${c.label}: ${c.detail}`).join('; ')}.`;
}

/** A section's shared header — key, display title, and composed encoding tip —
 *  all read from LAYER_LEGEND. */
function layerHeader(key: AlmanacSectionKey): {
  key: AlmanacSectionKey;
  title: string;
  tip: string;
} {
  const l = LAYER_BY_KEY[key];
  return { key, title: l.title, tip: layerTip(l) };
}

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

const SHORT_SHA_LEN = 7;

/** A commit shown by its date rather than its sha: for the history's ends, when
 *  it happened is the point. Still a landmark, so the row flies you to the tree
 *  like every other commit row. */
function commitDateFact(o: {
  label: string;
  leader: CommitLeader | null;
  tip: string;
  group?: string;
}): AlmanacFact | null {
  if (!o.leader) return null;
  return {
    label: o.label,
    primary: formatShortDate(o.leader.date),
    secondary: o.leader.sha.slice(0, SHORT_SHA_LEN),
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
      tip: "Earliest-created file, by git history: the city's founding structure.",
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
      tip: 'File whose last commit is the oldest: the dimmest building.',
    }),
    fileFact({
      group: 'Last touched',
      label: 'Freshest',
      leader: s.newestModifiedFile,
      secondary: (l) => formatShortDate(l.modified),
      tip: "File with the newest commit: the date that drives a building's brightness.",
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
  if (s.dirtyFileCount > 0) {
    facts.push(
      statFact({
        label: 'Uncommitted',
        primary: pluralize(s.dirtyFileCount, 'file'),
        tip: 'Files with uncommitted changes: their buildings glow at their working-tree recency, not their last commit.',
      })
    );
  }
  // Buildings = code files; media (billboards) and binaries (data blocks) each
  // render in their own section.
  return {
    ...layerHeader('buildings'),
    facts,
    note: facts.length ? undefined : 'No code files yet',
  };
}

function mediaSection(m: Manifest): AlmanacSection {
  // Media files render as billboards (image/video billboards) sized by aspect,
  // not lines — a separate class of building with its own superlatives.
  const s = m.stats;
  if (s.mediaCount === 0) {
    return {
      ...layerHeader('media'),
      facts: [],
      note: 'No images or videos',
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
  // No spread (typically a single billboard): one row under a "Spotlight" group
  // with the file's size + resolution combined — rather than two lopsided
  // one-item Size/Resolution groups that read as broken pairs.
  if (!sizePair && !resPair && hi) {
    const dims = hasRes(hiRes) ? ` · ${resFmt(hiRes)}` : '';
    return {
      ...layerHeader('media'),
      facts: compact([
        fileFact({
          group: 'Spotlight',
          label: 'Only',
          leader: hi,
          secondary: (l) => `${bytesFmt(l)}${dims}`,
          tip: 'The only billboard: its byte size and pixel resolution.',
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
  return { ...layerHeader('media'), facts };
}

function dataSection(m: Manifest): AlmanacSection {
  // Binary files render as windowless data blocks sized by bytes, not lines —
  // their own class, with byte-only superlatives (no line/resolution axis).
  const s = m.stats;
  if (s.binaryCount === 0) {
    return { ...layerHeader('data'), facts: [], note: 'No binary files' };
  }
  const bytesFmt = (l: FileLeader) => formatBytes(l.bytes);
  // Pair only when the endpoints are genuinely different files (a one-binary
  // repo would otherwise repeat the same file as Smallest and Largest).
  const lo = s.minBinaryBytesFile;
  const hi = s.maxBinaryBytesFile;
  const sizePair = !!(lo && hi && lo.path !== hi.path);
  const facts = compact([
    sizePair
      ? fileFact({
          group: 'Size',
          label: 'Smallest',
          leader: lo,
          secondary: bytesFmt,
          tip: 'Smallest binary file by bytes.',
        })
      : null,
    fileFact({
      group: 'Size',
      label: 'Largest',
      leader: hi,
      secondary: bytesFmt,
      tip: "Biggest binary file by bytes; a data block's size sets its footprint.",
    }),
  ]);
  return { ...layerHeader('data'), facts };
}

function streetsSection(m: Manifest): AlmanacSection {
  const s = m.stats;
  // Street size = direct children (files + sub-dirs on that street), not total
  // descendants. 'child'/'children' is irregular, so format it by hand.
  const childCount = (l: DirLeader) =>
    `${formatCount(l.children)} ${l.children === 1 ? 'child' : 'children'}`;
  const facts = compact([
    // Age first, matching the buildings section: a street's dates are its
    // subtree's, so these name the street that holds the oldest or newest file
    // rather than every parent above it.
    dirFact({
      group: 'Age',
      label: 'Oldest',
      leader: s.oldestCreatedDir,
      secondary: (l) => (l.created ? formatShortDate(l.created) : ''),
      tip: 'Street holding the oldest file in the project.',
    }),
    dirFact({
      group: 'Age',
      label: 'Newest',
      leader: s.newestCreatedDir,
      secondary: (l) => (l.created ? formatShortDate(l.created) : ''),
      tip: 'Street whose oldest file is the most recent: the newest part of town.',
    }),
    dirFact({
      group: 'Depth',
      label: 'Deepest',
      leader: s.maxDepthDir,
      secondary: (l) => `${l.depth} levels deep`,
      tip: 'Most deeply nested directory.',
    }),
    dirFact({
      group: 'Size',
      label: 'Smallest',
      leader: s.minChildrenDir,
      secondary: childCount,
      tip: 'Directory with the fewest direct children (ties broken by fewest descendants): the quietest street.',
    }),
    dirFact({
      group: 'Size',
      label: 'Biggest',
      leader: s.maxChildrenDir,
      secondary: childCount,
      tip: 'Directory with the most direct children: files and sub-directories on that street.',
    }),
  ]);
  return {
    ...layerHeader('streets'),
    facts,
    note: facts.length ? undefined : 'Everything lives at the root, with no sub-directories',
  };
}

function forestSection(m: Manifest, treesEnabled: boolean): AlmanacSection {
  const trees = m.commits.length;
  const base = layerHeader('forest');
  // Canopies fly the camera to a tree; with the Trees layer off those targets
  // don't exist, so the notice lives here (not the view) like any empty state.
  if (!treesEnabled) {
    return {
      ...base,
      facts: [],
      note: 'Enable the Trees layer in Settings to explore the forest',
    };
  }
  if (trees === 0) {
    return { ...base, facts: [], note: 'No commits yet' };
  }
  const s = m.stats;
  const facts = compact([
    commitDateFact({
      group: 'History',
      label: 'First',
      leader: s.oldestCommit,
      tip: 'Oldest commit: the tree at the heart of the forest.',
    }),
    commitDateFact({
      group: 'History',
      label: 'Latest',
      leader: s.newestCommit,
      tip: 'Newest commit: the tree at the forest edge.',
    }),
    commitFact({
      group: 'Canopy',
      label: 'Sparsest',
      leader: s.minFilesPerCommit,
      tip: 'Commit that changed the fewest files: the smallest tree.',
    }),
    commitFact({
      group: 'Canopy',
      label: 'Grandest',
      leader: s.maxFilesPerCommit,
      tip: 'Commit that changed the most files: the widest tree.',
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
  const base = layerHeader('fireflies');
  if (count === 0) {
    return { ...base, facts: [], note: 'No commits yet, so no fireflies' };
  }
  // authors is pre-sorted descending by commits; [0] is the most active, the
  // last the least. Lead with the most active, then pair the least below it
  // when there's more than one author.
  const most = s.authors[0];
  const least = s.authors[count - 1];
  const mostFact = statFact({
    group: 'Contributors',
    label: 'Most active',
    primary: most.name,
    secondary: pluralize(most.commits, 'commit'),
    tip: 'Author with the most commits: the largest firefly.',
  });
  const facts =
    count >= 2
      ? [
          mostFact,
          statFact({
            group: 'Contributors',
            label: 'Least active',
            primary: least.name,
            secondary: pluralize(least.commits, 'commit'),
            tip: 'Author with the fewest commits.',
          }),
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
    dataSection(m),
    streetsSection(m),
    forestSection(m, treesEnabled),
    firefliesSection(m),
  ];
  return { sections };
}
