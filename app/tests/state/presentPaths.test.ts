import { afterEach, expect, test } from 'vitest';
import { NodeKind } from '@/types';
import type { TimelineBundle } from '@/types';
import { TIMELINE_MODE, TIMELINE_BUNDLE, SCRUB_POS } from '@/state/stores/timeline';
import { PRESENT_PATHS, scrubbedBlobShaFor, scrubbedStatsFor } from '@/state/stores/presentPaths';

// At commit 2: src/present.txt is live; src/gone.txt was deleted at commit 2;
// future/y.txt is first created at commit 3.
const bundle = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
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
          children: [
            { name: 'present.txt', path: 'src/present.txt', type: NodeKind.File },
            { name: 'gone.txt', path: 'src/gone.txt', type: NodeKind.File },
          ],
        },
        {
          name: 'future',
          path: 'future',
          type: NodeKind.Directory,
          children: [{ name: 'y.txt', path: 'future/y.txt', type: NodeKind.File }],
        },
      ],
    },
  },
  deltas: [
    {
      sha: 'a',
      changes: [
        { path: 'src/present.txt', sha: 's1' },
        { path: 'src/gone.txt', sha: 's1' },
      ],
    },
    { sha: 'b', changes: [] },
    { sha: 'c', changes: [{ path: 'src/gone.txt', sha: null }] },
    { sha: 'd', changes: [{ path: 'future/y.txt', sha: 's1' }] },
  ],
  blobLines: { s1: 2 },
  blobSizes: { s1: 0 },
  note: null,
} as unknown as TimelineBundle;

afterEach(() => {
  TIMELINE_MODE.value = false;
  TIMELINE_BUNDLE.value = null;
  SCRUB_POS.value = 0;
});

test('present files + their ancestor dirs are in the set; deleted/future are not', () => {
  TIMELINE_BUNDLE.value = bundle;
  TIMELINE_MODE.value = true;
  SCRUB_POS.value = 2;

  const p = PRESENT_PATHS.value;
  expect(p.has('src/present.txt')).toBe(true);
  expect(p.has('src')).toBe(true); // ancestor of a live file
  expect(p.has('')).toBe(true); // root
  expect(p.has('src/gone.txt')).toBe(false); // deleted
  expect(p.has('future/y.txt')).toBe(false); // not yet created
  expect(p.has('future')).toBe(false); // no live descendant
});

test('empty outside Timeline mode', () => {
  TIMELINE_BUNDLE.value = bundle;
  TIMELINE_MODE.value = false;
  expect(PRESENT_PATHS.value.size).toBe(0);
});

// A file that grows across commits, so an interpolated read differs visibly
// from the discrete one.
const growing = {
  commits: [{ sha: 'a' }, { sha: 'b' }],
  unionManifest: { tree: { name: '', path: '', type: NodeKind.Directory, children: [] } },
  deltas: [
    { sha: 'a', changes: [{ path: 'f.txt', sha: 'small' }] },
    { sha: 'b', changes: [{ path: 'f.txt', sha: 'big' }] },
  ],
  blobLines: { small: 36, big: 46 },
  blobSizes: { small: 100, big: 200 },
  note: null,
} as unknown as TimelineBundle;

test('displayed stats resolve at the same commit the content does, never between', () => {
  TIMELINE_BUNDLE.value = growing;
  TIMELINE_MODE.value = true;
  // Mid-commit: the height curve interpolates here, but the pane shows bytes
  // from one specific blob, so its numbers have to name that same commit.
  SCRUB_POS.value = 0.7;

  expect(scrubbedBlobShaFor('f.txt')).toBe('small');
  expect(scrubbedStatsFor('f.txt')?.lines).toBe(36); // NOT the ~43 a lerp gives
  expect(scrubbedStatsFor('f.txt')?.bytes).toBe(100);

  SCRUB_POS.value = 1;
  expect(scrubbedBlobShaFor('f.txt')).toBe('big');
  expect(scrubbedStatsFor('f.txt')?.lines).toBe(46);
});
