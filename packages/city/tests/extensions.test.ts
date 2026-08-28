// A host's own layer. The same contract the city's own components use, so an
// extension is not a second kind of thing to learn: it is added to the scene,
// ticked by the same loop, and disposed with the city.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import { createCity } from '../src/index';
import type { CityExtension, SceneContext } from '../src/types';

describe('a host’s own layer', () => {
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

  /** A layer that records what the city did with it. */
  function recorder() {
    const group = new THREE.Group();
    group.name = 'host-layer';
    const seen = { built: 0, ticks: 0, disposed: 0, ctx: null as SceneContext | null };
    const extension: CityExtension = (ctx) => {
      seen.built++;
      seen.ctx = ctx;
      return {
        group,
        tick: () => void seen.ticks++,
        dispose: () => void seen.disposed++,
      };
    };
    return { extension, group, seen };
  }

  it('is added to the scene the city draws', async () => {
    const layer = recorder();
    const city = await createCity(makeCanvas(), { extensions: [layer.extension] });

    expect(layer.seen.built).toBe(1);
    expect(city.scene.children).toContain(layer.group);
    city.dispose();
  });

  it('is ticked by the city’s own frame loop', async () => {
    const layer = recorder();
    const city = await createCity(makeCanvas(), { extensions: [layer.extension] });
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(layer.seen.ticks).toBeGreaterThan(0);
    city.dispose();
  });

  it('is disposed with the city', async () => {
    const layer = recorder();
    const city = await createCity(makeCanvas(), { extensions: [layer.extension] });
    city.dispose();

    expect(layer.seen.disposed).toBe(1);
  });

  // Everything the city's own components get. Without this an extension can
  // draw, but it cannot react to the city it is drawing in.
  it('is handed the same context the city’s own layers get', async () => {
    const layer = recorder();
    const city = await createCity(makeCanvas(), { extensions: [layer.extension] });

    const ctx = layer.seen.ctx!;
    expect(ctx.scene).toBe(city.scene);
    expect(ctx.settings).toBe(city.settings);
    expect(ctx.timeline.mode).toBe(false);
    expect(typeof ctx.client.apiUrl).toBe('function');
    expect(ctx.canvas).toBeInstanceOf(HTMLCanvasElement);
    city.dispose();
  });

  // How an extension turns itself off without the host branching at the call.
  it('adds nothing when it returns null', async () => {
    const before = (await createCity(makeCanvas())).scene.children.length;
    const city = await createCity(makeCanvas(), { extensions: [() => null] });

    expect(city.scene.children).toHaveLength(before);
    city.dispose();
  });

  it('takes several, in the order given', async () => {
    const first = recorder();
    const second = recorder();
    const city = await createCity(makeCanvas(), {
      extensions: [first.extension, second.extension],
    });

    const children = city.scene.children;
    expect(children.indexOf(first.group)).toBeLessThan(children.indexOf(second.group));
    city.dispose();
  });
});
