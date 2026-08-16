// Everything the scrub position implies, from one bundle. These used to be two
// files with two near-identical fixtures, which is how the set and the filtered
// tree could have drifted apart without a test noticing.

import { afterEach, expect, test } from 'vitest';
import { NodeKind } from '@/types';
import type { TimelineBundle, TreeNode } from '@/types';
import { TIMELINE_MODE, TIMELINE_BUNDLE, setScrubPos } from '@/state/stores/timeline';
import { RUINS } from '@/state/stores/settings/ruins';
import {
  PRESENT_PATHS,
  PANE_MANIFEST,
  scrubbedBlobShaFor,
  scrubbedStatsFor,
} from '@/state/stores/scrub';
import { makeBundle, PRESENCE_BUNDLE } from '../_helpers/scrub';

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
  TIMELINE_BUNDLE.value = PRESENCE_BUNDLE;
  TIMELINE_MODE.value = true;
  setScrubPos(2);
}

afterEach(() => {
  TIMELINE_MODE.value = false;
  TIMELINE_BUNDLE.value = null;
  setScrubPos(0);
});

test('present files + their ancestor dirs are in the set; deleted/future are not', () => {
  atCommitTwo();

  const p = PRESENT_PATHS.value;
  expect(p.has('src/present.txt')).toBe(true);
  expect(p.has('src')).toBe(true); // ancestor of a live file
  expect(p.has('')).toBe(true); // root
  expect(p.has('src/gone.txt')).toBe(false); // deleted
  expect(p.has('future/y.txt')).toBe(false); // not yet created
  expect(p.has('future')).toBe(false); // no live descendant
});

test('empty outside Timeline mode', () => {
  TIMELINE_BUNDLE.value = PRESENCE_BUNDLE;
  TIMELINE_MODE.value = false;
  expect(PRESENT_PATHS.value.size).toBe(0);
});

test('the pane tree carries exactly the present set (empty dirs pruned)', () => {
  atCommitTwo();

  const p = paths(PANE_MANIFEST.value);
  expect(p.has('src/present.txt')).toBe(true);
  expect(p.has('src/gone.txt')).toBe(false); // deleted at commit 2
  expect(p.has('future/y.txt')).toBe(false); // not created until commit 3
  expect(p.has('future')).toBe(false); // dir emptied → dropped
});

test('the pane tree is present-only regardless of the ruins toggle', () => {
  atCommitTwo();
  RUINS.value = { ...RUINS.value, ENABLED: true };

  const p = paths(PANE_MANIFEST.value);
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
  TIMELINE_BUNDLE.value = growing;
  TIMELINE_MODE.value = true;

  // Each of these still serves the commit-0 blob, so each must report its
  // numbers: the drift is what put "42 lines" over a 36-line body.
  for (const pos of [0, 0.7, 1, 2, 2.9]) {
    setScrubPos(pos);
    expect(scrubbedBlobShaFor('f.txt')).toBe('small');
    expect(scrubbedStatsFor('f.txt')?.lines).toBe(36);
    expect(scrubbedStatsFor('f.txt')?.bytes).toBe(100);
  }

  setScrubPos(3);
  expect(scrubbedBlobShaFor('f.txt')).toBe('big');
  expect(scrubbedStatsFor('f.txt')?.lines).toBe(46);
  expect(scrubbedStatsFor('f.txt')?.bytes).toBe(200);
});
