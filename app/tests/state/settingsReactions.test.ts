import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachCommitReactions } from '@/state/settingsReactions';
import { TREES } from '@/state/stores/settings/trees';
import { GEM } from '@/state/stores/settings/gem';

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
    detach = attachCommitReactions({
      world: {
        getManifest: () => ({}),
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

  afterEach(() => detach());

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
