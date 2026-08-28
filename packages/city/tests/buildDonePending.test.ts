// What `build:done` promises. A scan streams more than once: the first manifest
// draws real buildings while git history is still coming, and history is where
// commits come from, so the trees land on a LATER build. A consumer that reads
// the first done as the last one reveals a city that then grows a forest, which
// is what the loading overlay did. The event carries the drawn manifest's own
// `pending` so the difference is reported rather than inferred.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import { createCity } from '../src/index';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import type { Manifest } from '../src/types/manifest';

describe('build:done reports what is still to come', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 40) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });
  afterEach(() => rafSpy.mockRestore());

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  const manifestPending = (pending: Manifest['pending']): Manifest =>
    ({ ...EMPTY_MANIFEST, pending }) as Manifest;

  /** The pending list of the next build to reach the screen. */
  function nextDone(city: { on: Awaited<ReturnType<typeof createCity>>['on'] }) {
    return new Promise<Manifest['pending']>((resolve) => {
      const off = city.on('build:done', ({ pending }) => {
        off();
        resolve(pending);
      });
    });
  }

  it('names the stages the drawn manifest was still waiting on', async () => {
    const city = await createCity(makeCanvas());
    const done = nextDone(city);

    await city.applyManifest(manifestPending(['history']));

    expect(await done).toEqual(['history']);
    city.dispose();
  });

  it('reports an empty list once the manifest is final', async () => {
    const city = await createCity(makeCanvas());
    const done = nextDone(city);

    await city.applyManifest(manifestPending([]));

    expect(await done).toEqual([]);
    city.dispose();
  });
});
