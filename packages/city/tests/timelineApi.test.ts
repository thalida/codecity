// The timeline a city hands out has to BE its timeline, not a copy of what it
// read at construction. Every value on a TimelineState is a getter, so building
// the public api with `{...timeline}` freezes all of them — the city enters
// Timeline, the scene changes, and `handle.timeline.mode` still answers false.
// Nothing downstream can tell that apart from "the mode never changed".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { forceContextLossSpy } = vi.hoisted(() => ({ forceContextLossSpy: vi.fn() }));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer(forceContextLossSpy) };
});

vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import { City } from '../src/index';
import { makeCommitBundle } from './_helpers/scrub';

describe('the timeline a city hands out', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 8) setTimeout(() => cb(performance.now()), 0);
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

  it('reports the mode the city is actually in', async () => {
    const city = await City.create(makeCanvas());
    expect(city.timeline.mode).toBe(false);

    city.timeline.enter();
    expect(city.timeline.mode).toBe(true);

    city.timeline.exit();
    expect(city.timeline.mode).toBe(false);

    city.dispose();
  });

  it('reports the bundle and position it was given', async () => {
    const city = await City.create(makeCanvas());
    const bundle = makeCommitBundle(5);

    city.timeline.enter();
    city.timeline.setBundle(bundle);
    city.timeline.setPosition(3);

    expect(city.timeline.bundle).toBe(bundle);
    expect(city.timeline.pos).toBe(3);
    expect(city.timeline.max).toBeGreaterThan(0);

    city.dispose();
  });

  // The scene methods and the state have to be one object, or a caller that
  // holds `handle.timeline` gets only half of it.
  it('carries the scene controls on the same object as the state', async () => {
    const city = await City.create(makeCanvas());

    expect(typeof city.timeline.installScrubController).toBe('function');
    expect(typeof city.timeline.setStreetsTransparent).toBe('function');
    expect(typeof city.timeline.on).toBe('function');

    city.dispose();
  });
});
