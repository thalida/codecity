// A rebuild-routed setting re-packs the city that holds it. The host used to do
// this — watch its own signals, then hand a city a manifest — which meant the
// second city on a page got the first one's, and the layout cache had to be
// invalidated from outside. A city answers for itself now.

import { describe, it, expect } from 'vitest';
import { createSettingsStore } from '../src/settings/store';
import { ChangeRoute } from '../src/settings/schema';
import { CITY_FIELDS } from '../src/settings';

describe('a settings change, by route', () => {
  it('tells rebuild listeners when a rebuild-routed field moves', () => {
    const settings = createSettingsStore();
    const calls: string[] = [];
    settings.onRoute(ChangeRoute.Rebuild, () => calls.push('rebuild'));
    settings.onRoute(ChangeRoute.Refresh, () => calls.push('refresh'));

    // BUILDING_GAP is the packer's, so moving it re-packs.
    expect(CITY_FIELDS.STREET_LAYOUT.BUILDING_GAP.route).toBe(ChangeRoute.Rebuild);
    settings.update({ STREET_LAYOUT: { BUILDING_GAP: settings.STREET_LAYOUT.BUILDING_GAP + 1 } });

    expect(calls).toEqual(['rebuild']);
  });

  // The crux: a store carries fields on different routes, so a colour moving
  // must not cost the seconds a re-pack costs.
  it('does not tell them when a refresh-routed field on the same store moves', () => {
    const settings = createSettingsStore();
    const calls: string[] = [];
    settings.onRoute(ChangeRoute.Rebuild, () => calls.push('rebuild'));
    settings.onRoute(ChangeRoute.Refresh, () => calls.push('refresh'));

    expect(CITY_FIELDS.STREETS.ASPHALT_COLOR.route).toBe(ChangeRoute.Refresh);
    settings.update({ STREETS: { ASPHALT_COLOR: '#123456' } });

    expect(calls).toEqual(['refresh']);
  });

  it('says nothing when the value written is the one already there', () => {
    const settings = createSettingsStore();
    const calls: string[] = [];
    settings.onRoute(ChangeRoute.Rebuild, () => calls.push('rebuild'));

    settings.update({ STREET_LAYOUT: { BUILDING_GAP: settings.STREET_LAYOUT.BUILDING_GAP } });

    expect(calls).toEqual([]);
  });

  // Unlike `on`, which reports state a listener has to match: firing this at
  // construction would claim a change that never happened.
  it('does not fire on subscribe', () => {
    const settings = createSettingsStore();
    const calls: string[] = [];
    settings.onRoute(ChangeRoute.Rebuild, () => calls.push('rebuild'));
    expect(calls).toEqual([]);
  });

  // Per city: two cities on a page hold their own values and their own
  // listeners, and one being saved is not the other being saved.
  it('tells only the city whose settings moved', () => {
    const scene = createSettingsStore();
    const backdrop = createSettingsStore();
    const heard: string[] = [];
    scene.onRoute(ChangeRoute.Rebuild, () => heard.push('scene'));
    backdrop.onRoute(ChangeRoute.Rebuild, () => heard.push('backdrop'));

    scene.update({ STREET_LAYOUT: { BUILDING_GAP: scene.STREET_LAYOUT.BUILDING_GAP + 1 } });

    expect(heard).toEqual(['scene']);
  });
});
