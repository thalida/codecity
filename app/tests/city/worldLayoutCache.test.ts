// A config-only Save re-applies the same manifest, which hits applyManifest's
// structure_signature cache and returns the old positions. The ordering below
// is the fix: invalidate before applying, so a Save always re-packs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSettingsReactions } from '@/state/settingsReactions';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { STREET_LAYOUT } from '@/state/stores/settings/streets';
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
    setManifest(EMPTY_MANIFEST);
  });

  it('calls world.invalidateLayoutCache() BEFORE world.applyManifest() on a rebuildStore commit', async () => {
    const stubManifest = {
      structure_signature: 'abc',
      layout_signature: 'abc',
      tree: { type: 'directory', children: [] },
      dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
    };
    // Seed the source of truth: scheduleRebuild reads MANIFEST.peek().
    setManifest(stubManifest as unknown as Manifest);

    detach = attachSettingsReactions({
      async rebuildScene() {
        calls.push('rebuildScene');
      },
      invalidateLayoutCache() {
        calls.push('invalidateLayoutCache');
      },
    });

    // Simulate a Save commit on a rebuildStore: the user edited
    // STREET_LAYOUT.BUILDING_GAP and clicked Save → configDrafts.commit()
    // fires setKey on the real store, which triggers our subscription.
    STREET_LAYOUT.value = { ...STREET_LAYOUT.value, BUILDING_GAP: originalChildGap + 1 };

    // scheduleRebuild is async; let the microtask queue drain so the
    // applyManifest await resolves before we assert.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // The bug: pre-fix this is `["rebuildScene"]` — invalidateLayoutCache never
    // runs, so the rebuild hits the layout cache and reuseLayout returns
    // identical positions. The fix runs invalidateLayoutCache() BEFORE the
    // rebuild.
    expect(calls).toEqual(['invalidateLayoutCache', 'rebuildScene']);
  });
});
