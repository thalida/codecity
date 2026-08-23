// Everything the scrub position implies, from one bundle. These used to be two
// files with two near-identical fixtures, which is how the set and the filtered
// tree could have drifted apart without a test noticing.

import { afterEach, expect, test } from 'vitest';
import { NodeKind } from '@/types';
import type { TimelineBundle, TreeNode } from '@/types';
import { RUINS } from '@/city/session/settings/ruins';
import { makeBundle, PRESENCE_BUNDLE } from '../../../_helpers/scrub';
import { makeSession } from '../../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

function paths(m: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode) => {
    if (n.path != null) out.add(n.path);
    for (const c of (n as { children?: TreeNode[] }).children ?? []) walk(c);
  };
  const tree = (m as { tree?: TreeNode })?.tree;
  if (tree) walk(tree);
  return out;
}

function atCommitTwo(): void {
  session.timeline.bundle.value = PRESENCE_BUNDLE;
  session.timeline.mode.value = true;
  session.timeline.setScrubPos(2);
}

afterEach(() => {
  session.timeline.mode.value = false;
  session.timeline.bundle.value = null;
  session.timeline.setScrubPos(0);
});

test('present files + their ancestor dirs are in the set; deleted/future are not', () => {
  atCommitTwo();

  const p = session.timeline.presentPaths.value;
  expect(p.has('src/present.txt')).toBe(true);
  expect(p.has('src')).toBe(true); // ancestor of a live file
  expect(p.has('')).toBe(true); // root
  expect(p.has('src/gone.txt')).toBe(false); // deleted
  expect(p.has('future/y.txt')).toBe(false); // not yet created
  expect(p.has('future')).toBe(false); // no live descendant
});

test('empty outside Timeline mode', () => {
  session.timeline.bundle.value = PRESENCE_BUNDLE;
  session.timeline.mode.value = false;
  expect(session.timeline.presentPaths.value.size).toBe(0);
});

test('the pane tree carries exactly the present set (empty dirs pruned)', () => {
  atCommitTwo();

  const p = paths(session.timeline.paneManifest.value);
  expect(p.has('src/present.txt')).toBe(true);
  expect(p.has('src/gone.txt')).toBe(false); // deleted at commit 2
  expect(p.has('future/y.txt')).toBe(false); // not created until commit 3
  expect(p.has('future')).toBe(false); // dir emptied → dropped
});

test('the pane tree is present-only regardless of the ruins toggle', () => {
  atCommitTwo();
  RUINS.value = { ...RUINS.value, ENABLED: true };

  const p = paths(session.timeline.paneManifest.value);
  expect(p.has('src/gone.txt')).toBe(false);
  expect(p.has('future/y.txt')).toBe(false);
  expect(p.has('src/present.txt')).toBe(true);
});

// f.txt is written at commit 0 and rewritten at commit 3, leaving 1 and 2
// UNCHANGED: the gap where an interpolating read drifts toward the later edit.
const growing = makeBundle({
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
  unionManifest: { tree: { name: '', path: '', type: NodeKind.Directory, children: [] } },
  deltas: [
    { sha: 'a', changes: [{ path: 'f.txt', sha: 'small' }] },
    { sha: 'b', changes: [] },
    { sha: 'c', changes: [] },
    { sha: 'd', changes: [{ path: 'f.txt', sha: 'big' }] },
  ],
  blobLines: { small: 36, big: 46 },
  blobSizes: { small: 100, big: 200 },
} as unknown as Partial<TimelineBundle>);

test('displayed stats describe the blob being served, across unchanged commits', () => {
  session.timeline.bundle.value = growing;
  session.timeline.mode.value = true;

  // Each of these still serves the commit-0 blob, so each must report its
  // numbers: the drift is what put "42 lines" over a 36-line body.
  for (const pos of [0, 0.7, 1, 2, 2.9]) {
    session.timeline.setScrubPos(pos);
    expect(session.timeline.scrubbedBlobShaFor('f.txt')).toBe('small');
    expect(session.timeline.scrubbedStatsFor('f.txt')?.lines).toBe(36);
    expect(session.timeline.scrubbedStatsFor('f.txt')?.bytes).toBe(100);
  }

  session.timeline.setScrubPos(3);
  expect(session.timeline.scrubbedBlobShaFor('f.txt')).toBe('big');
  expect(session.timeline.scrubbedStatsFor('f.txt')?.lines).toBe(46);
  expect(session.timeline.scrubbedStatsFor('f.txt')?.bytes).toBe(200);
});

// ── Folder rollups ───────────────────────────────────────────────────

// a.txt is written at c0 and rewritten at c2; b.md arrives at c1. Nothing is
// ever deleted, so the union IS the state at HEAD and the two must agree there.
const C0 = '2024-01-01T00:00:00Z';
const C1 = '2024-02-01T00:00:00Z';
const C2 = '2024-03-01T00:00:00Z';

const HEAD_SRC_ROLLUPS = {
  children_count: 2,
  children_file_count: 2,
  children_dir_count: 0,
  descendants_count: 2,
  descendants_file_count: 2,
  descendants_dir_count: 0,
  descendants_size: 500, // a.txt 300 at c2 + b.md 200
  descendants_created_min: C0,
  descendants_modified_max: C2,
  // Tied on count, so extension ascending.
  descendants_ext_breakdown: [
    { ext: 'md', count: 1, size: 200 },
    { ext: 'txt', count: 1, size: 300 },
  ],
};

const steady = makeBundle({
  commits: [
    { sha: 'a', date: C0 },
    { sha: 'b', date: C1 },
    { sha: 'c', date: C2 },
  ],
  unionManifest: {
    tree: {
      name: '',
      path: '',
      type: NodeKind.Directory,
      children: [
        {
          name: 'src',
          path: 'src',
          type: NodeKind.Directory,
          ...HEAD_SRC_ROLLUPS,
          children: [
            {
              name: 'a.txt',
              path: 'src/a.txt',
              type: NodeKind.File,
              extension: 'txt',
              size: 300,
              lines: 30,
              created: C0,
              modified: C2,
            },
            {
              name: 'b.md',
              path: 'src/b.md',
              type: NodeKind.File,
              extension: 'md',
              size: 200,
              lines: 20,
              created: C1,
              modified: C1,
            },
          ],
        },
      ],
    },
  },
  deltas: [
    { sha: 'a', changes: [{ path: 'src/a.txt', sha: 'a1' }] },
    { sha: 'b', changes: [{ path: 'src/b.md', sha: 'b1' }] },
    { sha: 'c', changes: [{ path: 'src/a.txt', sha: 'a2' }] },
  ],
  blobLines: { a1: 10, b1: 20, a2: 30 },
  blobSizes: { a1: 100, b1: 200, a2: 300 },
} as unknown as TimelineBundle as Partial<TimelineBundle>);

function rollups(d: unknown): Record<string, unknown> {
  const node = d as Record<string, unknown>;
  return Object.fromEntries(Object.keys(HEAD_SRC_ROLLUPS).map((k) => [k, node[k]]));
}

test('at HEAD the derived rollups equal the ones the backend authored', () => {
  session.timeline.bundle.value = steady;
  session.timeline.mode.value = true;
  session.timeline.setScrubPos(2);

  expect(rollups(session.timeline.scrubbedDirFor('src'))).toEqual(HEAD_SRC_ROLLUPS);
});

test('earlier commits count only what existed, at the size it was then', () => {
  session.timeline.bundle.value = steady;
  session.timeline.mode.value = true;
  session.timeline.setScrubPos(0);

  const d = session.timeline.scrubbedDirFor('src')!;
  expect(d.descendants_file_count).toBe(1); // b.md does not exist yet
  expect(d.descendants_size).toBe(100); // a.txt before its rewrite, not 300
  expect(d.descendants_ext_breakdown).toEqual([{ ext: 'txt', count: 1, size: 100 }]);
});

test('the newest change never runs ahead of the scrub', () => {
  session.timeline.bundle.value = steady;
  session.timeline.mode.value = true;
  session.timeline.setScrubPos(1);

  // The union says a.txt was last touched at C2. Reading that here is what put
  // a future date on a folder you scrubbed into the past.
  expect(session.timeline.scrubbedDirFor('src')!.descendants_modified_max).toBe(C1);
});

test('a deleted file leaves the folder totals, and an emptied folder is gone', () => {
  atCommitTwo();

  const src = session.timeline.scrubbedDirFor('src')!;
  expect(src.descendants_file_count).toBe(1); // gone.txt deleted at this commit
  expect(session.timeline.scrubbedDirFor('future')).toBeNull(); // nothing in it exists yet
});

test('null in Live, where MANIFEST is already the answer', () => {
  session.timeline.bundle.value = steady;
  session.timeline.mode.value = false;
  expect(session.timeline.scrubbedDirFor('src')).toBeNull();
});
