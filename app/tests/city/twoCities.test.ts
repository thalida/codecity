// Two cities, mounted at once, must not be able to hear each other. A city is
// wired to one session and nothing else, so the landing's backdrop below builds,
// frames and scrubs entirely inside its own while the opened one drives the
// status, the framing and the scrub the app reads.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import { RebuildStatus } from '@/state/stores/progress';
import { SourceKind } from '@/utils/sources';
import { TREES } from '@/state/settings/fields/trees';
import { ChangeRoute } from '@/state/settings/schema';
import { BuildingMaterial } from '@/city/components/buildings/material';
import type { Manifest } from '@/types';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});

vi.mock('@/city/render/postFx', async () => (await import('../_helpers/threeMock')).postFxMock());

// Icon images never fire onload in jsdom and would hang the apply.
vi.mock('@/city/components/buildings/atlas', async () => {
  const actual = await vi.importActual<typeof import('@/city/components/buildings/atlas')>(
    '@/city/components/buildings/atlas'
  );
  return { ...actual, buildIconAtlas: async () => null };
});

import { createCityScene } from '@/city/index';
import { makeSession } from '../_helpers/city';

// The city the app has open, and the one the landing draws behind itself.
const opened = makeSession();
const backdrop = makeSession();

const W = 800;
const H = 600;

describe('two cities at once', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reset();
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    reset();
  });

  function reset(): void {
    for (const s of [opened, backdrop]) {
      s.source.current.value = null;
      s.manifest.current.value = null;
      s.timeline.mode.value = false;
      s.progress.rebuildStatus.value = RebuildStatus.Pending;
      s.progress.builtManifest.value = null;
    }
  }

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: H, configurable: true });
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 }) as DOMRect;
    return canvas;
  }

  function makeManifest(name: string): Manifest {
    return {
      ...EMPTY_MANIFEST,
      tree: mkDir(name, [mkDir('src', [mkFile('a.ts'), mkFile('b.ts')])]),
      structure_signature: `structure-${name}`,
      layout_signature: `layout-${name}`,
      content_signature: `content-${name}`,
    } as unknown as Manifest;
  }

  it('builds the backdrop, telling its own session and no other', async () => {
    const scenery = await createCityScene(makeCanvas(), backdrop);
    try {
      backdrop.manifest.set(makeManifest('wallpaper'));
      await scenery.applyManifest(backdrop.manifest.current.peek() as Manifest);

      expect(scenery.manifest.value, 'it did build').not.toBeNull();
      await vi.waitFor(() =>
        expect(backdrop.progress.builtManifest.value, 'its own session heard').not.toBeNull()
      );
      expect(opened.progress.rebuildStatus.value, 'the other was not told').toBe(
        RebuildStatus.Pending
      );
      expect(opened.progress.builtManifest.value).toBeNull();
      expect(opened.progress.buildProgress.value).toBeNull();
    } finally {
      scenery.dispose();
    }
  });

  it('holds the opened one’s "on screen" while the backdrop builds beside it', async () => {
    const world = await createCityScene(makeCanvas(), opened);
    const scenery = await createCityScene(makeCanvas(), backdrop);
    try {
      opened.source.current.value = { src: 'test://repo' };
      opened.manifest.current.value = makeManifest('repo');
      await world.applyManifest(makeManifest('repo'));
      await vi.waitFor(() => expect(opened.progress.rebuildStatus.value).toBe(RebuildStatus.Idle));

      // Sampled DURING the wallpaper's build: a build opens its readout before
      // it yields, so a coupled one is visible here and nowhere later.
      const scenic = scenery.applyManifest(makeManifest('wallpaper'));
      expect(opened.progress.rebuildStatus.value, 'the world is still what is on screen').toBe(
        RebuildStatus.Idle
      );
      expect(opened.progress.buildProgress.value, 'and nothing claims to be building').toBeNull();
      await scenic;

      expect(scenery.manifest.value?.tree?.name).toBe('wallpaper');
      expect(world.manifest.value?.tree?.name).toBe('repo');
    } finally {
      scenery.dispose();
      world.dispose();
    }
  });

  it('leaves the backdrop alone when the opened one exits Timeline', async () => {
    const scenery = await createCityScene(makeCanvas(), backdrop);
    try {
      await scenery.applyManifest(makeManifest('wallpaper'));
      scenery.timeline.installScrubController(new Map(), []);
      const uninstall = vi.spyOn(scenery.timeline, 'uninstallScrubController');
      // The live manifest a Timeline exit would rebuild from: a DIFFERENT repo,
      // which is what used to land on the landing's wallpaper.
      opened.manifest.current.value = makeManifest('repo');

      opened.timeline.mode.value = true;
      opened.timeline.mode.value = false;

      expect(uninstall).not.toHaveBeenCalled();
      expect(scenery.manifest.value?.tree?.name).toBe('wallpaper');
    } finally {
      scenery.dispose();
    }
  });

  // The point of a session: two cities loading and scrubbing at once. One
  // MANIFEST and one scan meant the second repo overwrote the first.
  it('runs two cities at once without either seeing the other', async () => {
    const left = makeSession();
    const right = makeSession();
    try {
      left.source.current.value = { src: 'test://left' };
      right.source.current.value = { src: 'test://right' };
      left.manifest.set(makeManifest('left'));
      right.manifest.set(makeManifest('right'));

      // One scans while the other is idle, one scrubs while the other is live.
      left.progress.scan.value = { kind: SourceKind.Local, phase: null };
      right.progress.markIdle();
      right.timeline.mode.value = true;
      right.timeline.setScrubPos(3);

      expect(left.progress.scan.value, 'left is still loading').not.toBeNull();
      expect(right.progress.scan.value, 'and right never started').toBeNull();
      expect(left.progress.rebuildStatus.value).toBe(RebuildStatus.Pending);
      expect(right.progress.rebuildStatus.value).toBe(RebuildStatus.Idle);
      expect(left.timeline.mode.value, 'only one of them is scrubbing').toBe(false);
      expect(left.timeline.scrubPos.value).toBe(0);
      expect(left.manifest.current.value).not.toBe(right.manifest.current.value);
      expect(left.source.isOpen('test://right')).toBe(false);
    } finally {
      left.dispose();
      right.dispose();
    }
  });

  // What a session's config is FOR: same fields, its own values.
  it('lets one city look different without touching the other', () => {
    const dark = makeSession();
    try {
      expect(dark.config.TREES.value).toEqual(opened.config.TREES.value);
      const rebuiltBefore = opened.config.signature(ChangeRoute.Rebuild);

      dark.config.override(TREES, { ...TREES.value, CITY_CLEARANCE_PERCENT: 42 });

      expect(dark.config.TREES.value.CITY_CLEARANCE_PERCENT).toBe(42);
      expect(opened.config.TREES.value.CITY_CLEARANCE_PERCENT).not.toBe(42);
      // Only the one that changed rebuilds: the signature is per city.
      expect(dark.config.signature(ChangeRoute.Rebuild)).not.toBe(rebuiltBefore);
      expect(opened.config.signature(ChangeRoute.Rebuild)).toBe(rebuiltBefore);
    } finally {
      dark.dispose();
    }
  });

  // Shared GPU state is the other way two cities leak into each other: one
  // material meant one fog colour, one outline width, one icon atlas.
  it('gives each city its own building material and atlas', async () => {
    const mine = new BuildingMaterial(opened.config);
    const theirs = new BuildingMaterial(backdrop.config);
    expect(mine.get()).not.toBe(theirs.get());

    mine.setIconAtlas({ texture: null, slotSize: 4 } as never);
    expect(theirs.getIconAtlas(), 'the other city never saw it').toBeNull();
  });

  it('holds the backdrop’s camera when the opened city changes', async () => {
    const scenery = await createCityScene(makeCanvas(), backdrop);
    try {
      opened.source.current.value = { src: 'test://one' };
      await scenery.applyManifest(makeManifest('wallpaper'));
      // Spied after the first apply: framing the city it just got IS its job.
      const refit = vi.spyOn(scenery.rig, 'reset');

      // A source switch refits the city that IS that source. This one is a
      // picture of something else, and its camera is not the app's to move.
      opened.source.current.value = { src: 'test://two' };
      await scenery.applyManifest(makeManifest('wallpaper'));

      expect(refit).not.toHaveBeenCalled();
    } finally {
      scenery.dispose();
    }
  });
});
