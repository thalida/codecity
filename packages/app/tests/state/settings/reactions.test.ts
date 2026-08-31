// What is left of the app's settings reactions: the brief flash on a Save the scene answers by
// refreshing its materials in place. There is no build behind such a Save — nothing re-packs —
// so no city event reports it, and the readout would otherwise show nothing at all for a
// change the reader just made. The city says WHICH route moved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChangeRoute } from '@codecity/city';
import { settingsStore } from '@codecity/city/testing';
import { attachSettingsReactions } from '@/features/settings/state/reactions';
import { HOST_WORK } from '@/features/city/state/readout';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the refresh flash', () => {
  let detach: () => void;
  let settings: ReturnType<typeof settingsStore>;

  beforeEach(() => {
    HOST_WORK.value = { busy: false, error: null };
    settings = settingsStore();
    detach = attachSettingsReactions({ settings });
  });

  afterEach(() => {
    detach();
    HOST_WORK.value = { busy: false, error: null };
  });

  it('flashes when a refresh-routed field changes', async () => {
    settings.update({ STREETS: { ASPHALT_COLOR: '#123456' } });
    await flush();
    expect(HOST_WORK.value.busy).toBe(true);
  });

  // The city reports its own re-pack through build:start/done, which moves the
  // readout then. Flashing here too would fight it.
  it('says nothing when a rebuild-routed field changes', async () => {
    settings.update({
      STREET_LAYOUT: { BUILDING_GAP: settings.STREET_LAYOUT.BUILDING_GAP + 40 },
    });
    await flush();
    expect(HOST_WORK.value.busy).toBe(false);
  });

  it('settles back to idle on its own', async () => {
    settings.update({ STREETS: { ASPHALT_COLOR: '#654321' } });
    await flush();
    expect(HOST_WORK.value.busy).toBe(true);

    await new Promise<void>((r) => setTimeout(r, 300));
    expect(HOST_WORK.value.busy).toBe(false);
  });

  it('stops flashing once detached', async () => {
    detach();
    detach = () => {};
    settings.update({ STREETS: { ASPHALT_COLOR: '#abcdef' } });
    await flush();
    expect(HOST_WORK.value.busy).toBe(false);
  });

  // Unlike a signals effect, which runs the moment it is created: the flag that
  // used to suppress that first call is gone with it.
  it('does not flash merely for being attached', async () => {
    detach();
    HOST_WORK.value = { busy: false, error: null };
    detach = attachSettingsReactions({ settings: settingsStore() });
    await flush();
    expect(HOST_WORK.value.busy).toBe(false);
  });

  // Two cities, two settings stores: a Save on one is not a Save on the other.
  it('flashes only for the city it was attached to', async () => {
    const other = settingsStore();
    other.update({ STREETS: { ASPHALT_COLOR: '#0f0f0f' } });
    await flush();
    expect(HOST_WORK.value.busy).toBe(false);

    expect(ChangeRoute.Refresh).toBe('refresh');
  });
});
