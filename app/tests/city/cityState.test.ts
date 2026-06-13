// Unit coverage for the per-city signals object that replaced the old mutable
// cityState bag. Asserts: independent instances, the four source signals are
// settable, and the two computeds (rootStreet / gemWorldPos) derive off layout
// exactly as the old _computeRootStreetAndGem did — including the
// orientation-aware gem anchor math for BOTH axes and the null cases.

import { describe, it, expect } from 'vitest';
import { StreetAxis, NodeKind } from '@/types';
import type { CityLayout, Street } from '@/types';
import { makeCityState } from '../_helpers/cityFixtures';

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

describe('createCityState', () => {
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
});
