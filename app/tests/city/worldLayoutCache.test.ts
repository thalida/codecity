// A config-only Save re-applies the same manifest, which hits applyManifest's
// structure_signature cache and returns the old positions. The ordering below
// is the fix: invalidate before applying, so a Save always re-packs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { setManifest } from '@/state/stores/manifest';
import { WORLD_BUILD_REPORTER } from '@/state/stores/progress';
import { STREET_LAYOUT } from '@/state/settings/fields/streets';
import type { Manifest } from '@/types';

describe('attachSettingsReactions invalidates layout cache before applyManifest', () => {
  let calls: string[];
  let detach: (() => void) | null;
  let originalChildGap: number;

  beforeEach(() => {
    calls = [];
    detach = null;
    originalChildGap = STREET_LAYOUT.value.BUILDING_GAP;
  });

  afterEach(() => {
    if (detach) detach();
    detach = null;
    // Restore so other tests don't see a drifted BUILDING_GAP.
    STREET_LAYOUT.value = { ...STREET_LAYOUT.value, BUILDING_GAP: originalChildGap };
    setManifest(null);
  });

  it('calls world.invalidateLayoutCache() BEFORE world.applyManifest() on a rebuildStore commit', async () => {
    const stubManifest = {
      structure_signature: 'abc',
      layout_signature: 'abc',
      tree: { type: 'directory', children: [] },
      dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
    };
    // Seed the source of truth: scheduleRebuild skips a city showing nothing.
    setManifest(stubManifest as unknown as Manifest);

    detach = attachSettingsReactions({
      async rebuildScene() {
        calls.push('rebuildScene');
      },
      invalidateLayoutCache() {
        calls.push('invalidateLayoutCache');
      },
      currentManifest: () => stubManifest as unknown as Manifest,
      report: WORLD_BUILD_REPORTER,
    });

    // What Save does: commit() fires setKey on the real store, which is what
    // this subscription sees.
    STREET_LAYOUT.value = { ...STREET_LAYOUT.value, BUILDING_GAP: originalChildGap + 1 };

    // scheduleRebuild is async; let the microtask queue drain so the
    // applyManifest await resolves before we assert.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Pre-fix this was ["rebuildScene"] alone, so the rebuild hit the cache and
    // reuseLayout handed back identical positions.
    expect(calls).toEqual(['invalidateLayoutCache', 'rebuildScene']);
  });
});
