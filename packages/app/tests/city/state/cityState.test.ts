// What a city holds and what it derives: independent instances, the values an
// apply fills in, and the geometry that follows from a layout — the gem anchor
// on both street axes included, since that maths is orientation-aware.

import { describe, it, expect } from 'vitest';
import { makeCityState, seedCityState, stubPlacementClient } from '../../_helpers/cityFixtures';
import { Building } from '@/city/types/building';
import { NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';
import type { CityState } from '@/city/state';
import { settingsStore } from '../../_helpers/citySettings';
import { createEmitter } from '@/city/events';
import { createCityState } from '@/city/state';
import { createTestCityResources } from '../../_helpers/cityResources';

// Minimal Street — rootStreet only reads streets[].isRoot; gemWorldPos reads
// x/y/width/length/orientation. The rest is cast away.
function makeStreet(over: Partial<Street>): Street {
  return {
    x: 0,
    y: 0,
    width: 10,
    length: 100,
    label: 'root',
    orientation: StreetAxis.X,
    isRoot: false,
    dir: { name: 'root', path: 'root', type: NodeKind.Directory },
    ...over,
  } as unknown as Street;
}

function makeLayout(streets: Street[]): CityLayout {
  return { buildings: [], streets } as unknown as CityLayout;
}

// A city showing `layout`, published the way an apply publishes one — which is
// the only way the derived geometry (bbox, rootStreet, gem anchor) is computed.
function withLayout(layout: CityLayout): Promise<CityState> {
  return seedCityState(layout);
}

describe('createCityState', () => {
  it('constructs independent instances (not a module singleton)', async () => {
    const a = await withLayout(makeLayout([]));
    const b = makeCityState();
    expect(a.manifest).not.toBeNull();
    expect(b.manifest).toBeNull();
  });

  it('starts empty, and an apply fills it in', async () => {
    const empty = makeCityState();
    expect(empty.manifest).toBeNull();
    expect(empty.layout).toBeNull();
    expect(empty.bbox).toBeNull(); // derived from the layout, so null when unset
    expect(empty.latestWorldBounds).toBeNull();

    const cs = await withLayout(makeLayout([]));
    expect(cs.layout?.streets).toEqual([]);
    expect(cs.manifest).not.toBeNull();
  });

  it('bbox computes from layout and memoizes between structure changes', async () => {
    let cs = makeCityState();
    expect(cs.bbox).toBeNull(); // null until the first structure apply
    cs = await withLayout(makeLayout([])); // no streets/buildings → fallback box
    const box = cs.bbox;
    expect(box).not.toBeNull();
    // Memoized: re-reading without a structure change (= a reuse apply)
    // returns the SAME Box3 reference — this is the scenic-skip for cameraRig.
    expect(cs.bbox).toBe(box);
    // A new structure reference recomputes a fresh box.
    cs = await withLayout(makeLayout([]));
    expect(cs.bbox).not.toBe(box);
  });

  it('rootStreet computes the first isRoot street, null when none', async () => {
    let cs = makeCityState();
    expect(cs.rootStreet).toBeNull(); // no layout yet

    const child = makeStreet({ label: 'child', isRoot: false });
    const root = makeStreet({ label: 'root', isRoot: true, x: 5 });
    cs = await withLayout(makeLayout([child, root]));
    expect(cs.rootStreet).toBe(root);

    cs = await withLayout(makeLayout([child])); // no root
    expect(cs.rootStreet).toBeNull();
  });

  it('gemWorldPos derives the orientation-X anchor math', async () => {
    const root = makeStreet({
      isRoot: true,
      orientation: StreetAxis.X,
      x: 100,
      y: 20,
      width: 10,
      length: 80,
    });
    const cs = await withLayout(makeLayout([root]));
    const pos = cs.gemWorldPos!;
    // orientation 'x' → set(x - length/2 + width/2, 0, y)
    expect(pos.x).toBe(100 - 80 / 2 + 10 / 2); // 65
    expect(pos.y).toBe(0);
    expect(pos.z).toBe(20);
  });

  it('gemWorldPos derives the orientation-Z anchor math', async () => {
    const root = makeStreet({
      isRoot: true,
      orientation: StreetAxis.Y, // 'y' (non-'x' branch)
      x: 100,
      y: 20,
      width: 10,
      length: 80,
    });
    const cs = await withLayout(makeLayout([root]));
    const pos = cs.gemWorldPos!;
    // else branch → set(x, 0, y - length/2 + width/2)
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(0);
    expect(pos.z).toBe(20 - 80 / 2 + 10 / 2); // -15
  });

  it('gemWorldPos is null when there is no root street', async () => {
    let cs = makeCityState();
    expect(cs.gemWorldPos).toBeNull();
    cs = await withLayout(makeLayout([makeStreet({ isRoot: false })]));
    expect(cs.gemWorldPos).toBeNull();
  });

  it('streetsByDirMap keys streets by dir.path, skipping dirless streets', async () => {
    let cs = makeCityState();
    expect(cs.streetsByDirMap).toEqual({});

    const a = makeStreet({
      dir: { name: 'a', path: 'a', type: NodeKind.Directory },
    } as Partial<Street>);
    const b = makeStreet({
      dir: { name: 'b', path: 'b', type: NodeKind.Directory },
    } as Partial<Street>);
    const dirless = makeStreet({ dir: null } as Partial<Street>);
    cs = await withLayout(makeLayout([a, b, dirless]));

    const map = cs.streetsByDirMap;
    expect(map.a).toBe(a);
    expect(map.b).toBe(b);
    expect(Object.keys(map).sort()).toEqual(['a', 'b']);
  });

  it('the derived geometry follows a structure change', async () => {
    const r1 = makeStreet({ isRoot: true, x: 1, orientation: StreetAxis.X });
    const first = await withLayout(makeLayout([r1]));
    expect(first.rootStreet).toBe(r1);

    const r2 = makeStreet({ isRoot: true, x: 999, orientation: StreetAxis.X });
    const second = await withLayout(makeLayout([r2]));
    expect(second.rootStreet).toBe(r2);
    expect(second.gemWorldPos!.x).not.toBe(first.gemWorldPos!.x);
  });

  describe('tallestBuilding', () => {
    const bld = (over: Partial<Building>): Building =>
      ({ x: 0, y: 0, w: 10, d: 10, h: 10, ...over }) as unknown as Building;
    const layoutOf = (buildings: Building[]): CityLayout =>
      ({ buildings, streets: [] }) as unknown as CityLayout;

    it('is null with no layout and with no buildings', async () => {
      expect(makeCityState().tallestBuilding).toBeNull();
      expect((await withLayout(layoutOf([]))).tallestBuilding).toBeNull();
    });

    it('returns the max-height building', async () => {
      const tall = bld({ x: 5, y: 6, w: 3, d: 4, h: 90 });
      const cs = await withLayout(layoutOf([bld({ h: 10 }), tall, bld({ h: 50 })]));
      expect(cs.tallestBuilding).toBe(tall);
    });

    // Crux of #62: a reuse apply turns placeholder heights real without moving
    // the geometry, so this recomputes per apply, not per structure change.
    it('updates on a reuse apply, which publishes no structure change', async () => {
      // One city, two applies of the SAME layout signature: the second reuses,
      // and the layout it gets back carries the real heights.
      const settings = settingsStore();
      let next = layoutOf([bld({ h: 20 })]); // skeleton placeholder
      const cs = createCityState(
        { compute: async () => next, dispose() {} } as never,
        stubPlacementClient() as never,
        createTestCityResources(settings),
        settings,
        createEmitter()
      );
      const m = { tree: { name: 'r' }, structure_signature: 's', layout_signature: 's' };
      await cs.applyManifest(m as never);
      expect(cs.tallestBuilding!.h).toBe(20);

      let structures = 0;
      cs.on('structure', () => structures++);
      next = layoutOf([bld({ h: 200 })]); // the final, real heights
      await cs.applyManifest(m as never);

      expect(cs.tallestBuilding!.h).toBe(200);
      expect(structures).toBe(0); // a reuse: the geometry did not move
    });
  });
});
