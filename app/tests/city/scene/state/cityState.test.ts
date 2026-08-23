// The per-city signals object: independent instances, four settable source
// signals, and two computeds (rootStreet / gemWorldPos) deriving off layout,
// gem anchor math on both axes and the null cases included.

import { describe, it, expect } from 'vitest';
import { StreetAxis, NodeKind } from '@/types';
import type { Building, CityLayout, Street } from '@/types';
import { makeCityState } from '../../../_helpers/cityFixtures';

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

// Drive a structure-change apply: set the layout data, then bump the structure
// tick the structure-reactive consumers (rootStreet/bbox) track + peek.
function applyStructure(cs: ReturnType<typeof makeCityState>, layout: CityLayout): void {
  cs.layout.value = layout;
  cs.structureRevision.value++;
}

describe('createCityBuild', () => {
  it('constructs independent instances (not a module singleton)', () => {
    const a = makeCityState();
    const b = makeCityState();
    a.manifest.value = { tree: { name: 'a' } } as never;
    expect(b.manifest.value).toBeNull();
    expect(a.manifest).not.toBe(b.manifest);
  });

  it('source signals start null and are settable', () => {
    const cs = makeCityState();
    expect(cs.manifest.value).toBeNull();
    expect(cs.layout.value).toBeNull();
    expect(cs.bbox.value).toBeNull(); // computed (off structureRevision + layout), null when unset
    expect(cs.latestWorldBounds.value).toBeNull();

    cs.layout.value = makeLayout([]);
    cs.manifest.value = { tree: { name: 'x' } } as never;
    expect(cs.layout.value?.streets).toEqual([]);
    expect(cs.manifest.value).not.toBeNull();
  });

  it('bbox computes from layout and memoizes between structure changes', () => {
    const cs = makeCityState();
    expect(cs.bbox.value).toBeNull(); // null until the first structure apply
    applyStructure(cs, makeLayout([])); // no streets/buildings → fallback box
    const box = cs.bbox.value;
    expect(box).not.toBeNull();
    // Memoized: re-reading without a structure change (= a reuse apply)
    // returns the SAME Box3 reference — this is the scenic-skip for cameraRig.
    expect(cs.bbox.value).toBe(box);
    // A new structure reference recomputes a fresh box.
    applyStructure(cs, makeLayout([]));
    expect(cs.bbox.value).not.toBe(box);
  });

  it('rootStreet computes the first isRoot street, null when none', () => {
    const cs = makeCityState();
    expect(cs.rootStreet.value).toBeNull(); // no layout yet

    const child = makeStreet({ label: 'child', isRoot: false });
    const root = makeStreet({ label: 'root', isRoot: true, x: 5 });
    applyStructure(cs, makeLayout([child, root]));
    expect(cs.rootStreet.value).toBe(root);

    applyStructure(cs, makeLayout([child])); // no root
    expect(cs.rootStreet.value).toBeNull();
  });

  it('gemWorldPos derives the orientation-X anchor math', () => {
    const cs = makeCityState();
    const root = makeStreet({
      isRoot: true,
      orientation: StreetAxis.X,
      x: 100,
      y: 20,
      width: 10,
      length: 80,
    });
    applyStructure(cs, makeLayout([root]));
    const pos = cs.gemWorldPos.value!;
    // orientation 'x' → set(x - length/2 + width/2, 0, y)
    expect(pos.x).toBe(100 - 80 / 2 + 10 / 2); // 65
    expect(pos.y).toBe(0);
    expect(pos.z).toBe(20);
  });

  it('gemWorldPos derives the orientation-Z anchor math', () => {
    const cs = makeCityState();
    const root = makeStreet({
      isRoot: true,
      orientation: StreetAxis.Y, // 'y' (non-'x' branch)
      x: 100,
      y: 20,
      width: 10,
      length: 80,
    });
    applyStructure(cs, makeLayout([root]));
    const pos = cs.gemWorldPos.value!;
    // else branch → set(x, 0, y - length/2 + width/2)
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(0);
    expect(pos.z).toBe(20 - 80 / 2 + 10 / 2); // -15
  });

  it('gemWorldPos is null when there is no root street', () => {
    const cs = makeCityState();
    expect(cs.gemWorldPos.value).toBeNull();
    applyStructure(cs, makeLayout([makeStreet({ isRoot: false })]));
    expect(cs.gemWorldPos.value).toBeNull();
  });

  it('streetsByDirMap keys streets by dir.path, skipping dirless streets', () => {
    const cs = makeCityState();
    expect(cs.streetsByDirMap.value).toEqual({});

    const a = makeStreet({
      dir: { name: 'a', path: 'a', type: NodeKind.Directory },
    } as Partial<Street>);
    const b = makeStreet({
      dir: { name: 'b', path: 'b', type: NodeKind.Directory },
    } as Partial<Street>);
    const dirless = makeStreet({ dir: null } as Partial<Street>);
    applyStructure(cs, makeLayout([a, b, dirless]));

    const map = cs.streetsByDirMap.value;
    expect(map.a).toBe(a);
    expect(map.b).toBe(b);
    expect(Object.keys(map).sort()).toEqual(['a', 'b']);
  });

  it('computeds react to a structure change', () => {
    const cs = makeCityState();
    const r1 = makeStreet({ isRoot: true, x: 1, orientation: StreetAxis.X });
    applyStructure(cs, makeLayout([r1]));
    expect(cs.rootStreet.value).toBe(r1);
    const z1 = cs.gemWorldPos.value!.x;

    const r2 = makeStreet({ isRoot: true, x: 999, orientation: StreetAxis.X });
    applyStructure(cs, makeLayout([r2]));
    expect(cs.rootStreet.value).toBe(r2);
    expect(cs.gemWorldPos.value!.x).not.toBe(z1);
  });

  describe('tallestBuilding', () => {
    const bld = (over: Partial<Building>): Building =>
      ({ x: 0, y: 0, w: 10, d: 10, h: 10, ...over }) as unknown as Building;
    const layoutOf = (buildings: Building[]): CityLayout =>
      ({ buildings, streets: [] }) as unknown as CityLayout;

    it('is null with no layout and with no buildings', () => {
      const cs = makeCityState();
      expect(cs.tallestBuilding.value).toBeNull();
      cs.layout.value = layoutOf([]);
      expect(cs.tallestBuilding.value).toBeNull();
    });

    it('returns the max-height building', () => {
      const cs = makeCityState();
      const tall = bld({ x: 5, y: 6, w: 3, d: 4, h: 90 });
      cs.layout.value = layoutOf([bld({ h: 10 }), tall, bld({ h: 50 })]);
      expect(cs.tallestBuilding.value).toBe(tall);
    });

    // A reuse apply reassigns `layout` without bumping structureRevision, so
    // tallestBuilding must track `layout` or frame the placeholder height.
    it('updates when layout is reassigned without a structureRevision bump', () => {
      const cs = makeCityState();
      cs.layout.value = layoutOf([bld({ h: 20 })]); // skeleton placeholder height
      expect(cs.tallestBuilding.value!.h).toBe(20);

      cs.layout.value = layoutOf([bld({ h: 200 })]); // final real height — no structureRevision++
      expect(cs.tallestBuilding.value!.h).toBe(200);
    });
  });
});
