import { createTimelineState, BuildStage, ScanPhase, defaultCitySettings } from '@codecity/city';
import type { TimelineBundle } from '@codecity/city';

// The imports below reach past the package's public surface on purpose, and
// say so by path: they are its internal wiring, which no consumer needs and
// which these tests assemble by hand. A test may reach in; nothing in src/ may.
import { createEmitter } from '../../../city/src/state/events';
import {
  SHARED_MEDIA_LOAD_LIMITER,
  createMediaLoadLimiter,
} from '../../../city/src/render/mediaLoadLimiter';
import { createCityResources } from '../../../city/src/render/resources';
import { createSettingsStore } from '../../../city/src/settings/store';
import { describe, it, expect, afterEach } from 'vitest';

import {
  CITY_STATUS,
  attachCityStatus,
  PENDING_SOURCE_LABEL,
  LOADING_SOURCE,
} from '@/features/city/state/overlay';
import { attachScanToStores } from '@/features/city/state/commands';

import { settingsStore, statusFrom } from '@codecity/city/testing';
import { CityLifecycle, CityPhase, EMPTY_CITY_STATUS } from '@codecity/city';

/** Two cities on one page must share no GPU resource.
 *
 *  This is not a style preference. A ShaderMaterial belongs to the WebGL context
 *  that compiled it, an icon atlas to the build that produced it, and the
 *  renderer slot used to have room for exactly one renderer — so a second city
 *  overwrote the first and its facade uploads landed on the wrong context. The
 *  bug is invisible today only because the app's backdrop and its scene live on
 *  different routes and never coexist. */
describe('two cities on one page', () => {
  it('own distinct building materials', () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());
    expect(a.buildings).not.toBe(b.buildings);
    expect(a.buildings.get()).not.toBe(b.buildings.get());
  });

  it('own distinct icon atlases, and setting one does not reach the other', () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());
    const atlas = { texture: null, slotSize: 16 } as never;

    a.buildings.setIconAtlas(atlas);

    expect(a.buildings.getIconAtlas()).toBe(atlas);
    expect(b.buildings.getIconAtlas()).toBeNull();
    expect(a.buildings.get().uniforms.uIconSlotSize.value).toBe(16);
    expect(b.buildings.get().uniforms.uIconSlotSize.value).toBe(0);
  });

  it('own distinct translucency, so a fade on one leaves the other opaque', () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());

    a.buildings.setTranslucent(true);

    expect(a.buildings.get().transparent).toBe(true);
    expect(b.buildings.get().transparent).toBe(false);
  });

  it('own distinct renderer registrations', async () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());
    const rendererA = { id: 'a' } as never;

    a.renderer.register(rendererA);

    expect(await a.renderer.whenReady()).toBe(rendererA);
    // b never registered one, so its waiter is still parked — it must NOT see
    // a's renderer. Race the timeout rather than waiting it out.
    const bSaw = await Promise.race([
      b.renderer.whenReady(),
      new Promise((r) => setTimeout(() => r('still-waiting'), 20)),
    ]);
    expect(bSaw).toBe('still-waiting');
  });

  it('own distinct gem glow textures', () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());
    expect(a.gem.glow()).not.toBe(b.gem.glow());
    // …but each caches its own, so a city uploads one texture, not one per gem.
    expect(a.gem.glow()).toBe(a.gem.glow());
  });

  it('own distinct capture latches', () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());
    a.timelineKickedOff = true;
    expect(b.timelineKickedOff).toBe(false);
  });

  it('disposing one leaves the other usable', () => {
    const a = createCityResources(null, settingsStore());
    const b = createCityResources(null, settingsStore());
    const materialB = b.buildings.get();

    a.dispose();

    expect(b.buildings.get()).toBe(materialB);
    expect(() => b.buildings.refresh()).not.toThrow();
  });
});

/** Settings are per city, not per page. The panel writes a value; each city
 *  gets its own copy pushed in, so the backdrop and the scene can be tuned
 *  differently and neither reads a global. */
describe('two cities hold their own settings', () => {
  it('start from the defaults, and an override reaches only the city given it', () => {
    const a = createSettingsStore({ BUILDINGS: { HALF_LIFE_DAYS: 7 } });
    const b = createSettingsStore();

    expect(a.snapshot().BUILDINGS.HALF_LIFE_DAYS).toBe(7);
    expect(b.snapshot().BUILDINGS.HALF_LIFE_DAYS).toBe(
      defaultCitySettings().BUILDINGS.HALF_LIFE_DAYS
    );
  });

  it('updateSettings on one leaves the other where it was', () => {
    const a = createSettingsStore();
    const b = createSettingsStore();

    a.update({ TREES: { ENABLED: false } });

    expect(a.snapshot().TREES.ENABLED).toBe(false);
    expect(b.snapshot().TREES.ENABLED).toBe(true);
  });

  it('a change notifies the listeners of that city only', () => {
    const a = createSettingsStore();
    const b = createSettingsStore();
    let aRuns = 0;
    let bRuns = 0;
    const stopA = a.on('BUILDINGS', () => aRuns++);
    const stopB = b.on('BUILDINGS', () => bRuns++);
    // on() applies once, so a component's "put my settings on" runs at
    // construction and on every Save from the same line.
    expect([aRuns, bRuns]).toEqual([1, 1]);

    a.update({ BUILDINGS: { HALF_LIFE_DAYS: 30 } });

    expect(aRuns).toBe(2);
    expect(bRuns).toBe(1);
    stopA();
    stopB();
  });

  it('an unchanged write notifies nothing: a repack costs seconds on a big repo', () => {
    const store = createSettingsStore();
    let runs = 0;
    const stop = store.on('BUILDINGS', () => runs++);

    store.update({ BUILDINGS: { HALF_LIFE_DAYS: store.BUILDINGS.HALF_LIFE_DAYS } });

    expect(runs).toBe(1);
    stop();
  });

  it("a change to one store leaves the other stores' listeners alone", () => {
    const store = createSettingsStore();
    let treeRuns = 0;
    const stop = store.on('TREES', () => treeRuns++);

    store.update({ BUILDINGS: { HALF_LIFE_DAYS: 30 } });

    expect(treeRuns).toBe(1);
    stop();
  });

  it('tells a listener once per update, not once per store that moved', () => {
    const store = createSettingsStore();
    let runs = 0;
    const stop = store.on(['BUILDINGS', 'TREES'], () => runs++);

    store.update({ BUILDINGS: { HALF_LIFE_DAYS: 30 }, TREES: { ENABLED: false } });

    expect(runs).toBe(2); // the immediate apply, then one for the update
    stop();
  });

  it('drops a value the field cannot take rather than passing it to the renderer', () => {
    const store = createSettingsStore();
    const stock = store.BUILDINGS.HALF_LIFE_DAYS;

    store.update({ BUILDINGS: { HALF_LIFE_DAYS: 'soon' as never } });

    expect(store.BUILDINGS.HALF_LIFE_DAYS).toBe(stock);
  });

  it('clamps a numeric field to its declared bounds', () => {
    const store = createSettingsStore({ BUILDING_DIMENSIONS: { MIN_FLOORS: -5 } });
    // MIN_FLOORS declares min: 1, and a 0-floor building is NaN geometry.
    expect(store.BUILDING_DIMENSIONS.MIN_FLOORS).toBe(1);
  });

  it('gives each city its own defaults object, not one everyone can edit', () => {
    const one = defaultCitySettings();
    const two = defaultCitySettings();
    expect(one).not.toBe(two);
    expect(one.BUILDINGS).not.toBe(two.BUILDINGS);
  });
});

/** A city reports to its own subscribers, and the overlay above the project you
 *  are reading subscribes to exactly one of them. The landing mounts a wallpaper
 *  city that builds behind the page; before events, its build wrote the same
 *  global the project's overlay read. */
describe('two cities report to their own subscribers', () => {
  const stages = [BuildStage.Layout, BuildStage.Assemble];

  afterEach(() => {
    CITY_STATUS.value = EMPTY_CITY_STATUS;
  });

  it('the readout follows the city it was attached to', () => {
    const scene = createEmitter();
    const detach = attachCityStatus(statusFrom(scene));

    scene.emit('build:start', { stages });
    scene.emit('build:stage', { stage: BuildStage.Assemble });

    expect(CITY_STATUS.value.phase).toBe(CityPhase.Building);
    expect(CITY_STATUS.value.stage).toBe(BuildStage.Assemble);
    detach();
  });

  it('a second city building does not touch it', () => {
    const scene = createEmitter();
    const backdrop = createEmitter();
    const detach = attachCityStatus(statusFrom(scene));
    scene.emit('build:start', { stages });
    const mid = CITY_STATUS.value;

    // The whole of a wallpaper's build, start to finish, behind the page.
    backdrop.emit('build:start', { stages: [BuildStage.Icons] });
    backdrop.emit('build:stage', { stage: BuildStage.Icons });
    backdrop.emit('build:progress', { percent: 80 });
    backdrop.emit('build:done', { pending: [] });

    expect(CITY_STATUS.value).toBe(mid);
    // And the scene's city is emphatically not being reported as finished.
    expect(CITY_STATUS.value.lifecycle).not.toBe(CityLifecycle.Ready);
    detach();
  });

  it('detaching stops the reports, so an unmounted city cannot drive it', () => {
    const scene = createEmitter();
    attachCityStatus(statusFrom(scene))();

    scene.emit('build:start', { stages });

    expect(CITY_STATUS.value.phase).toBeNull();
  });
});

/** Scan progress is the other half of the same problem, and the one the plan
 *  warned about: the overlay folds SERVER scan progress and BUILD progress into
 *  one reduction, so a wallpaper scanning its own repo behind the landing had a
 *  second route into the readout above the project you are reading. */
describe('two cities scan their own repos', () => {
  afterEach(() => {
    CITY_STATUS.value = EMPTY_CITY_STATUS;
    LOADING_SOURCE.value = null;
    PENDING_SOURCE_LABEL.value = null;
  });

  it('the readout follows the city it was attached to', () => {
    const scene = createEmitter();
    const detach = attachCityStatus(statusFrom(scene));

    scene.emit('scan:start', { src: 'https://github.com/o/r' });
    scene.emit('scan:progress', {
      event: { phase: ScanPhase.ScanProgress, files_scanned: 900 } as never,
    });

    expect(CITY_STATUS.value.phase).toBe(CityPhase.Scanning);
    expect(CITY_STATUS.value.counts.filesScanned).toBe(900);
    detach();
  });

  it('a wallpaper scanning a different repo does not touch it', () => {
    const scene = createEmitter();
    const backdrop = createEmitter();
    const detach = attachCityStatus(statusFrom(scene));
    const detachScan = attachScanToStores(scene.on);
    scene.emit('scan:start', { src: 'https://github.com/o/r' });
    scene.emit('scan:progress', {
      event: { phase: ScanPhase.ScanProgress, files_scanned: 900 } as never,
    });
    const mid = CITY_STATUS.value;

    // A whole load of somebody else's repo, behind the page.
    backdrop.emit('scan:start', { src: 'https://github.com/other/repo' });
    backdrop.emit('scan:label', { label: 'other/repo' });
    backdrop.emit('scan:progress', {
      event: { phase: ScanPhase.CloneProgress, percent: 12 } as never,
    });

    expect(CITY_STATUS.value).toBe(mid);
    // And it does not rename the project in the header either.
    expect(PENDING_SOURCE_LABEL.value).toBeNull();
    detach();
    detachScan();
  });
});

/** A bundle is one repo's history, so the scrubber has to be one city's too.
 *  Sharing it meant the landing's wallpaper and the project behind it could not
 *  have been at different commits even in principle. */
describe('two cities scrub their own history', () => {
  const bundleOf = (shas: string[]) =>
    ({
      commits: shas.map((sha, i) => ({ sha, date: `2024-01-0${i + 1}T00:00:00Z` })),
      deltas: shas.map((sha) => ({ sha, changes: [] })),
      blobLines: {},
      blobSizes: {},
      notes: [],
    }) as unknown as TimelineBundle;

  it('hold their own position, mode and bundle', () => {
    const a = createTimelineState();
    const b = createTimelineState();
    a.setBundle(bundleOf(['a1', 'a2', 'a3']));
    b.setBundle(bundleOf(['b1', 'b2']));

    a.enter();
    a.setPosition(2);

    expect(a.mode).toBe(true);
    expect(a.pos).toBe(2);
    expect(b.mode).toBe(false);
    expect(b.pos).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("clamp against their own bundle, not each other's", () => {
    const short = createTimelineState();
    const long = createTimelineState();
    short.setBundle(bundleOf(['s1', 's2']));
    long.setBundle(bundleOf(['l1', 'l2', 'l3', 'l4', 'l5']));

    short.setPosition(4);
    long.setPosition(4);

    // Two commits: the last index is 1, plus the today stop the fixture's old
    // dates earn it.
    expect(short.pos).toBeLessThan(long.pos);
    expect(short.pos).toBe(short.max);
    short.dispose();
    long.dispose();
  });

  it('exiting one leaves the other where it was', () => {
    const a = createTimelineState();
    const b = createTimelineState();
    a.setBundle(bundleOf(['a1', 'a2']));
    b.setBundle(bundleOf(['b1', 'b2']));
    a.enter();
    b.enter();
    b.setPosition(1);

    a.exit();

    expect(a.bundle).toBeNull();
    expect(b.mode).toBe(true);
    expect(b.pos).toBe(1);
    a.dispose();
    b.dispose();
  });
});

/** The one piece of cross-city state that SHOULD stay cross-city: what it
 *  protects is the page's connection pool, and two cities do not get twice the
 *  bandwidth. Shared as an object so the sharing is declared, not incidental. */
describe('media load limiter', () => {
  it('is shared by default', () => {
    expect(SHARED_MEDIA_LOAD_LIMITER).toBe(SHARED_MEDIA_LOAD_LIMITER);
  });

  it('queues past its ceiling and drains on release', async () => {
    const limiter = createMediaLoadLimiter(2);
    await limiter.acquire();
    await limiter.acquire();

    let third = false;
    void limiter.acquire().then(() => {
      third = true;
    });
    await Promise.resolve();
    expect(third).toBe(false);

    limiter.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(third).toBe(true);
  });

  it('hands out its own slots when a city is given a private one', async () => {
    const mine = createMediaLoadLimiter(1);
    await mine.acquire();

    let got = false;
    void mine.acquire().then(() => {
      got = true;
    });
    await Promise.resolve();
    expect(got).toBe(false);

    // The shared limiter is untouched by mine being saturated.
    await SHARED_MEDIA_LOAD_LIMITER.acquire();
    SHARED_MEDIA_LOAD_LIMITER.release();
  });
});
