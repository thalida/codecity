// streetOpacity.test.ts — the per-street alpha Timeline fades with. It is
// written on both merged meshes but never blended until the materials are
// flipped transparent, so live mode renders byte-identically.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

import { createStreets } from '@/city/components/streets';
import {
  RUINED_STREET_DIRS,
  StreetTint,
  type StreetScrubState,
} from '@/city/components/streets/scrubState';
import { makeSceneContext } from '../../../_helpers/cityFixtures';
import { STREETS } from '@/state/settings/fields/streets';
import { NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';

const DEFAULTS = {
  ASPHALT_COLOR: '#313544',
  SIDEWALK_DEFAULT: '#4b5163',
  SIDEWALK_HOVER: '#6d6e74',
  SIDEWALK_SELECTED: '#ffffff',
  LABEL_FILL: '#ffffff',
  LABEL_STROKE: 'rgba(8, 9, 14, 0.95)',
  LABEL_STROKE_WIDTH_FRAC: 0.2,
  LABEL_HEIGHT_FRAC: 0.5,
  PATH_LINEWIDTH_PCT: 15,
  PATH_OPACITY: 0.95,
  HOVER_PATH_COLOR: '#ffffff',
  HOVER_PATH_OPACITY: 0.25,
};

function mkStreet(path: string, over: Partial<Street> = {}): Street {
  return {
    x: 0,
    y: 0,
    width: 32,
    length: 600,
    label: path,
    orientation: StreetAxis.X,
    isRoot: false,
    dir: { name: path, path, type: NodeKind.Directory },
    ...over,
  } as unknown as Street;
}

function threeStreetLayout(): CityLayout {
  return {
    buildings: [],
    streets: [
      mkStreet('a', { x: 0, isRoot: true }),
      mkStreet('b', { x: 500, orientation: StreetAxis.Y }),
      mkStreet('c', { x: -500, length: 800 }),
    ],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: { minX: -900, minY: -16, maxX: 900, maxY: 16, cx: 0, cy: 0, width: 1800, depth: 32 },
  } as unknown as CityLayout;
}

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
function asphaltMeshOf(s: ReturnType<typeof createStreets>): FlatMesh {
  return s.group.children.find((c) => c.name === 'city-asphalt') as FlatMesh;
}
function opacityAttr(mesh: FlatMesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute('aOpacity') as THREE.BufferAttribute;
}
// Every value in a vertex span equals `expected` (Float32-rounded).
function spanIs(
  attr: THREE.BufferAttribute,
  vStart: number,
  vCount: number,
  expected: number
): boolean {
  const arr = attr.array as Float32Array;
  const want = Math.fround(expected);
  for (let v = vStart; v < vStart + vCount; v++) if (arr[v] !== want) return false;
  return true;
}

describe('street opacity', () => {
  let streets: ReturnType<typeof createStreets>;

  beforeEach(() => {
    STREETS.value = { ...DEFAULTS } as unknown as typeof STREETS.value;
  });
  afterEach(() => {
    streets?.dispose();
  });

  it('seeds aOpacity to 1 on both merged meshes and keeps materials opaque by default', () => {
    streets = createStreets(makeSceneContext());
    streets.rebuild(threeStreetLayout());

    const sidewalk = streets.getPickables()[0] as FlatMesh;
    const asphalt = asphaltMeshOf(streets);
    const swOp = opacityAttr(sidewalk);
    const asOp = opacityAttr(asphalt);

    expect(swOp.count).toBe(sidewalk.geometry.getAttribute('position').count);
    expect(asOp.count).toBe(asphalt.geometry.getAttribute('position').count);
    expect(spanIs(swOp, 0, swOp.count, 1)).toBe(true);
    expect(spanIs(asOp, 0, asOp.count, 1)).toBe(true);

    // Byte-identical live mode: streets stay in the opaque pass until Timeline enters.
    expect(sidewalk.material.transparent).toBe(false);
    expect(asphalt.material.transparent).toBe(false);
  });

  it('setStreetOpacity writes only the target street span on both meshes', () => {
    streets = createStreets(makeSceneContext());
    streets.rebuild(threeStreetLayout());

    const sidewalk = streets.getPickables()[0] as FlatMesh;
    const asphalt = asphaltMeshOf(streets);
    const ranges = streets.getStreetRanges();
    const asphaltRanges = streets.getAsphaltRanges();
    expect(ranges).toHaveLength(3);
    expect(asphaltRanges).toHaveLength(3);

    const target = ranges[1].street;
    const swVer = opacityAttr(sidewalk).version;
    const asVer = opacityAttr(asphalt).version;

    streets.setStreetOpacity(target, 0.3);

    const swOp = opacityAttr(sidewalk);
    const asOp = opacityAttr(asphalt);
    // The middle street's sidewalk span is 0.3; the two flanking streets stay 1.
    expect(spanIs(swOp, ranges[1].vStart, ranges[1].vCount, 0.3)).toBe(true);
    expect(spanIs(swOp, ranges[0].vStart, ranges[0].vCount, 1)).toBe(true);
    expect(spanIs(swOp, ranges[2].vStart, ranges[2].vCount, 1)).toBe(true);
    // The asphalt of the same street fades in lockstep, on its own (narrower) span; flanking asphalt stays 1.
    expect(spanIs(asOp, asphaltRanges[1].vStart, asphaltRanges[1].vCount, 0.3)).toBe(true);
    expect(spanIs(asOp, asphaltRanges[0].vStart, asphaltRanges[0].vCount, 1)).toBe(true);
    expect(spanIs(asOp, asphaltRanges[2].vStart, asphaltRanges[2].vCount, 1)).toBe(true);

    // Deduped GPU upload: a single needsUpdate bump per call, not per vertex.
    expect(swOp.version).toBe(swVer + 1);
    expect(asOp.version).toBe(asVer + 1);
  });

  it("setStreetLabelOpacity fades one street's labels without touching another street's", () => {
    streets = createStreets(makeSceneContext());
    streets.rebuild(threeStreetLayout());

    const ranges = streets.getStreetRanges();
    const target = ranges[1].street;
    const other = ranges[0].street;
    const labelsOf = (s: Street) =>
      streets.group.children.filter(
        (c) => c.userData.type === NodeKind.Label && c.userData.street === s
      ) as THREE.Group[];

    streets.setStreetLabelOpacity(target, 0.3);

    for (const g of labelsOf(target)) {
      const plane = g.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(plane.material.opacity).toBeCloseTo(0.3, 5);
      expect(g.visible).not.toBe(false); // opacity > 0: LOD (not scrub) owns visibility
    }
    for (const g of labelsOf(other)) {
      const plane = g.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(plane.material.opacity).toBeCloseTo(1, 5);
    }
  });

  it("setStreetLabelOpacity(street, 0) force-hides that street's label group", () => {
    streets = createStreets(makeSceneContext());
    streets.rebuild(threeStreetLayout());

    const ranges = streets.getStreetRanges();
    const target = ranges[1].street;
    const labelsOf = (s: Street) =>
      streets.group.children.filter(
        (c) => c.userData.type === NodeKind.Label && c.userData.street === s
      ) as THREE.Group[];

    streets.setStreetLabelOpacity(target, 0);
    for (const g of labelsOf(target)) expect(g.visible).toBe(false);

    // Bringing it back up unhides it (scrubHidden lifted) even without a camera move.
    streets.setStreetLabelOpacity(target, 1);
    for (const g of labelsOf(target)) expect(g.userData.scrubHidden).toBe(false);
  });

  it('setStreetsTransparent(true) moves both materials into the transparent pass', () => {
    streets = createStreets(makeSceneContext());
    streets.rebuild(threeStreetLayout());

    const sidewalk = streets.getPickables()[0] as FlatMesh;
    const asphalt = asphaltMeshOf(streets);
    const swVer = sidewalk.material.version;
    const asVer = asphalt.material.version;

    streets.setStreetsTransparent(true);
    expect(sidewalk.material.transparent).toBe(true);
    expect(asphalt.material.transparent).toBe(true);
    expect(sidewalk.material.version).toBe(swVer + 1);
    expect(asphalt.material.version).toBe(asVer + 1);

    streets.setStreetsTransparent(false);
    expect(sidewalk.material.transparent).toBe(false);
    expect(asphalt.material.transparent).toBe(false);
  });
});

describe('applying a scrub frame', () => {
  let streets: ReturnType<typeof createStreets>;

  beforeEach(() => {
    STREETS.value = { ...DEFAULTS } as unknown as typeof STREETS.value;
    streets = createStreets(makeSceneContext());
    streets.rebuild(threeStreetLayout());
    RUINED_STREET_DIRS.clear();
  });
  afterEach(() => {
    streets?.dispose();
    RUINED_STREET_DIRS.clear();
  });

  const scrub = (over: Partial<StreetScrubState> = {}): StreetScrubState => ({
    opacity: 1,
    tint: StreetTint.None,
    ruin: false,
    ...over,
  });

  it('fades each street and tints its asphalt from its own state', () => {
    const ranges = streets.getStreetRanges();
    const asphaltRanges = streets.getAsphaltRanges();
    const asphalt = asphaltMeshOf(streets);

    streets.applyScrub(
      new Map([
        [ranges[0].street, scrub({ opacity: 1 })],
        [ranges[1].street, scrub({ opacity: 0.4, tint: StreetTint.Ruin, ruin: true })],
        [ranges[2].street, scrub({ opacity: 0, tint: StreetTint.None })],
      ])
    );

    const op = opacityAttr(asphalt);
    expect(spanIs(op, asphaltRanges[0].vStart, asphaltRanges[0].vCount, 1)).toBe(true);
    expect(spanIs(op, asphaltRanges[1].vStart, asphaltRanges[1].vCount, 0.4)).toBe(true);
    expect(spanIs(op, asphaltRanges[2].vStart, asphaltRanges[2].vCount, 0)).toBe(true);

    const ruin = asphalt.geometry.getAttribute('aRuin') as THREE.BufferAttribute;
    expect(spanIs(ruin, asphaltRanges[1].vStart, asphaltRanges[1].vCount, StreetTint.Ruin)).toBe(
      true
    );
    expect(spanIs(ruin, asphaltRanges[2].vStart, asphaltRanges[2].vCount, StreetTint.None)).toBe(
      true
    );
  });

  it('republishes the directory sets the picker rejects hits against', () => {
    const ranges = streets.getStreetRanges();
    streets.applyScrub(
      new Map([
        [ranges[1].street, scrub({ ruin: true, tint: StreetTint.Ruin })],
        [ranges[2].street, scrub({ tint: StreetTint.None })],
      ])
    );
    expect([...RUINED_STREET_DIRS]).toEqual([ranges[1].street.dir?.path]);
  });

  it('clears those sets each frame, so a resurrected folder becomes clickable again', () => {
    const ranges = streets.getStreetRanges();
    streets.applyScrub(new Map([[ranges[1].street, scrub({ ruin: true })]]));
    streets.applyScrub(new Map([[ranges[1].street, scrub()]]));
    expect(RUINED_STREET_DIRS.size).toBe(0);
  });
});
