// Regression for the Save-does-nothing bug: world.applyManifest caches
// the prior CityLayout keyed by tree_signature, and a config-only Save
// fires applyManifest with the same manifest → cache hit → reuseLayout
// returns the old positions unchanged. The fix is for configCommitReactions
// to call world.invalidateLayoutCache() before each applyManifest, forcing
// a full worker recompute on every Save commit.
//
// This test stubs the `world` argument to attachCommitReactions with a
// recorder so we can assert ordering:
//   1) invalidateLayoutCache() runs BEFORE applyManifest() on each
//      rebuildStore commit.
//   2) The manifest passed to applyManifest is the current MANIFEST signal
//      (the fetch layer's source of truth), read via peek() at that moment.
//
// Pre-fix: configCommitReactions never called invalidateLayoutCache(),
// so this test fails with `["applyManifest"]` instead of
// `["invalidateLayoutCache", "applyManifest"]`. Post-fix: passes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachCommitReactions } from '@/state/settingsReactions';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { STREET_LAYOUT } from '@/state/stores/settings/streets';
import type { Manifest } from '@/types';

describe('configCommitReactions invalidates layout cache before applyManifest', () => {
  let calls: string[];
  let appliedManifests: unknown[];
  let detach: (() => void) | null;
  let originalChildGap: number;

  beforeEach(() => {
    calls = [];
    appliedManifests = [];
    detach = null;
    originalChildGap = STREET_LAYOUT.value.CHILD_GAP;
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    // Restore so other tests don't see a drifted CHILD_GAP.
    STREET_LAYOUT.value = { ...STREET_LAYOUT.value, CHILD_GAP: originalChildGap };
    setManifest(EMPTY_MANIFEST);
  });

  it('calls world.invalidateLayoutCache() BEFORE world.applyManifest() on a rebuildStore commit', async () => {
    const stubManifest = {
      tree_signature: 'abc',
      tree: { type: 'directory', children: [] },
      dateRanges: { createdMin: null, createdMax: null, modifiedMin: null, modifiedMax: null },
    };
    // Seed the source of truth: scheduleRebuild reads MANIFEST.peek().
    setManifest(stubManifest as unknown as Manifest);

    detach = attachCommitReactions({
      async applyManifest(m: unknown) {
        calls.push('applyManifest');
        appliedManifests.push(m);
      },
      invalidateLayoutCache() {
        calls.push('invalidateLayoutCache');
      },
      applyTheme: () => {},
    });

    // Simulate a Save commit on a rebuildStore: the user edited
    // STREET_LAYOUT.CHILD_GAP and clicked Save → configDrafts.commit()
    // fires setKey on the real store, which triggers our subscription.
    STREET_LAYOUT.value = { ...STREET_LAYOUT.value, CHILD_GAP: originalChildGap + 1 };

    // scheduleRebuild is async; let the microtask queue drain so the
    // applyManifest await resolves before we assert.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // The bug: pre-fix this is `["applyManifest"]` — invalidateLayoutCache
    // never runs, so applyManifest hits the layout cache and reuseLayout
    // returns identical positions. The fix wires invalidateLayoutCache()
    // into scheduleRebuild BEFORE applyManifest.
    expect(calls).toEqual(['invalidateLayoutCache', 'applyManifest']);
    expect(appliedManifests).toEqual([stubManifest]);
  });
});
