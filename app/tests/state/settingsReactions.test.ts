import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachCommitReactions } from '@/state/settingsReactions';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { TREES } from '@/state/stores/settings/trees';
import { GEM } from '@/state/stores/settings/gem';
import type { Manifest } from '@/types';

// Routing contract: a "rebuild" key change → world.applyManifest; a "refresh"
// (material) key change → applyTheme only (NOT applyManifest); a "live" key
// (read per-frame, e.g. gem animation) → neither.

describe('attachCommitReactions routing', () => {
  let detach: () => void;
  let manifestCalls: number;
  let themeCalls: number;

  beforeEach(() => {
    manifestCalls = 0;
    themeCalls = 0;
    // scheduleRebuild reads MANIFEST (the source of truth) via peek(); seed a
    // non-empty manifest so the rebuild path actually calls applyManifest.
    setManifest({ tree: {} } as unknown as Manifest);
    detach = attachCommitReactions({
      world: {
        applyManifest: async () => {
          manifestCalls++;
        },
        invalidateLayoutCache: () => {},
      },
      applyTheme: () => {
        themeCalls++;
      },
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

  it('refresh-route key change triggers applyTheme but NOT applyManifest', async () => {
    const m0 = manifestCalls;
    TREES.value = { ...TREES.value, COLOR_BUSY_DAY: '#123456' };
    await flush();
    expect(themeCalls).toBeGreaterThan(0);
    expect(manifestCalls).toBe(m0);
  });

  it('live-route key change triggers neither', async () => {
    const m0 = manifestCalls;
    const t0 = themeCalls;
    GEM.value = { ...GEM.value, ROTATION_SPEED: 2.5 };
    await flush();
    expect(manifestCalls).toBe(m0);
    expect(themeCalls).toBe(t0);
  });
});
