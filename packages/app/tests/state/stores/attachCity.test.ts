// One call puts a city onto this app's state. There were five, in four modules,
// and a host mounting a canvas had to know all five existed and unsubscribe
// each — which is a checklist, and a checklist is a thing you can be one item
// short of.

import { describe, it, expect } from 'vitest';
import { createEmitter, settingsStore, statusFrom } from '@codecity/city/testing';
import { CityLifecycle, ScanPhase } from '@codecity/city';
import type { City } from '@codecity/city';
import { attachCity } from '@/state/stores/attachCity';
import {
  CITY_STATUS,
  LOADING_SOURCE,
  PENDING_SOURCE_LABEL,
  HOST_WORK,
} from '@/state/stores/progress';
import { CITY_HOVER } from '@/state/stores/city';
import { EMPTY_CITY_STATUS } from '@codecity/city';

/** A city with the pieces attachCity subscribes to, and nothing else. */
function fakeCity() {
  const events = createEmitter();
  const settings = settingsStore();
  const tracked = statusFrom(events);
  const city = {
    on: events.on,
    settings,
    get status() {
      return tracked.status;
    },
    onStatus: tracked.onStatus,
  } as unknown as City;
  return { city, events, settings, dispose: tracked.dispose };
}

describe('attachCity', () => {
  it('mirrors what the city is doing', () => {
    CITY_STATUS.value = EMPTY_CITY_STATUS;
    const f = fakeCity();
    const off = attachCity(f.city);

    f.events.emit('scan:start', { src: '/repo' });

    expect(CITY_STATUS.value.lifecycle).toBe(CityLifecycle.Loading);
    off();
    f.dispose();
  });

  it('mirrors what the reader is pointing at', () => {
    const f = fakeCity();
    const off = attachCity(f.city);

    f.events.emit('hover', { target: null });

    expect(CITY_HOVER.value).toBeNull();
    off();
    f.dispose();
  });

  it('mirrors what came back off the wire', () => {
    LOADING_SOURCE.value = null;
    PENDING_SOURCE_LABEL.value = null;
    const f = fakeCity();
    const off = attachCity(f.city);

    f.events.emit('scan:start', { src: 'https://github.com/o/r' });
    f.events.emit('scan:label', { label: 'o/r' });

    expect(LOADING_SOURCE.value).not.toBeNull();
    expect(PENDING_SOURCE_LABEL.value).toBe('o/r');
    off();
    f.dispose();
    LOADING_SOURCE.value = null;
    PENDING_SOURCE_LABEL.value = null;
  });

  it('flashes for a Save the city answers in place', async () => {
    HOST_WORK.value = { busy: false, error: null };
    const f = fakeCity();
    const off = attachCity(f.city);

    f.settings.update({ STREETS: { ASPHALT_COLOR: '#123456' } });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(HOST_WORK.value.busy).toBe(true);
    off();
    f.dispose();
    HOST_WORK.value = { busy: false, error: null };
  });

  // The whole point of returning ONE unsubscribe: five of them is a checklist.
  it('takes all of it back at once', async () => {
    CITY_STATUS.value = EMPTY_CITY_STATUS;
    HOST_WORK.value = { busy: false, error: null };
    const f = fakeCity();
    attachCity(f.city)();

    f.events.emit('scan:start', { src: '/repo' });
    f.events.emit('scan:label', { label: 'ghost' });
    f.events.emit('hover', { target: null });
    f.settings.update({ STREETS: { ASPHALT_COLOR: '#654321' } });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(CITY_STATUS.value).toBe(EMPTY_CITY_STATUS);
    expect(PENDING_SOURCE_LABEL.value).not.toBe('ghost');
    expect(HOST_WORK.value.busy).toBe(false);
    f.dispose();
  });

  // A wallpaper is a city with no chrome: it is simply never attached, which is
  // what keeps its build off the readout above the project being read.
  it('leaves a city it was never given alone', () => {
    CITY_STATUS.value = EMPTY_CITY_STATUS;
    const scene = fakeCity();
    const backdrop = fakeCity();
    const off = attachCity(scene.city);

    backdrop.events.emit('scan:start', { src: '/other' });
    backdrop.events.emit('scan:manifest', {
      manifest: { pending: [] } as never,
      phase: ScanPhase.CompleteManifest,
    });

    expect(CITY_STATUS.value.lifecycle).toBe(CityLifecycle.Empty);
    off();
    scene.dispose();
    backdrop.dispose();
  });
});
