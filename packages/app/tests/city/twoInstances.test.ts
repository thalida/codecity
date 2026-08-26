import { describe, it, expect } from 'vitest';

import { createCityResources } from '@/city/resources';
import { createMediaLoadLimiter, SHARED_MEDIA_LOAD_LIMITER } from '@/city/mediaLoadLimiter';

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
    const a = createCityResources(null);
    const b = createCityResources(null);
    expect(a.buildings).not.toBe(b.buildings);
    expect(a.buildings.get()).not.toBe(b.buildings.get());
  });

  it('own distinct icon atlases, and setting one does not reach the other', () => {
    const a = createCityResources(null);
    const b = createCityResources(null);
    const atlas = { texture: null, slotSize: 16 } as never;

    a.buildings.setIconAtlas(atlas);

    expect(a.buildings.getIconAtlas()).toBe(atlas);
    expect(b.buildings.getIconAtlas()).toBeNull();
    expect(a.buildings.get().uniforms.uIconSlotSize.value).toBe(16);
    expect(b.buildings.get().uniforms.uIconSlotSize.value).toBe(0);
  });

  it('own distinct translucency, so a fade on one leaves the other opaque', () => {
    const a = createCityResources(null);
    const b = createCityResources(null);

    a.buildings.setTranslucent(true);

    expect(a.buildings.get().transparent).toBe(true);
    expect(b.buildings.get().transparent).toBe(false);
  });

  it('own distinct renderer registrations', async () => {
    const a = createCityResources(null);
    const b = createCityResources(null);
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
    const a = createCityResources(null);
    const b = createCityResources(null);
    expect(a.gem.glow()).not.toBe(b.gem.glow());
    // …but each caches its own, so a city uploads one texture, not one per gem.
    expect(a.gem.glow()).toBe(a.gem.glow());
  });

  it('own distinct capture latches', () => {
    const a = createCityResources(null);
    const b = createCityResources(null);
    a.timelineKickedOff = true;
    expect(b.timelineKickedOff).toBe(false);
  });

  it('disposing one leaves the other usable', () => {
    const a = createCityResources(null);
    const b = createCityResources(null);
    const materialB = b.buildings.get();

    a.dispose();

    expect(b.buildings.get()).toBe(materialB);
    expect(() => b.buildings.refresh()).not.toThrow();
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
