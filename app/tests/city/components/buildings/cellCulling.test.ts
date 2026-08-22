// A cell mesh is frustum-culled, and three.js will happily compute its cull
// sphere from whatever the instance matrices held at the first frustum test and
// cache that forever. The tween and the timeline scrub both rewrite those
// matrices after, so the cell has to own the sphere itself.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SpatialGrid } from '@/city/components/buildings/spatialGrid';
import { createEmptyCellTile } from '@/city/components/buildings/cellTile';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { createBuildingTweens } from '@/city/components/buildings/tween';
import { building } from '../../../_helpers/buildingFixture';
import type { Building } from '@/types';
import { TEST_SOURCE } from '../../../_helpers/manifestFixtures';
import { makeSession } from '../../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

const BOUNDS = { minX: 0, maxX: 96, minZ: 0, maxZ: 96 };

const fileAt = (path: string) => ({ path, name: path, extension: '.ts' });

function layout(): Building[] {
  return [
    building({ x: 4, y: 4, w: 3, d: 3, h: 40, file: fileAt('a.ts') as never }),
    building({ x: 9, y: 5, w: 3, d: 3, h: 8, file: fileAt('b.ts') as never }),
    building({ x: 70, y: 70, w: 3, d: 3, h: 12, file: fileAt('c.ts') as never }),
  ];
}

/** Where a cell's tallest building reaches, as three.js would test it. */
const topOf = (b: Building) => new THREE.Vector3(b.x, b.h, b.y);

describe('cell cull sphere', () => {
  it('is the cell’s own, not one three.js derived from a single frame', () => {
    const out = buildCellsFromLayout(BOUNDS, layout(), TEST_SOURCE, session.timeline);

    for (const cell of out.cells.values()) {
      expect(cell.detailMesh.boundingSphere).toBe(cell.boundsSphere);
    }
  });

  it('covers the tallest building it holds, not the 20-unit default', () => {
    const buildings = layout();
    const out = buildCellsFromLayout(BOUNDS, buildings, TEST_SOURCE, session.timeline);

    const tall = buildings[0];
    const cell = out.cells.get(out.grid.worldToCell(tall.x, tall.y).cellId)!;

    expect(cell.detailMesh.boundingSphere!.containsPoint(topOf(tall))).toBe(true);
  });

  // A slab is placed by its centre, so half of it hangs over the cell edge the
  // centre sits against.
  it('covers a building whose slab overhangs the cell edge', () => {
    const grid = new SpatialGrid(BOUNDS);
    const edge = grid.cellSize - 0.1; // centre hard against the boundary
    const wide = building({ x: edge, y: edge, w: 6, d: 6, h: 10, file: fileAt('w.ts') as never });
    const out = buildCellsFromLayout(BOUNDS, [wide], TEST_SOURCE, session.timeline);
    const cell = out.cells.get(out.grid.worldToCell(wide.x, wide.y).cellId)!;

    const corner = new THREE.Vector3(wide.x + wide.w / 2, wide.h, wide.y + wide.d / 2);
    expect(cell.detailMesh.boundingSphere!.containsPoint(corner)).toBe(true);
  });

  // The bug: three.js caches its own sphere on the first frustum test, so every
  // later write culls against where the buildings used to be.
  it('survives a frustum test, so a later matrix write is not culled against a stale sphere', () => {
    const buildings = layout();
    const out = buildCellsFromLayout(BOUNDS, buildings, TEST_SOURCE, session.timeline);
    const tall = buildings[0];
    const cell = out.cells.get(out.grid.worldToCell(tall.x, tall.y).cellId)!;
    const mesh = cell.detailMesh;
    mesh.updateMatrixWorld(true);

    new THREE.Frustum().intersectsObject(mesh);

    expect(mesh.boundingSphere).toBe(cell.boundsSphere);

    // What the scrub does at a commit where the file was shorter: same footprint,
    // less height. It has to stay inside the sphere sized for its full height.
    const shorter = new THREE.Matrix4().compose(
      new THREE.Vector3(tall.x, 2, tall.y),
      new THREE.Quaternion(),
      new THREE.Vector3(tall.w, 4, tall.d)
    );
    mesh.setMatrixAt(0, shorter);

    expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(tall.x, 4, tall.y))).toBe(true);
  });
});

describe('cull opt-out while a building is moving', () => {
  it('stops culling a mesh mid-tween and resumes once it lands', () => {
    const grid = new SpatialGrid(BOUNDS);
    const cell = createEmptyCellTile(grid, 0, 8, { maxHeight: 10, overhang: 1 });
    const moved = building({ x: 2, y: 2, h: 10, file: fileAt('m.ts') as never });
    const tweens = createBuildingTweens({
      getMeshForBuilding: () => ({ mesh: cell.detailMesh, slot: 0 }),
    });

    // A building that moved: it travels between two cells and is inside neither
    // for the length of the trip.
    tweens.onDiff({
      entering: { buildings: [] },
      staying: {
        buildings: [
          {
            building: moved,
            instanceId: 0,
            newScaleX: 2,
            newScaleY: 10,
            newScaleZ: 2,
            newPosX: 2,
            newPosY: 5,
            newPosZ: 2,
            oldScaleX: 2,
            oldScaleY: 10,
            oldScaleZ: 2,
            oldPosX: 80,
            oldPosY: 5,
            oldPosZ: 80,
          },
        ],
      },
    });

    tweens.update(16);
    expect(cell.detailMesh.frustumCulled, 'in flight').toBe(false);

    // Past the transition's end, so the next update lands it and drops the tween.
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 60_000);
    tweens.update(16);
    tweens.update(16);
    vi.mocked(performance.now).mockRestore();

    expect(cell.detailMesh.frustumCulled, 'landed').toBe(true);
  });

  it('restores culling when the queue is cleared out from under it', () => {
    const grid = new SpatialGrid(BOUNDS);
    const cell = createEmptyCellTile(grid, 0, 8, { maxHeight: 10, overhang: 1 });
    const tweens = createBuildingTweens({
      getMeshForBuilding: () => ({ mesh: cell.detailMesh, slot: 0 }),
    });

    tweens.onDiff({
      entering: {
        buildings: [
          {
            building: building({ file: fileAt('e.ts') as never }),
            instanceId: 0,
            newScaleX: 2,
            newScaleY: 4,
            newScaleZ: 2,
            newPosX: 2,
            newPosY: 2,
            newPosZ: 2,
          },
        ],
      },
      staying: { buildings: [] },
    });
    tweens.update(16);
    expect(cell.detailMesh.frustumCulled).toBe(false);

    tweens.clear();

    expect(cell.detailMesh.frustumCulled).toBe(true);
  });
});
