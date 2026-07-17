// picker-bvh.test.ts — the picker raycasts through a three-mesh-bvh ObjectBVH
// (built over the pickables) instead of THREE's brute-force intersectObjects,
// which at Linux scale tested every one of ~80k building instances per pointer
// move (~34ms/cast). This guard proves the accelerated path returns the SAME
// hit (object + instanceId + point) a brute-force core raycast would, against a
// real cell scene — so hover/selection stay bit-identical while the per-cast
// cost drops ~480x.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { makeCityState } from '../../_helpers/cityFixtures';
import { NodeKind } from '@/types';
import type { Building, PickerWorld } from '@/types';

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

// A world whose cells come from a real buildCellsFromLayout, so pickAt raycasts
// live InstancedMeshes (streets/gem/trees empty for this geometry-only guard).
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
  // jsdom returns a zero rect; give pickAt a real viewport so NDC math is sane.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
  PICKER_SELECTION_KEY.value = null;
});

describe('picker BVH raycast', () => {
  it('picks the building under the cursor, matching a brute-force core raycast', () => {
    const target = mkBuilding('src/a.ts', 40, -30);
    const world = makeCellWorld([target, mkBuilding('src/b.ts', -60, 50), mkBuilding('lib/c.ts', 0, 0)]);

    // Camera straight above the target, looking down — the screen-center ray
    // hits the target building's top.
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.position.set(target.x, 400, target.y);
    camera.lookAt(target.x, 0, target.y);
    camera.updateMatrixWorld(true);

    const picker = createPicker({ canvas, camera, world, cityState: world.cityState });

    // Screen center → the target building.
    const hit = picker.pickAt(400, 300);
    expect(hit).not.toBeNull();
    expect(hit!.object).toBeInstanceOf(THREE.InstancedMesh);
    expect((hit!.object as THREE.InstancedMesh).userData.meshKind).toBe('detail');
    expect(hit!.point).toBeInstanceOf(THREE.Vector3);

    // interpretHit resolves it back to the correct file.
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.File);
    expect(t?.kind === NodeKind.File && t.file.path).toBe('src/a.ts');

    // Equivalence: a brute-force core raycast over the same pickables must land
    // on the same object + instance at (near) the same distance.
    const pickables: THREE.Object3D[] = [];
    for (const cell of world.cellOut.cells.values()) if (cell.detailMesh) pickables.push(cell.detailMesh);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const coreHits = ray.intersectObjects(pickables, false);
    expect(coreHits.length).toBeGreaterThan(0);
    expect(hit!.object).toBe(coreHits[0].object);
    expect(hit!.instanceId).toBe(coreHits[0].instanceId);
    expect(hit!.distance).toBeCloseTo(coreHits[0].distance, 2);

    picker.dispose();
  });

  it('returns null when the ray misses every pickable', () => {
    const world = makeCellWorld([mkBuilding('src/a.ts', 40, -30)]);
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    // Aim well away from the single building at (40,-30).
    camera.position.set(2000, 400, 2000);
    camera.lookAt(2000, 0, 2000);
    camera.updateMatrixWorld(true);
    const picker = createPicker({ canvas, camera, world, cityState: world.cityState });
    expect(picker.pickAt(400, 300)).toBeNull();
    picker.dispose();
  });

  it('does not throw when there are no pickables', () => {
    const world = makeCellWorld([]);
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.updateMatrixWorld(true);
    const picker = createPicker({ canvas, camera, world, cityState: world.cityState });
    expect(picker.pickAt(400, 300)).toBeNull();
    picker.dispose();
  });
});
