// Where you are in a city, written down and handed back. A host that wants a
// shareable link, a restored session or an undo stack needs exactly this, and
// without it writes its own — which ours did, by hand, into the URL.

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
import { makeCommitBundle } from './_helpers/scrub';
import { NodeKind, type Manifest } from '../src/types/manifest';

describe('a city’s view state', () => {
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
    const city = await createCity(canvas);
    await city.applyManifest({
      ...EMPTY_MANIFEST,
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
    } as unknown as Manifest);
    return city;
  }

  it('starts with nothing selected and no timeline', async () => {
    const city = await cityShowing();
    expect(city.getViewState()).toEqual({ selection: null, timeline: null });
    city.dispose();
  });

  it('names what is selected, by identity rather than by mesh', async () => {
    const city = await cityShowing();
    city.picker.selectByPath('root/a.ts');

    expect(city.getViewState().selection).toEqual({
      kind: NodeKind.File,
      path: 'root/a.ts',
    });
    city.dispose();
  });

  it('is plain data, so it survives a round trip through JSON', async () => {
    const city = await cityShowing();
    city.picker.selectByPath('root/a.ts');
    const snap = city.getViewState();

    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    city.dispose();
  });

  it('puts a city back where the snapshot says', async () => {
    const city = await cityShowing();
    city.picker.selectByPath('root/a.ts');
    const snap = city.getViewState();

    city.picker.clearSelection();
    expect(city.getViewState().selection).toBeNull();

    city.setViewState(snap);
    expect(city.getViewState().selection).toEqual(snap.selection);
    city.dispose();
  });

  // The meshes a snapshot named are gone by the time it is read back, which is
  // why the selection travels as a key: the picker re-resolves it against the
  // city that is actually on screen.
  it('restores a selection across a rebuild', async () => {
    const city = await cityShowing();
    city.picker.selectByPath('root/a.ts');
    const snap = city.getViewState();

    await city.applyManifest({
      ...EMPTY_MANIFEST,
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')]),
    } as unknown as Manifest);

    city.setViewState(snap);
    expect(city.getViewState().selection).toEqual(snap.selection);
    city.dispose();
  });

  it('carries the timeline mode and where the scrubber sits', async () => {
    const city = await cityShowing();
    city.timeline.enter();
    city.timeline.setBundle(makeCommitBundle(6));
    city.timeline.setPosition(3);

    expect(city.getViewState().timeline).toEqual({ mode: true, pos: 3 });
    city.dispose();
  });

  it('enters and leaves the timeline on the way back in', async () => {
    const city = await cityShowing();
    city.setViewState({ timeline: { mode: true, pos: 0 } });
    expect(city.timeline.mode).toBe(true);

    city.setViewState({ timeline: null });
    expect(city.timeline.mode).toBe(false);
    city.dispose();
  });

  // A host restoring only the selection should not be taken to say anything
  // about the timeline.
  it('leaves out what a snapshot does not mention', async () => {
    const city = await cityShowing();
    city.timeline.enter();
    city.timeline.setBundle(makeCommitBundle(4));

    city.setViewState({ selection: { kind: NodeKind.File, path: 'root/a.ts' } });

    expect(city.timeline.mode).toBe(true);
    city.dispose();
  });

  it('is per city: two on a page are in their own places', async () => {
    const a = await cityShowing();
    const b = await cityShowing();

    a.picker.selectByPath('root/a.ts');

    expect(a.getViewState().selection).not.toBeNull();
    expect(b.getViewState().selection).toBeNull();
    a.dispose();
    b.dispose();
  });
});
