// Reading a city from a component. Without these a host writes the bridge
// itself, once per value — which is how ours grew fifteen signals across four
// files before anyone noticed they were the same idea.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useState } from 'preact/hooks';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../../src/render/postFx', async () =>
  (await import('../_helpers/threeMock')).postFxMock()
);

import {
  useCityStatus,
  useCityManifest,
  useCitySelection,
  useCityHover,
  useCityTimeline,
} from '../../src/preact/hooks';
import { City } from '../../src/city';
import type { Manifest } from '../../src/types/manifest';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import { makeCommitBundle } from '../_helpers/scrub';
import { CityLifecycle } from '../../src/state/status';

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

describe('the city hooks', () => {
  let host: HTMLDivElement;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let city: City;

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 40) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    city = await City.create(canvas);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    city.dispose();
    rafSpy.mockRestore();
  });

  const REPO = {
    ...EMPTY_MANIFEST,
    pending: [],
    tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
  } as unknown as Manifest;

  /** Render one hook and record every value it produced. */
  function watch<T>(use: (c: City | null) => T) {
    const seen: T[] = [];
    function Probe() {
      seen.push(use(city));
      return null;
    }
    render(<Probe />, host);
    return seen;
  }

  // The first render has the REAL value, not a placeholder corrected a frame
  // later — which is the flicker a hand-rolled bridge has and cannot easily lose.
  it('has the current answer on the very first render', async () => {
    await city.applyManifest(REPO);
    const seen = watch(useCityManifest);
    expect(seen[0]).not.toBeNull();
  });

  it('re-renders when the selection moves', async () => {
    await city.applyManifest(REPO);
    const seen = watch(useCitySelection);
    expect(seen[0]).toBeNull();

    city.picker.selectByPath('root/a.ts');
    await until('a re-render', () => seen.length > 1);

    expect(seen[seen.length - 1]).not.toBeNull();
  });

  it('re-renders when the hover moves', async () => {
    await city.applyManifest(REPO);
    const seen = watch(useCityHover);
    const before = seen.length;

    city.picker.hoverByPath('root/a.ts');
    await until('a re-render', () => seen.length > before);

    expect(seen[seen.length - 1]).not.toBeNull();
  });

  it('follows what the city is doing', async () => {
    const seen = watch(useCityStatus);
    expect(seen[0].lifecycle).toBe(CityLifecycle.Empty);

    await city.applyManifest(REPO);
    await until('ready', () => seen[seen.length - 1].lifecycle === CityLifecycle.Ready);

    expect(seen[seen.length - 1].fetching).toBe(false);
  });

  // One object rather than eight hooks: they move together, and a scrubber
  // wants all of them in the same render.
  it('gives the whole timeline position in one value', async () => {
    await city.applyManifest(REPO);
    const seen = watch(useCityTimeline);
    expect(seen[0].mode).toBe(false);

    city.timeline.enter();
    city.timeline.setBundle(makeCommitBundle(5));
    await until('the mode', () => seen[seen.length - 1].mode);

    const now = seen[seen.length - 1];
    expect(now.mode).toBe(true);
    expect(now.max).toBeGreaterThan(0);
  });

  it('answers for no city at all, so a host can render before one exists', () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push([useCityStatus(null), useCityManifest(null), useCityTimeline(null)]);
      return null;
    }
    render(<Probe />, host);
    const [status, manifest, timeline] = seen[0] as [
      { lifecycle: string },
      unknown,
      { mode: boolean },
    ];
    expect(status.lifecycle).toBe(CityLifecycle.Empty);
    expect(manifest).toBeNull();
    expect(timeline.mode).toBe(false);
  });

  // A disposed city must not call back into a component on its way out.
  it('unsubscribes when the component goes', async () => {
    await city.applyManifest(REPO);
    const seen = watch(useCitySelection);
    render(null, host);
    const after = seen.length;

    city.picker.selectByPath('root/a.ts');
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(seen).toHaveLength(after);
  });

  it('does not re-render for a change it is not about', async () => {
    await city.applyManifest(REPO);
    const seen = watch(useCitySelection);
    const before = seen.length;

    // A hover is not a selection.
    city.picker.hoverByPath('root/a.ts');
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(seen).toHaveLength(before);
  });
});
