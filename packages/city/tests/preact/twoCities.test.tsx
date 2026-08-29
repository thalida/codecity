// Two cities on one page, each with its own chrome, reading their own state.
//
// This is the test the whole design is for. A host that keeps a city in a
// module-level slot cannot pass it: there is one slot, one set of signals, and
// a second city has nowhere to be reflected — so it gets no chrome, which is
// exactly what happened to this repo's landing wallpaper.
//
// A city is a value. Put it in context; the panels below read THAT one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../../src/render/postFx', async () =>
  (await import('../_helpers/threeMock')).postFxMock()
);

import { City } from '../../src/index';
import { CityProvider, useCity } from '../../src/preact/context';
import { useCityManifest, useCitySelection, useCityStatus } from '../../src/preact/hooks';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import type { Manifest } from '../../src/types/manifest';
import { NodeKind } from '../../src/types/manifest';

function until(what: string, done: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (done()) return resolve();
      if (Date.now() - started > 3000) return reject(new Error(`timed out: ${what}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** A scrap of chrome: it knows nothing but the city it is under. */
function SelectionLabel({ id }: { id: string }) {
  const selection = useCitySelection();
  const manifest = useCityManifest();
  const status = useCityStatus();
  return (
    <div data-testid={id} data-lifecycle={status.lifecycle}>
      {selection?.kind === NodeKind.File ? selection.file.path : 'nothing'}
      {manifest ? ' · loaded' : ' · empty'}
    </div>
  );
}

function CityIdProbe({ id }: { id: string }) {
  const city = useCity();
  return <span data-testid={id}>{city ? 'has-city' : 'no-city'}</span>;
}

describe('two cities, two sets of chrome', () => {
  let host: HTMLDivElement;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let left: City;
  let right: City;

  const REPO = (name: string) =>
    ({
      ...EMPTY_MANIFEST,
      pending: [],
      tree: mkDir(name, [mkFile('a.ts'), mkFile('b.ts')]),
    }) as unknown as Manifest;

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 60) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
    const canvas = () => {
      const c = document.createElement('canvas');
      Object.defineProperty(c, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(c, 'clientHeight', { value: 600, configurable: true });
      return c;
    };
    left = await City.create(canvas());
    right = await City.create(canvas());
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    left.dispose();
    right.dispose();
    rafSpy.mockRestore();
  });

  const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

  it('each panel reads the city it is under', async () => {
    await left.applyManifest(REPO('left'));

    render(
      <>
        <CityProvider city={left}>
          <SelectionLabel id="left" />
        </CityProvider>
        <CityProvider city={right}>
          <SelectionLabel id="right" />
        </CityProvider>
      </>,
      host
    );

    // Only the left city has been given a repo.
    expect(text('left')).toContain('loaded');
    expect(text('right')).toContain('empty');
  });

  it('a selection in one is not a selection in the other', async () => {
    await left.applyManifest(REPO('left'));
    await right.applyManifest(REPO('right'));

    render(
      <>
        <CityProvider city={left}>
          <SelectionLabel id="left" />
        </CityProvider>
        <CityProvider city={right}>
          <SelectionLabel id="right" />
        </CityProvider>
      </>,
      host
    );

    left.picker.selectByPath('left/a.ts');
    await until('the left label', () => text('left').includes('left/a.ts'));

    expect(text('left')).toContain('left/a.ts');
    expect(text('right')).toContain('nothing');
  });

  // The point of the null case: chrome renders immediately rather than gating
  // the whole tree on a canvas that has not finished building.
  it('renders before a city exists', () => {
    render(
      <CityProvider city={null}>
        <SelectionLabel id="pending" />
        <CityIdProbe id="probe" />
      </CityProvider>,
      host
    );
    expect(text('pending')).toContain('nothing');
    expect(text('probe')).toBe('no-city');
  });

  // A host holding several can still render a panel for a specific one.
  it('takes an explicit city over the one in context', async () => {
    await right.applyManifest(REPO('right'));

    function Explicit() {
      const manifest = useCityManifest(right);
      return <div data-testid="explicit">{manifest ? 'loaded' : 'empty'}</div>;
    }
    render(
      <CityProvider city={left}>
        <Explicit />
      </CityProvider>,
      host
    );

    expect(text('explicit')).toBe('loaded');
  });
});
