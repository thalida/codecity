// What is left of the app's settings reactions: the brief "rebuilding" flash on
// a Save the scene answers by refreshing its materials in place. The rebuild
// half is the city's — it holds the values, knows which of its own fields moved
// and what each route costs, and holds the manifest it is showing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { REBUILD_STATUS, RebuildStatus, markIdle } from '@/state/stores/progress';
import { CITY_STORES } from '@/state/settings/values/city';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the refresh flash', () => {
  let detach: () => void;
  let asphalt: string;
  let gap: number;

  beforeEach(() => {
    markIdle();
    asphalt = CITY_STORES.STREETS.value.ASPHALT_COLOR;
    gap = CITY_STORES.STREET_LAYOUT.value.BUILDING_GAP;
    detach = attachSettingsReactions();
  });

  afterEach(() => {
    detach();
    // Restore, so a drifted value is not the next test's starting point.
    CITY_STORES.STREETS.value = { ...CITY_STORES.STREETS.value, ASPHALT_COLOR: asphalt };
    CITY_STORES.STREET_LAYOUT.value = {
      ...CITY_STORES.STREET_LAYOUT.value,
      BUILDING_GAP: gap,
    };
    markIdle();
  });

  it('flashes when a refresh-routed field changes', async () => {
    CITY_STORES.STREETS.value = { ...CITY_STORES.STREETS.value, ASPHALT_COLOR: '#123456' };
    await flush();
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Rebuilding);
  });

  // The city reports its own re-pack through build:start/done, which is what
  // moves the status then. Flashing here too would fight it.
  it('says nothing when a rebuild-routed field changes', async () => {
    CITY_STORES.STREET_LAYOUT.value = {
      ...CITY_STORES.STREET_LAYOUT.value,
      BUILDING_GAP: gap + 1,
    };
    await flush();
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle);
  });

  it('settles back to idle on its own', async () => {
    CITY_STORES.STREETS.value = { ...CITY_STORES.STREETS.value, ASPHALT_COLOR: '#654321' };
    await flush();
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Rebuilding);

    await new Promise<void>((r) => setTimeout(r, 300));
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle);
  });

  it('stops flashing once detached', async () => {
    detach();
    CITY_STORES.STREETS.value = { ...CITY_STORES.STREETS.value, ASPHALT_COLOR: '#abcdef' };
    await flush();
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle);
    detach = () => {};
  });
});
