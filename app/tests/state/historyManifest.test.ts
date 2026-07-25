import { afterEach, expect, test } from 'vitest';
import { NodeKind } from '@/types';
import type { TimelineBundle, TreeNode } from '@/types';
import { TIMELINE_MODE, TIMELINE_BUNDLE, SCRUB_POS } from '@/state/stores/timeline';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { HISTORY_MANIFEST } from '@/state/stores/historyManifest';

// At commit 2: present.txt present, gone.txt deleted, future/y.txt not yet created.
const bundle = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
  unionManifest: {
    tree: {
      name: '',
      path: '',
      type: NodeKind.Directory,
      children: [
        { name: 'present.txt', path: 'present.txt', type: NodeKind.File },
        { name: 'gone.txt', path: 'gone.txt', type: NodeKind.File },
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
        { path: 'present.txt', sha: 's1' },
        { path: 'gone.txt', sha: 's1' },
      ],
    },
    { sha: 'b', changes: [] },
    { sha: 'c', changes: [{ path: 'gone.txt', sha: null }] },
    { sha: 'd', changes: [{ path: 'future/y.txt', sha: 's1' }] },
  ],
  blobLines: { s1: 2 },
  blobSizes: { s1: 0 },
  note: null,
} as unknown as TimelineBundle;

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

afterEach(() => {
  TIMELINE_MODE.value = false;
  TIMELINE_BUNDLE.value = null;
  SCRUB_POS.value = 0;
});

test('only present-at-scrub paths survive (deleted + future dropped, empty dirs pruned)', () => {
  TIMELINE_BUNDLE.value = bundle;
  TIMELINE_MODE.value = true;
  SCRUB_POS.value = 2;

  const p = paths(HISTORY_MANIFEST.value);
  expect(p.has('present.txt')).toBe(true);
  expect(p.has('gone.txt')).toBe(false); // deleted at commit 2
  expect(p.has('future/y.txt')).toBe(false); // not created until commit 3
  expect(p.has('future')).toBe(false); // dir emptied → dropped
});

test('present-only regardless of the ruins / future toggles', () => {
  TIMELINE_BUNDLE.value = bundle;
  TIMELINE_MODE.value = true;
  SCRUB_POS.value = 2;
  RUINS.value = { ...RUINS.value, ENABLED: true };
  BLUEPRINTS.value = { ...BLUEPRINTS.value, ENABLED: true };

  const p = paths(HISTORY_MANIFEST.value);
  expect(p.has('gone.txt')).toBe(false);
  expect(p.has('future/y.txt')).toBe(false);
  expect(p.has('present.txt')).toBe(true);
});
