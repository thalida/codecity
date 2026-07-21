// streetOpacity.test.ts — per-street opacity plumbing for Timeline-mode fades.
//
// Streets carry a per-vertex `aOpacity` float (default 1) on BOTH the merged
// sidewalk and merged asphalt geometries; setStreetOpacity writes it over that
// street's vertex span. Materials stay `transparent: false` by default (the
// alpha is written but never blended → live mode renders byte-identical);
// setStreetsTransparent(true) flips both into the transparent pass.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';

import { createStreets } from '@/city/components/streets';
import { makeCityState } from '../../../_helpers/cityFixtures';
import { STREETS } from '@/state/stores/settings/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, PickTarget, Street } from '@/types';
import type { Picker } from '@/city/interaction/picker';
import type { SceneContext } from '@/city/types';

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

function makeCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    canvas: document.createElement('canvas'),
    picker: { selection: signal<PickTarget | null>(null), hover: signal<PickTarget | null>(null) } as unknown as Picker,
    cityState: makeCityState(),
  } as unknown as SceneContext;
}

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
function spanIs(attr: THREE.BufferAttribute, vStart: number, vCount: number, expected: number): boolean {
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
    streets = createStreets(makeCtx());
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
    streets = createStreets(makeCtx());
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

  it('setStreetsTransparent(true) moves both materials into the transparent pass', () => {
    streets = createStreets(makeCtx());
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
