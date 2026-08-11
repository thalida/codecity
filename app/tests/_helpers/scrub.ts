// Fixtures for the Timeline scrub decision. A test states the condition it
// cares about as a literal rather than driving SCRUB_POS and four settings
// stores into position.

import { BUILDINGS } from '@/state/stores/settings/buildings';
import { buildPathTimelines } from '@/city/timeline/replay';
import type { PathTimeline } from '@/city/timeline/replay';
import type { ScrubFrame } from '@/city/timeline/scrubFrame';
import type { BuildingScrubInput } from '@/city/components/buildings/scrubState';
import type { Building, FileNode, RangeStat, TimelineBundle } from '@/types';

export const LINE_STATS: RangeStat = { min: 1, max: 200 };
export const BYTE_STATS: RangeStat = { min: 1, max: 5000 };

/** Ruins and blueprints off, no fade target, zero date spread. */
export function makeScrubFrame(over: Partial<ScrubFrame> = {}): ScrubFrame {
  return {
    pos: 0,
    lineStats: LINE_STATS,
    byteStats: BYTE_STATS,
    ruinsOn: false,
    ruinBuildingOpacity: 0.3,
    ruinHeight: 1.4,
    ruinGrayMix: 0.8,
    futureOn: false,
    futureBuildingOpacity: 0.2,
    futureHeight: 0.2,
    futureTint: 0.7,
    futureColor: { r: 0, g: 0.5, b: 1 },
    nowMs: 0,
    minCreated: 0,
    createdSpread: 0,
    bldgTargetFile: null,
    dirTarget: null,
    hoverFile: null,
    fadeCfg: BUILDINGS.peek(),
    ...over,
  };
}

export function makeFile(over: Partial<FileNode> & { path: string }): FileNode {
  return { lines: 6, size: 500, extension: 'txt', ...over } as unknown as FileNode;
}

export function makeBuilding(file: FileNode, over: Partial<Building> = {}): Building {
  return {
    x: 5,
    y: 7,
    w: 2,
    d: 2,
    h: 1,
    color: '#fff',
    file,
    cellId: 0,
    slotId: 0,
    ...over,
  } as unknown as Building;
}

export function makeBundle(over: Partial<TimelineBundle>): TimelineBundle {
  return {
    unionManifest: { tree: { name: 'r' } },
    blobSizes: {},
    note: null,
    ...over,
  } as unknown as TimelineBundle;
}

/** f.txt: absent at 0, created at 1 with 2 lines, grows to 6 at 2, deleted at 3.
 *  So createdIdx = 1, finalIdx = 3, union lines = 6. */
export const SUBJECT_BUNDLE = makeBundle({
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
  deltas: [
    { sha: 'a', changes: [] },
    { sha: 'b', changes: [{ path: 'f.txt', sha: 's1' }] },
    { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
    { sha: 'd', changes: [{ path: 'f.txt', sha: null }] },
  ],
  blobLines: { s1: 2, s2: 6 },
} as unknown as Partial<TimelineBundle>);

/** The same pairing the scrub pass builds. */
export function makeScrubInput(
  b: Building,
  timelines: Map<string, PathTimeline>
): BuildingScrubInput {
  const pt = timelines.get(b.file.path)!;
  return {
    b,
    pt,
    createdIdx: pt.intervals.length ? pt.intervals[0].start : 0,
    finalIdx: pt.changes.length ? pt.changes[pt.changes.length - 1].i : 0,
  };
}

/** A building + its timeline for one path in a bundle, ready to resolve. */
export function scrubSubject(
  bundle: TimelineBundle,
  file: FileNode,
  over: Partial<Building> = {}
): { b: Building; input: BuildingScrubInput } {
  const b = makeBuilding(file, over);
  return { b, input: makeScrubInput(b, buildPathTimelines(bundle)) };
}
