// picker-bvh.test.ts — the picker raycasts through a three-mesh-bvh ObjectBVH
// rather than THREE's brute force, which tested ~80k instances per pointer move
// at Linux scale. This proves the accelerated path returns the SAME hit (object
// + instanceId + point) against a real cell scene, so selection can't drift.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker } from '@/city/interaction/picker';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { createMergedSidewalkMesh } from '@/city/components/streets/streets';
import { makeCityState } from '../../_helpers/cityFixtures';
import { NodeKind, StreetAxis } from '@/types';
import type { Building, PickerWorld, Street } from '@/types';
import { TEST_SOURCE } from '../../_helpers/manifestFixtures';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

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
  const cellOut = buildCellsFromLayout(bounds, buildings, TEST_SOURCE, session.timeline);
  cellOut.sceneRoot.updateMatrixWorld(true);
  const sceneState = makeCityState();
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
  return Object.assign(api, { sceneState, cellOut });
}

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  // jsdom returns a zero rect; give pickAt a real viewport so NDC math is sane.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
});

describe('picker BVH raycast', () => {
  it('picks the building under the cursor, matching a brute-force core raycast', () => {
    const target = mkBuilding('src/a.ts', 40, -30);
    const world = makeCellWorld([
      target,
      mkBuilding('src/b.ts', -60, 50),
      mkBuilding('lib/c.ts', 0, 0),
    ]);

    // Camera straight above the target, looking down — the screen-center ray
    // hits the target building's top.
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.position.set(target.x, 400, target.y);
    camera.lookAt(target.x, 0, target.y);
    camera.updateMatrixWorld(true);

    const picker = createPicker({
      canvas,
      camera,
      world,
      sceneState: world.sceneState,
      timeline: session.timeline,
    });

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
    for (const cell of world.cellOut.cells.values())
      if (cell.detailMesh) pickables.push(cell.detailMesh);
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
    const picker = createPicker({
      canvas,
      camera,
      world,
      sceneState: world.sceneState,
      timeline: session.timeline,
    });
    expect(picker.pickAt(400, 300)).toBeNull();
    picker.dispose();
  });

  it('resolves a directory hit on the merged sidewalk to the right street', () => {
    // Two X-oriented streets on the ground at different Z; picking over one must
    // resolve (via ObjectBVH faceIndex → sidewalkStreetForFace) to ITS dir.
    const mk = (path: string, z: number): Street =>
      ({
        x: 0,
        y: z,
        width: 24,
        length: 400,
        label: path,
        orientation: StreetAxis.X,
        isRoot: false,
        dir: { name: path, path, type: NodeKind.Directory },
      }) as unknown as Street;
    const streetA = mk('src', 0);
    const streetB = mk('lib', 200);
    const built = createMergedSidewalkMesh([streetA, streetB] as never, 0)!;
    built.mesh.updateMatrixWorld(true);

    const sceneState = makeCityState();
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
      { sceneState }
    );

    // Camera straight above street B (z=200) looking down.
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.position.set(0, 300, 200);
    camera.lookAt(0, 0, 200);
    camera.updateMatrixWorld(true);

    const picker = createPicker({ canvas, camera, world, sceneState, timeline: session.timeline });
    const hit = picker.pickAt(400, 300);
    expect(hit).not.toBeNull();
    const t = picker.interpretHit(hit);
    expect(t?.kind).toBe(NodeKind.Directory);
    expect(t?.kind === NodeKind.Directory && t.dir.path).toBe('lib');
    picker.dispose();
  });

  it('does not throw when there are no pickables', () => {
    const world = makeCellWorld([]);
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1, 100000);
    camera.updateMatrixWorld(true);
    const picker = createPicker({
      canvas,
      camera,
      world,
      sceneState: world.sceneState,
      timeline: session.timeline,
    });
    expect(picker.pickAt(400, 300)).toBeNull();
    picker.dispose();
  });
});
