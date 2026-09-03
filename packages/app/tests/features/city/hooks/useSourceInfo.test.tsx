// What the city on screen IS, named. Off the manifest the CITY published, so
// two cities on a page give two answers rather than sharing a module signal.

import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import type { Manifest } from '@codecity/city';

import { useSourceInfo, type SourceInfo } from '@/features/city/hooks/useSourceInfo';
import { CURRENT_SOURCE } from '@/state/source';
import { renderWithCity, type FakeCity } from '../../../_helpers/cityChrome';

let host: HTMLDivElement;
let seen: SourceInfo | null = null;

function Probe() {
  seen = useSourceInfo();
  return null;
}

/** Render the hook under a city showing `manifest`. */
function showing(manifest: Manifest | null): FakeCity {
  host = document.createElement('div');
  document.body.appendChild(host);
  const city = renderWithCity(<Probe />, host);
  if (manifest) {
    city.setManifest(manifest);
    render(null, host);
    renderWithCity(<Probe />, host, city);
  }
  return city;
}

afterEach(() => {
  render(null, host);
  host.remove();
  CURRENT_SOURCE.value = null;
  seen = null;
});

describe('useSourceInfo', () => {
  it('is empty when nothing is applied', () => {
    CURRENT_SOURCE.value = null;
    showing(null);
    expect(seen).toEqual({
      label: '',
      branch: undefined,
      sourceUrl: undefined,
      src: undefined,
    });
  });

  it('exposes the git URL as sourceUrl for a git source', () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r', branch: 'main' };
    showing({ tree: { name: 'r' }, repo: { branch: 'main' } } as unknown as Manifest);
    expect(seen!.sourceUrl).toBe('https://github.com/o/r');
    expect(seen!.branch).toBe('main');
    expect(seen!.label).toBe('r');
  });

  it('has no sourceUrl for a local path source', () => {
    CURRENT_SOURCE.value = { src: '/Users/me/proj' };
    showing({ tree: { name: 'proj' }, repo: {} } as unknown as Manifest);
    expect(seen!.sourceUrl).toBeUndefined();
  });
});
