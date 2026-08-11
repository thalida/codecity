// Scrub states into buffer writes. Real InstancedMeshes rather than a mock:
// setMatrixAt/setColorAt are CPU-side and needsUpdate bumps a real `version`,
// so the re-upload dedup is observed rather than counted by a stub. The
// decisions themselves live in scrubState.test.ts.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';

import { createBuildingScrubApply } from '@/city/components/buildings/scrubApply';
import {
  BuildingLane,
  blankBuildingScrubState,
  type BuildingScrubState,
} from '@/city/components/buildings/scrubState';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedFacadePanels } from '@/city/components/buildings/facadePanels';
import type { Building } from '@/types';
import { makeBuilding, makeFile } from '../../../_helpers/scrub';

const ATTRS: [string, number][] = [
  ['iFade', 3],
  ['iFloors', 1],
  ['iModifiedAge', 1],
  ['iIconUV', 4],
  ['iKind', 1],
];

function makeMesh(count = 2): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry();
  for (const [name, size] of ATTRS) {
    geometry.setAttribute(
      name,
      new THREE.InstancedBufferAttribute(new Float32Array(count * size), size)
    );
  }
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  return mesh;
}

const attrOf = (mesh: THREE.InstancedMesh, name: string) =>
  mesh.geometry.getAttribute(name) as THREE.BufferAttribute;

function state(over: Partial<BuildingScrubState> = {}): BuildingScrubState {
  return { ...blankBuildingScrubState(), ...over };
}

const PRESENT = {
  lane: BuildingLane.Present,
  op: 1,
  height: 8,
  floors: 4,
  bodyOp: 0.6,
  silhouette: 1,
  outlineOp: 0.4,
  colorBase: 'hsl(0, 100%, 50%)',
  kind: 3,
  modifiedAge: 0.25,
  createdAge: 0.75,
} as const;

describe('applying a scrub frame', () => {
  const file = makeFile({ path: 'f.txt' });
  let b: Building;
  let mesh: THREE.InstancedMesh;
  let apply: (states: ReadonlyMap<string, BuildingScrubState>) => void;
  let panelFades: Map<string, number | null | undefined>;

  beforeEach(() => {
    b = makeBuilding(file, { x: 5, y: 7, w: 2, d: 3, slotId: 0 });
    mesh = makeMesh();
    const index = new BuildingIndex();
    index.insert(b);
    panelFades = new Map();
    const panels = {
      applyBuildingFades: (getFade: (p: string) => number | null | undefined) => {
        panelFades.set('f.txt', getFade('f.txt'));
        panelFades.set('unknown.txt', getFade('unknown.txt'));
      },
    } as unknown as InstancedFacadePanels;
    apply = createBuildingScrubApply({
      getBuildingIndex: () => index,
      getMeshForBuilding: () => ({ mesh, slot: 0 }),
      getFacadePanels: () => panels,
    });
  });

  const run = (over: Partial<BuildingScrubState>) => apply(new Map([['f.txt', state(over)]]));

  const matrix = () => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    return m;
  };

  it('scales to the resolved height and sits the building on the ground', () => {
    run(PRESENT);
    const e = matrix().elements;
    expect(e[0]).toBeCloseTo(b.w, 5);
    expect(e[5]).toBeCloseTo(8, 5);
    expect(e[10]).toBeCloseTo(b.d, 5);
    expect(e[13]).toBeCloseTo(4, 5); // height / 2
  });

  it('bakes the age lean into the matrix, so the picker and outline follow it', () => {
    run({ ...PRESENT, tiltX: 0.1, tiltZ: -0.2 });
    const e = matrix().elements;
    // The lean shears the Y column (column-major slots 4 and 6).
    expect(e[4]).toBeCloseTo(8 * 0.1, 5);
    expect(e[6]).toBeCloseTo(8 * -0.2, 5);
    expect(e[12]).toBeCloseTo(b.x + 4 * 0.1, 5);
  });

  it('zero-scales an absent building on every axis, not into a flat quad', () => {
    // A (w, 0, d) quad still writes depth and outlines as a cutout on the road.
    run({ lane: BuildingLane.Absent });
    const e = matrix().elements;
    expect(e[0]).toBe(0);
    expect(e[5]).toBe(0);
    expect(e[10]).toBe(0);
  });

  it('writes all three iFade channels from the state', () => {
    run(PRESENT);
    const iFade = attrOf(mesh, 'iFade');
    expect(iFade.getX(0)).toBeCloseTo(0.6, 5);
    expect(iFade.getY(0)).toBe(1);
    expect(iFade.getZ(0)).toBeCloseTo(0.4, 5);
  });

  it('drives iFade even for an absent building, so a Live fade sweep cannot linger', () => {
    attrOf(mesh, 'iFade').setXYZ(0, 1, 1, 0.8);
    run({ lane: BuildingLane.Absent });
    const iFade = attrOf(mesh, 'iFade');
    expect(iFade.getX(0)).toBe(0);
    expect(iFade.getY(0)).toBe(0);
    expect(iFade.getZ(0)).toBe(0);
  });

  it('rewrites iKind on every lane, so a state change always resets it', () => {
    run({ ...PRESENT, kind: 3 });
    expect(attrOf(mesh, 'iKind').getX(0)).toBe(3);
    run({ lane: BuildingLane.Absent, kind: 0 });
    expect(attrOf(mesh, 'iKind').getX(0)).toBe(0);
  });

  it('writes the window rows and the two age channels for a present building', () => {
    run(PRESENT);
    expect(attrOf(mesh, 'iFloors').getX(0)).toBe(4);
    expect(attrOf(mesh, 'iModifiedAge').getX(0)).toBeCloseTo(0.25, 5);
    expect(attrOf(mesh, 'iIconUV').getW(0)).toBeCloseTo(0.75, 5);
  });

  it('blanks the facade of a ruin but leaves its ages alone: it has no date here', () => {
    attrOf(mesh, 'iModifiedAge').setX(0, 0.9);
    attrOf(mesh, 'iIconUV').setW(0, 0.9);
    run({ lane: BuildingLane.Ruin, height: 1.4, floors: 0, colorBase: 'hsl(0, 0%, 50%)' });
    expect(attrOf(mesh, 'iFloors').getX(0)).toBe(0);
    expect(attrOf(mesh, 'iModifiedAge').getX(0)).toBeCloseTo(0.9, 5);
    expect(attrOf(mesh, 'iIconUV').getW(0)).toBeCloseTo(0.9, 5);
  });

  it('leaves an absent building s shape and colour buffers untouched', () => {
    attrOf(mesh, 'iFloors').setX(0, 7);
    mesh.setColorAt(0, new THREE.Color(1, 0, 0));
    run({ lane: BuildingLane.Absent });
    expect(attrOf(mesh, 'iFloors').getX(0)).toBe(7);
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.r).toBe(1);
  });

  it('lerps the base colour toward the pull by the mix, in working space', () => {
    run({
      lane: BuildingLane.Ruin,
      colorBase: 'rgb(255, 255, 255)',
      colorToward: { r: 0, g: 0, b: 0 },
      colorMix: 0.5,
    });
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    const white = new THREE.Color('rgb(255, 255, 255)');
    expect(c.r).toBeCloseTo(white.r * 0.5, 5);
  });

  it('leaves the colour at the base when nothing pulls it', () => {
    run({ ...PRESENT, colorBase: 'rgb(255, 0, 0)', colorToward: null });
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(new THREE.Color('rgb(255, 0, 0)').getHex());
  });

  it('fades ad panels with a present body and hides them on every other lane', () => {
    run(PRESENT);
    expect(panelFades.get('f.txt')).toBeCloseTo(0.6, 5);

    run({ lane: BuildingLane.Ruin, colorBase: 'hsl(0, 0%, 50%)', bodyOp: 0.3 });
    // A ruin shows a stub, never its media image.
    expect(panelFades.get('f.txt')).toBe(0);
  });

  it('hides an undriven panel rather than letting it linger at its shown default', () => {
    // 0, not null: null means "leave untouched" to Live's fader, which would
    // strand a panel from before the scrub started.
    run(PRESENT);
    expect(panelFades.get('unknown.txt')).toBe(0);
  });
});

describe('re-upload flags', () => {
  it('flags each shared buffer exactly once however many buildings write to it', () => {
    const mesh = makeMesh(2);
    const index = new BuildingIndex();
    const a = makeBuilding(makeFile({ path: 'a.txt' }), { slotId: 0 });
    const b = makeBuilding(makeFile({ path: 'b.txt' }), { slotId: 1 });
    index.insert(a);
    index.insert(b);

    const apply = createBuildingScrubApply({
      getBuildingIndex: () => index,
      getMeshForBuilding: (x) => ({ mesh, slot: x === a ? 0 : 1 }),
      getFacadePanels: () => null,
    });

    const before = {
      matrix: mesh.instanceMatrix.version,
      color: mesh.instanceColor!.version,
      fade: attrOf(mesh, 'iFade').version,
    };
    apply(
      new Map([
        ['a.txt', state(PRESENT)],
        ['b.txt', state(PRESENT)],
      ])
    );

    expect(mesh.instanceMatrix.version - before.matrix).toBe(1);
    expect(mesh.instanceColor!.version - before.color).toBe(1);
    expect(attrOf(mesh, 'iFade').version - before.fade).toBe(1);
  });

  it('forgets last frame s meshes, so a rebuild s disposed cells stop being flagged', () => {
    // A rebuild swaps every cell. Holding the old meshes in the touched-set
    // would keep uploading to geometry the GPU has already released.
    const oldMesh = makeMesh(1);
    const newMesh = makeMesh(1);
    let live = oldMesh;
    const index = new BuildingIndex();
    index.insert(makeBuilding(makeFile({ path: 'a.txt' }), { slotId: 0 }));
    const apply = createBuildingScrubApply({
      getBuildingIndex: () => index,
      getMeshForBuilding: () => ({ mesh: live, slot: 0 }),
      getFacadePanels: () => null,
    });
    const states = new Map([['a.txt', state(PRESENT)]]);

    apply(states);
    const stale = oldMesh.instanceMatrix.version;
    live = newMesh;
    apply(states);

    expect(oldMesh.instanceMatrix.version).toBe(stale);
    expect(newMesh.instanceMatrix.version).toBeGreaterThan(0);
  });
});

describe('a building with no detail mesh', () => {
  it('is skipped without stopping the buildings around it', () => {
    // Most cells sit at impostor LOD on a large repo, so getMeshForBuilding
    // returns null far more often than not.
    const mesh = makeMesh(1);
    const index = new BuildingIndex();
    const lod = makeBuilding(makeFile({ path: 'lod.txt' }), { slotId: 0 });
    const real = makeBuilding(makeFile({ path: 'real.txt' }), { slotId: 0 });
    index.insert(lod);
    index.insert(real);

    const apply = createBuildingScrubApply({
      getBuildingIndex: () => index,
      getMeshForBuilding: (x) => (x === real ? { mesh, slot: 0 } : null),
      getFacadePanels: () => null,
    });
    apply(
      new Map([
        ['lod.txt', state(PRESENT)],
        ['real.txt', state({ ...PRESENT, height: 12 })],
      ])
    );

    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(m.elements[5]).toBeCloseTo(12, 5);
  });
});
