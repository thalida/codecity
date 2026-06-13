import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachCommitReactions } from '@/state/settingsReactions';
import { setManifest, REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { TREES } from '@/state/stores/settings/trees';
import { GEM } from '@/state/stores/settings/gem';
import type { Manifest } from '@/types';

// Routing contract: a "rebuild" key change → applyManifest; a "refresh"
// (material) key change → the 'rebuilding' status flash only (NOT applyManifest
// — the actual refresh is reactive via component/postFx effects); a "live" key
// (read per-frame, e.g. gem animation) → neither.

describe('attachCommitReactions routing', () => {
  let detach: () => void;
  let manifestCalls: number;

  beforeEach(() => {
    manifestCalls = 0;
    REBUILD_STATUS.value = RebuildStatus.Idle;
    // scheduleRebuild reads MANIFEST (the source of truth) via peek(); seed a
    // non-empty manifest so the rebuild path actually calls applyManifest.
    setManifest({ tree: {} } as unknown as Manifest);
    detach = attachCommitReactions({
      applyManifest: async () => {
        manifestCalls++;
      },
      invalidateLayoutCache: () => {},
    });
  });

  afterEach(() => {
    detach();
    setManifest(EMPTY_MANIFEST);
  });

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('rebuild-route key change triggers applyManifest', async () => {
    TREES.value = { ...TREES.value, MIN_HEIGHT: TREES.value.MIN_HEIGHT + 4 };
    await flush();
    expect(manifestCalls).toBeGreaterThan(0);
  });

  it('refresh-route key change flashes the rebuilding status but does NOT rebuild', async () => {
    const m0 = manifestCalls;
    TREES.value = { ...TREES.value, COLOR_BUSY_DAY: '#123456' };
    await flush();
    // The flash is synchronous; the min-dwell timer hasn't fired yet.
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Rebuilding);
    expect(manifestCalls).toBe(m0);
  });

  it('live-route key change triggers neither', async () => {
    const m0 = manifestCalls;
    const s0 = REBUILD_STATUS.value;
    GEM.value = { ...GEM.value, ROTATION_SPEED: 2.5 };
    await flush();
    expect(manifestCalls).toBe(m0);
    expect(REBUILD_STATUS.value).toBe(s0);
  });
});
