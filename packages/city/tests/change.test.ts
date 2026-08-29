// One notification saying what moved. A host that re-renders wants to be told
// once and to ask what is different — not to subscribe to eleven events and
// keep its list in step with ours.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import { City } from '../src/index';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import { mkDir, mkFile } from './_helpers/cityFixtures';
import { makeCommitBundle } from './_helpers/scrub';
import type { CityChange, CityChangeContext } from '../src/state/change';
import type { Manifest } from '../src/types/manifest';

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('onChange', () => {
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

  async function cityShowing() {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    const city = await City.create(canvas);
    // build:done lands two frames after applyManifest resolves, so wait for the
    // city to be ON SCREEN — otherwise its own status change arrives during the
    // recording below and reads as something the test did.
    const onScreen = new Promise<void>((resolve) => {
      const off = city.on('build:done', () => {
        off();
        resolve();
      });
    });
    await city.applyManifest({
      ...EMPTY_MANIFEST,
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
    } as unknown as Manifest);
    await onScreen;
    await settle();
    return city;
  }

  /** Every notification a run produced. */
  function record(city: Awaited<ReturnType<typeof City.create>>) {
    const seen: Array<{ change: CityChange; context: CityChangeContext }> = [];
    const off = city.onChange((change, context) => seen.push({ change, context }));
    return { seen, off };
  }

  it('says the selection moved, and nothing else', async () => {
    const city = await cityShowing();
    const rec = record(city);

    city.picker.selectByPath('root/a.ts');
    await settle();

    expect(rec.seen).toHaveLength(1);
    expect(rec.seen[0].change.selectionChanged).toBe(true);
    expect(rec.seen[0].change.manifestChanged).toBe(false);
    rec.off();
    city.dispose();
  });

  it('hands the listener the values, so it need not reach back', async () => {
    const city = await cityShowing();
    const rec = record(city);

    city.picker.selectByPath('root/a.ts');
    await settle();

    expect(rec.seen[0].context.selection).not.toBeNull();
    expect(rec.seen[0].context.manifest).not.toBeNull();
    expect(rec.seen[0].context.status).toBe(city.status);
    rec.off();
    city.dispose();
  });

  // The point of batching: an apply publishes a manifest, moves the selection
  // and ends a build inside one turn.
  it('is one notification for one apply, not three', async () => {
    const city = await cityShowing();
    const rec = record(city);

    await city.applyManifest({
      ...EMPTY_MANIFEST,
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')]),
    } as unknown as Manifest);
    await settle();

    const applies = rec.seen.filter((s) => s.change.manifestChanged);
    expect(applies).toHaveLength(1);
    rec.off();
    city.dispose();
  });

  it('reports the timeline moving', async () => {
    const city = await cityShowing();
    const rec = record(city);

    city.timeline.enter();
    city.timeline.setBundle(makeCommitBundle(4));
    await settle();

    expect(rec.seen.some((s) => s.change.timelineChanged)).toBe(true);
    rec.off();
    city.dispose();
  });

  it('says nothing when nothing moved', async () => {
    const city = await cityShowing();
    const rec = record(city);

    await settle();

    expect(rec.seen).toHaveLength(0);
    rec.off();
    city.dispose();
  });

  it('stops when the listener leaves', async () => {
    const city = await cityShowing();
    const rec = record(city);
    rec.off();

    city.picker.selectByPath('root/a.ts');
    await settle();

    expect(rec.seen).toHaveLength(0);
    city.dispose();
  });

  // A disposed city must not call back into a view that is on its way out.
  it('stops when the city goes', async () => {
    const city = await cityShowing();
    const rec = record(city);

    city.dispose();
    await settle();

    expect(rec.seen).toHaveLength(0);
  });
});
