import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { setManifest } from '@/state/stores/manifest';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/progress';
import { TREES } from '@/state/settings/fields/trees';
import { GEM } from '@/state/settings/fields/gem';
import type { Manifest } from '@codecity/city';

// The routing contract: rebuild keys call rebuildScene, refresh keys only flash
// the status (the refresh itself is reactive), live keys do neither.

describe('attachSettingsReactions routing', () => {
  let detach: () => void;
  let rebuildCalls: number;

  beforeEach(() => {
    rebuildCalls = 0;
    REBUILD_STATUS.value = RebuildStatus.Idle;
    // scheduleRebuild gates on MANIFEST (peek) as the "project loaded?" proxy;
    // seed a non-empty manifest so the rebuild path actually calls rebuildScene.
    setManifest({ tree: {} } as unknown as Manifest);
    detach = attachSettingsReactions({
      rebuildScene: async () => {
        rebuildCalls++;
      },
      invalidateLayoutCache: () => {},
    });
  });

  afterEach(() => {
    detach();
    setManifest(null);
  });

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('rebuild-route key change triggers rebuildScene', async () => {
    TREES.value = { ...TREES.value, MIN_HEIGHT: TREES.value.MIN_HEIGHT + 4 };
    await flush();
    expect(rebuildCalls).toBeGreaterThan(0);
  });

  it('refresh-route key change flashes the rebuilding status but does NOT rebuild', async () => {
    const m0 = rebuildCalls;
    TREES.value = { ...TREES.value, COLOR_BUSY_DAY: '#123456' };
    await flush();
    // The flash is synchronous; the min-dwell timer hasn't fired yet.
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Rebuilding);
    expect(rebuildCalls).toBe(m0);
  });

  it('live-route key change triggers neither', async () => {
    const m0 = rebuildCalls;
    const s0 = REBUILD_STATUS.value;
    GEM.value = { ...GEM.value, ROTATION_SPEED: 2.5 };
    await flush();
    expect(rebuildCalls).toBe(m0);
    expect(REBUILD_STATUS.value).toBe(s0);
  });
});
