// A whole city, written down and put back. One value, so a host storing a
// session stores one thing rather than remembering which three calls to make.

import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import { City } from '../src/city';
import type { Manifest } from '../src/types/manifest';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import { mkDir, mkFile } from './_helpers/cityFixtures';

function canvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { value: 1280, configurable: true });
  Object.defineProperty(c, 'clientHeight', { value: 720, configurable: true });
  return c;
}

const SHOWING = {
  ...EMPTY_MANIFEST,
  tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
} as unknown as Manifest;

describe('a city, written down', () => {
  it('carries what it shows, how it is set up, and where the reader is', async () => {
    const city = await City.create(canvas());
    await city.applyManifest(SHOWING);
    city.picker.selectByPath('root/a.ts');
    city.updateSettings({ TREES: { ENABLED: false } });

    const snap = city.getSnapshot();

    expect(snap.manifest).toBe(SHOWING);
    expect(snap.view?.selection).toEqual({ kind: 'file', path: 'root/a.ts' });
    expect(snap.settings?.TREES).toMatchObject({ ENABLED: false });
    city.dispose();
  });

  it('puts a second city in the same place, without going back to the server', async () => {
    const first = await City.create(canvas());
    await first.applyManifest(SHOWING);
    first.picker.selectByPath('root/b.ts');
    first.updateSettings({ TREES: { ENABLED: false } });
    const snap = first.getSnapshot();
    first.dispose();

    const second = await City.create(canvas());
    // No src is passed: a host that saved a manifest saved the city it SAW,
    // not whatever the repo looks like now.
    await second.loadSnapshot(snap);

    expect(second.manifest).toBe(SHOWING);
    expect(second.picker.selectionKey).toEqual({ kind: 'file', path: 'root/b.ts' });
    expect(second.settings.TREES.ENABLED).toBe(false);
    second.dispose();
  });

  it('restores only what the snapshot names', async () => {
    const city = await City.create(canvas());
    await city.applyManifest(SHOWING);

    await city.loadSnapshot({ view: { selection: { kind: 'file', path: 'root/a.ts' } } as never });

    expect(city.manifest).toBe(SHOWING);
    expect(city.picker.selectionKey).toMatchObject({ path: 'root/a.ts' });
    city.dispose();
  });
});
