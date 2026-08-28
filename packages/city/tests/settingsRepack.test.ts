// A rebuild-routed Save re-packs the city that holds the setting, and the city
// does it — the host used to watch its own signals and hand a city a manifest
// to apply, which only ever had one manifest to hand and so gave the second
// city on the page the first one's.
//
// The re-pack has to drop the layout cache first: a config-only Save re-applies
// the SAME manifest, and applyManifest's structure_signature cache would hand
// back the positions it already had, so the setting would do nothing visible.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import { createCity } from '../src/index';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import { mkDir, mkFile } from './_helpers/cityFixtures';
import type { Manifest } from '../src/types/manifest';

describe('a rebuild-routed Save', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 60) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });
  afterEach(() => rafSpy.mockRestore());

  async function cityShowing(): Promise<Awaited<ReturnType<typeof createCity>>> {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    const city = await createCity(canvas);
    // build:done lands two frames after applyManifest resolves, so wait for the
    // first city to be ON SCREEN — otherwise its own done arrives during the
    // observation below and reads as a re-pack.
    const onScreen = new Promise<void>((resolve) => {
      const off = city.on('build:done', () => {
        off();
        resolve();
      });
    });
    // Same signatures every apply: what a config-only Save produces, and what
    // the reuse path keys on.
    await city.applyManifest({
      ...EMPTY_MANIFEST,
      structure_signature: 'abc',
      layout_signature: 'abc',
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')]),
    } as unknown as Manifest);
    await onScreen;
    return city;
  }

  /** What this city reported building, after `change` and a few frames. */
  async function buildsAfter(
    city: Awaited<ReturnType<typeof createCity>>,
    change: () => void
  ): Promise<string[]> {
    const seen: string[] = [];
    const offs = [
      city.on('build:start', () => seen.push('start')),
      city.on('build:done', () => seen.push('done')),
    ];
    change();
    await new Promise<void>((r) => setTimeout(r, 200));
    for (const off of offs) off();
    return seen;
  }

  it('re-packs the city that holds it', async () => {
    const city = await cityShowing();
    const seen = await buildsAfter(city, () =>
      city.updateSettings({
        STREET_LAYOUT: { BUILDING_GAP: city.settings.STREET_LAYOUT.BUILDING_GAP + 40 },
      })
    );
    expect(seen).toContain('start');
    city.dispose();
  });

  // A store carries fields on different routes. Re-packing because a colour
  // moved is seconds of work on a real repo, for something applied in place.
  it('does not re-pack for a refresh-routed field on the same store', async () => {
    const city = await cityShowing();
    const seen = await buildsAfter(city, () =>
      city.updateSettings({ STREETS: { ASPHALT_COLOR: '#123456' } })
    );
    expect(seen).toEqual([]);
    city.dispose();
  });

  it('does not re-pack when the value written is the one already there', async () => {
    const city = await cityShowing();
    const seen = await buildsAfter(city, () =>
      city.updateSettings({
        STREET_LAYOUT: { BUILDING_GAP: city.settings.STREET_LAYOUT.BUILDING_GAP },
      })
    );
    expect(seen).toEqual([]);
    city.dispose();
  });

  // Two cities on a page: one being saved is not the other being saved, and
  // each re-packs from the manifest IT is showing.
  it('leaves a second city on the page alone', async () => {
    const scene = await cityShowing();
    const backdrop = await cityShowing();
    const seen = await buildsAfter(backdrop, () =>
      scene.updateSettings({
        STREET_LAYOUT: { BUILDING_GAP: scene.settings.STREET_LAYOUT.BUILDING_GAP + 40 },
      })
    );
    expect(seen).toEqual([]);
    scene.dispose();
    backdrop.dispose();
  });
});
