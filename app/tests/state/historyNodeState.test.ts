import { afterEach, expect, test } from 'vitest';
import { NodeKind } from '@/types';
import type { TimelineBundle } from '@/types';
import { TIMELINE_MODE, TIMELINE_BUNDLE, SCRUB_POS } from '@/state/stores/timeline';
import { HISTORY_NODE_STATE, HistoryState } from '@/state/stores/historyNodeState';

// commits 0..3. present.txt lives throughout; gone.txt + old/x.txt are deleted
// at commit 2; future.txt + new/y.txt are first created at commit 3.
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
          name: 'old',
          path: 'old',
          type: NodeKind.Directory,
          children: [{ name: 'x.txt', path: 'old/x.txt', type: NodeKind.File }],
        },
        {
          name: 'new',
          path: 'new',
          type: NodeKind.Directory,
          children: [{ name: 'y.txt', path: 'new/y.txt', type: NodeKind.File }],
        },
        { name: 'future.txt', path: 'future.txt', type: NodeKind.File },
      ],
    },
  },
  // One delta per commit, index-aligned with `commits` (buildPathTimelines keys
  // intervals off the delta array position); commit b has no changes.
  deltas: [
    {
      sha: 'a',
      changes: [
        { path: 'src/present.txt', sha: 's1' },
        { path: 'src/gone.txt', sha: 's1' },
        { path: 'old/x.txt', sha: 's1' },
      ],
    },
    { sha: 'b', changes: [] },
    {
      sha: 'c',
      changes: [
        { path: 'src/gone.txt', sha: null },
        { path: 'old/x.txt', sha: null },
      ],
    },
    {
      sha: 'd',
      changes: [
        { path: 'future.txt', sha: 's1' },
        { path: 'new/y.txt', sha: 's1' },
      ],
    },
  ],
  blobLines: { s1: 2 },
  note: null,
} as unknown as TimelineBundle;

afterEach(() => {
  TIMELINE_MODE.value = false;
  TIMELINE_BUNDLE.value = null;
  SCRUB_POS.value = 0;
});

test('scrub-relative file states + directory aggregation at a mid-history commit', () => {
  TIMELINE_BUNDLE.value = bundle;
  TIMELINE_MODE.value = true;
  SCRUB_POS.value = 2;

  const s = HISTORY_NODE_STATE.value;
  // Files.
  expect(s.get('src/present.txt')).toBe(HistoryState.Present);
  expect(s.get('src/gone.txt')).toBe(HistoryState.Deleted);
  expect(s.get('old/x.txt')).toBe(HistoryState.Deleted);
  expect(s.get('future.txt')).toBe(HistoryState.Future);
  expect(s.get('new/y.txt')).toBe(HistoryState.Future);
  // Dirs inherit the strongest descendant state (present > deleted > future).
  expect(s.get('src')).toBe(HistoryState.Present); // has a present child
  expect(s.get('old')).toBe(HistoryState.Deleted); // all children deleted
  expect(s.get('new')).toBe(HistoryState.Future); // all children not-yet-created
  expect(s.get('')).toBe(HistoryState.Present); // root: some descendant present
});

test('empty outside Timeline mode', () => {
  TIMELINE_BUNDLE.value = bundle;
  TIMELINE_MODE.value = false;
  expect(HISTORY_NODE_STATE.value.size).toBe(0);
});
