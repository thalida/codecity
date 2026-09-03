// What this app says ABOUT the city it is showing. Not what the city says —
// that is the city's own status, which the chrome reads directly. This is the
// readout's own half: the flash for a Save the city answers by refreshing
// materials, where nothing rebuilds and the Save would otherwise look ignored.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { CityProvider } from '@codecity/city/preact';
import { fakeCity } from '@codecity/city/testing';

import { useCityReport } from '@/features/city/hooks/useCityReport';
import { HOST_WORK } from '@/features/city/state/readout';
import { drainAsync } from '../../../_helpers/preact';

function Report() {
  useCityReport(null);
  return null;
}

describe('useCityReport', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    HOST_WORK.value = { busy: false, error: null };
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    HOST_WORK.value = { busy: false, error: null };
  });

  /** Mount the readout over a city. */
  function watching(city: ReturnType<typeof fakeCity>) {
    render(
      <CityProvider city={city as never}>
        <Report />
      </CityProvider>,
      host
    );
  }

  it('flashes for a Save the city answers in place', async () => {
    const city = fakeCity();
    watching(city);
    await drainAsync();

    city.settings.update({ STREETS: { ASPHALT_COLOR: '#123456' } });
    await drainAsync();

    expect(HOST_WORK.value.busy).toBe(true);
  });

  // A wallpaper is a city with no chrome: nothing reports on it, which is what
  // keeps its build off the readout above the project being read.
  it('leaves a city it was never given alone', async () => {
    const scene = fakeCity();
    const backdrop = fakeCity();
    watching(scene);
    await drainAsync();

    backdrop.settings.update({ STREETS: { ASPHALT_COLOR: '#654321' } });
    await drainAsync();

    expect(HOST_WORK.value.busy).toBe(false);
  });

  it('stops reporting once its city is gone', async () => {
    const city = fakeCity();
    watching(city);
    await drainAsync();
    render(null, host);

    city.settings.update({ STREETS: { ASPHALT_COLOR: '#abcdef' } });
    await drainAsync();

    expect(HOST_WORK.value.busy).toBe(false);
  });
});
