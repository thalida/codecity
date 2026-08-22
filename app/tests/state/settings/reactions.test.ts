import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { RebuildStatus } from '@/state/stores/progress';
import { TREES } from '@/state/settings/fields/trees';
import { GEM } from '@/state/settings/fields/gem';
import type { Manifest } from '@/types';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

// The routing contract: rebuild keys call rebuildScene, refresh keys only flash
// the status (the refresh itself is reactive), live keys do neither.

describe('attachSettingsReactions routing', () => {
  let detach: () => void;
  let rebuildCalls: number;

  beforeEach(() => {
    rebuildCalls = 0;
    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    // scheduleRebuild gates on the city's own manifest; seed one so the rebuild
    // path actually calls rebuildScene.
    const manifest = { tree: {} } as unknown as Manifest;
    session.manifest.set(manifest);
    detach = attachSettingsReactions({
      scene: {
        manifest: signal(manifest),
        repack: async () => {
          rebuildCalls++;
        },
        invalidateLayoutCache: () => {},
      },
      report: session.progress,
    });
  });

  afterEach(() => {
    detach();
    session.manifest.set(null);
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
    expect(session.progress.rebuildStatus.value).toBe(RebuildStatus.Rebuilding);
    expect(rebuildCalls).toBe(m0);
  });

  it('live-route key change triggers neither', async () => {
    const m0 = rebuildCalls;
    const s0 = session.progress.rebuildStatus.value;
    GEM.value = { ...GEM.value, ROTATION_SPEED: 2.5 };
    await flush();
    expect(rebuildCalls).toBe(m0);
    expect(session.progress.rebuildStatus.value).toBe(s0);
  });
});
