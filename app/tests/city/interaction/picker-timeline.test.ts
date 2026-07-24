// picker-timeline.test.ts — Timeline mode fades buildings/trees/streets by
// writing opacity/scale onto their still-in-scene meshes (scrubController,
// treeRenderer.setScrubCommit), so a raycast still hits them. Guards that
// interpretHit rejects a scrub-hidden hit while TIMELINE_MODE is on, and
// leaves live-mode resolution untouched.

import * as THREE from 'three';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { createMergedSidewalkMesh } from '@/city/components/streets/streets';
import { RUINED_STREET_DIRS } from '@/city/timeline/scrubController';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { makeCityState } from '../../_helpers/cityFixtures';
import { NodeKind, StreetAxis } from '@/types';
import type { Building, CommitEntry, PickerWorld, Street } from '@/types';

const FAKE_CAMERA = {} as unknown as THREE.Camera;

function mkBuilding(path: string, x: number, y: number): Building {
  return {
    x,
    y,
    w: 10,
    d: 10,
    h: 20,
    color: '#8899aa',
    file: { path, name: path, type: NodeKind.File, extension: '.ts', size: 100, lines: 50 },
  } as unknown as Building;
}

function makeCellWorld(buildings: Building[]) {
  const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
  const cellOut = buildCellsFromLayout(bounds, buildings);
  cellOut.sceneRoot.updateMatrixWorld(true);
  const cityState = makeCityState();
  const api: PickerWorld = {
    getStreetPickables: () => [],
    getRootGem: () => null,
    getBuildingByPath: () => null,
    getSidewalkByDir: () => null,
    getStreetByDir: () => null,
    getBuildingIndex: () => cellOut.index,
    getCells: () => cellOut.cells,
    getTrees: () => null,
  };
  return Object.assign(api, { cityState, cellOut });
}

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
  PICKER_SELECTION_KEY.value = null;
});
afterEach(() => {
  TIMELINE_MODE.value = false;
  RUINED_STREET_DIRS.clear();
});

describe('picker: Timeline scrub-hidden guard — buildings', () => {
  function setup() {
    const target = mkBuilding('src/a.ts', 40, -30);
    const world = makeCellWorld([target]);
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.position.set(target.x, 400, target.y);
    camera.lookAt(target.x, 0, target.y);
    camera.updateMatrixWorld(true);
    const picker = createPicker({ canvas, camera, world, cityState: world.cityState });
    const building = world.cellOut.index.byPath.get('src/a.ts')!;
    const cell = world.cellOut.cells.get(building.cellId!)!;
    const iFade = cell.detailMesh.geometry.getAttribute('iFade') as THREE.InstancedBufferAttribute;
    const iKind = cell.detailMesh.geometry.getAttribute('iKind') as THREE.InstancedBufferAttribute;
    return { picker, iFade, iKind, slot: building.slotId! };
  }

  it('rejects a hit whose iFade.x is scrub-faded to 0', () => {
    const { picker, iFade, slot } = setup();
    TIMELINE_MODE.value = true;
    iFade.setXYZ(slot, 0, 0, 0);

    const hit = picker.pickAt(400, 300);
    expect(hit).not.toBeNull(); // the raycast still hits the faded (but present) mesh
    expect(picker.interpretHit(hit)).toBeNull();
    picker.dispose();
  });

  it('resolves normally when the same building is at full opacity', () => {
    const { picker, iFade, slot } = setup();
    TIMELINE_MODE.value = true;
    iFade.setXYZ(slot, 1, 0, 0);

    const hit = picker.pickAt(400, 300);
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.File);
    expect(t?.kind === NodeKind.File && t.file.path).toBe('src/a.ts');
    picker.dispose();
  });

  it('a ghost-ruin building is still selectable, flagged isRuin for the tooltip', () => {
    const { picker, iFade, iKind, slot } = setup();
    TIMELINE_MODE.value = true;
    iFade.setXYZ(slot, 1, 0, 0); // visible stub
    iKind.setX(slot, 1); // a ruin

    const t = picker.interpretHit(picker.pickAt(400, 300));
    expect(t?.kind).toBe(NodeKind.File);
    expect(t?.kind === NodeKind.File && t.isRuin).toBe(true);
    picker.dispose();
  });

  it('pruneScrubHiddenSelection drops a selected building the scrub removed', () => {
    const { picker, iFade, slot } = setup();
    TIMELINE_MODE.value = true;
    iFade.setXYZ(slot, 1, 0, 0);
    const sel = picker.interpretHit(picker.pickAt(400, 300));
    picker.setSelection(sel);
    expect(picker.selection.value?.kind).toBe(NodeKind.File);

    // Still present → prune keeps it.
    picker.pruneScrubHiddenSelection();
    expect(picker.selection.value).not.toBeNull();

    // Scrubbed to absent (iFade.x → 0) → prune clears it.
    iFade.setXYZ(slot, 0, 0, 0);
    picker.pruneScrubHiddenSelection();
    expect(picker.selection.value).toBeNull();
    picker.dispose();
  });

  it('live mode (TIMELINE_MODE off) still picks a faded building — guard is a no-op', () => {
    const { picker, iFade, slot } = setup();
    TIMELINE_MODE.value = false;
    iFade.setXYZ(slot, 0, 0, 0);

    const hit = picker.pickAt(400, 300);
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.File);
    picker.dispose();
  });
});

describe('picker: Timeline scrub-hidden guard — trees', () => {
  function makeCanopy(): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
    m.userData.meshKind = 'tree-canopy';
    return m;
  }

  function commit(i: number): CommitEntry {
    return {
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      files: i + 1,
      sha: `${i.toString(16).padStart(8, '0')}${'0'.repeat(32)}`,
      authors: [`Author ${i}`],
      subject: `commit ${i}`,
      same_day_total: 1,
    };
  }

  function makeWorld(canopy: THREE.InstancedMesh, commits: CommitEntry[]) {
    const cityState = makeCityState();
    const api: PickerWorld = {
      getStreetPickables: () => [],
      getRootGem: () => null,
      getBuildingByPath: () => null,
      getSidewalkByDir: () => null,
      getStreetByDir: () => null,
      getBuildingIndex: () => null,
      getCells: () => new Map(),
      getTrees: () => ({
        group: new THREE.Group(),
        commitForInstance: (mesh, instanceId) =>
          mesh === canopy ? (commits[instanceId] ?? null) : null,
        findTreeBySha: () => null,
        getInstanceTransform: () => false,
        colorForSha: () => null,
      }),
    };
    return Object.assign(api, { cityState });
  }

  it('a zero-scaled (future-commit) tree instance is not pickable', () => {
    const canopy = makeCanopy();
    const commits = [commit(0), commit(1)];
    canopy.setMatrixAt(1, new THREE.Matrix4().makeScale(0, 0, 0));
    const world = makeWorld(canopy, commits);
    const picker = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });
    TIMELINE_MODE.value = true;

    const hit = {
      object: canopy,
      instanceId: 1,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    expect(picker.interpretHit(hit)).toBeNull();
    picker.dispose();
  });

  it('a full-scale tree instance resolves normally in Timeline mode', () => {
    const canopy = makeCanopy();
    const commits = [commit(0), commit(1)];
    const world = makeWorld(canopy, commits);
    const picker = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });
    TIMELINE_MODE.value = true;

    const hit = {
      object: canopy,
      instanceId: 1,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.Commit);
    picker.dispose();
  });

  it('live mode still picks a zero-scaled tree instance — guard is a no-op', () => {
    const canopy = makeCanopy();
    const commits = [commit(0), commit(1)];
    canopy.setMatrixAt(1, new THREE.Matrix4().makeScale(0, 0, 0));
    const world = makeWorld(canopy, commits);
    const picker = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });
    TIMELINE_MODE.value = false;

    const hit = {
      object: canopy,
      instanceId: 1,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.Commit);
    picker.dispose();
  });
});

describe('picker: Timeline scrub-hidden guard — streets', () => {
  function mk(path: string, z: number): Street {
    return {
      x: 0,
      y: z,
      width: 24,
      length: 400,
      label: path,
      orientation: StreetAxis.X,
      isRoot: false,
      dir: { name: path, path, type: NodeKind.Directory },
    } as unknown as Street;
  }

  function setup() {
    const streetA = mk('src', 0);
    const streetB = mk('lib', 200);
    const built = createMergedSidewalkMesh([streetA, streetB] as never, 0)!;
    built.mesh.updateMatrixWorld(true);

    const cityState = makeCityState();
    const world = Object.assign(
      {
        getStreetPickables: () => [built.mesh],
        getRootGem: () => null,
        getBuildingByPath: () => null,
        getSidewalkByDir: () => built.mesh,
        getStreetByDir: () => null,
        getBuildingIndex: () => null,
        getCells: () => new Map(),
        getTrees: () => null,
      } as unknown as PickerWorld,
      { cityState }
    );

    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.position.set(0, 300, 200);
    camera.lookAt(0, 0, 200);
    camera.updateMatrixWorld(true);

    const picker = createPicker({ canvas, camera, world, cityState });
    const rangeB = built.ranges.find((r) => r.path === 'lib')!;
    const aOpacity = built.mesh.geometry.getAttribute('aOpacity') as THREE.BufferAttribute;
    return { picker, aOpacity, rangeB };
  }

  it('rejects a hit on a street whose aOpacity is scrub-faded to 0', () => {
    const { picker, aOpacity, rangeB } = setup();
    TIMELINE_MODE.value = true;
    for (let v = rangeB.vStart; v < rangeB.vStart + rangeB.vCount; v++) aOpacity.setX(v, 0);

    const hit = picker.pickAt(400, 300);
    expect(hit).not.toBeNull();
    expect(picker.interpretHit(hit)).toBeNull();
    picker.dispose();
  });

  it('resolves normally when the street is at full opacity', () => {
    const { picker } = setup();
    TIMELINE_MODE.value = true;

    const hit = picker.pickAt(400, 300);
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.Directory);
    expect(t?.kind === NodeKind.Directory && t.dir.path).toBe('lib');
    picker.dispose();
  });

  it('a ruined street is still selectable, flagged isRuin for the tooltip', () => {
    const { picker } = setup();
    TIMELINE_MODE.value = true;
    RUINED_STREET_DIRS.add('lib');

    const t = picker.interpretHit(picker.pickAt(400, 300));
    expect(t?.kind).toBe(NodeKind.Directory);
    expect(t?.kind === NodeKind.Directory && t.isRuin).toBe(true);
    picker.dispose();
  });

  it('live mode still picks a faded street — guard is a no-op', () => {
    const { picker, aOpacity, rangeB } = setup();
    TIMELINE_MODE.value = false;
    for (let v = rangeB.vStart; v < rangeB.vStart + rangeB.vCount; v++) aOpacity.setX(v, 0);

    const hit = picker.pickAt(400, 300);
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.Directory);
    picker.dispose();
  });
});
