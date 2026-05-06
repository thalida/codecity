// picker-instanced.test.ts — exercises interpretHit for InstancedMesh hits
// introduced in Task 8/10. The picker now returns per-block instanceId +
// SceneBlock alongside the existing Building/File data.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/scene/picker.js';
import { NodeKind } from '@/types';
import type {
  Building,
  FileNode,
  PickerCityScene,
  Street,
} from '@/types';
import type { SceneBlock } from '@/scene/blocks.js';

// Stub camera — only used by raycaster.setFromCamera, not exercised here.
const FAKE_CAMERA = {} as unknown as THREE.Camera;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a minimal Building fixture with a real FileNode so
 * `building.file.path` works.
 */
function makeBuilding(path: string): Building {
  return {
    file: { path, type: NodeKind.File } as unknown as FileNode,
    x: 0,
    y: 0,
    w: 10,
    h: 15,
    d: 8,
    color: '#ff0000',
  } as unknown as Building;
}

/**
 * Build a minimal SceneBlock whose `detailMesh` is a real THREE.InstancedMesh
 * with the userData stamps that createBuildingsInstancedMesh sets
 * (userData.kind = 'buildings', userData.block = block).
 *
 * `buildings` ordering matches block.buildings ordering so
 * instanceId === array index — same contract as the real builder.
 */
function makeBlock(buildings: Building[]): { block: SceneBlock; mesh: THREE.InstancedMesh } {
  const dir = { path: 'src', type: NodeKind.Directory } as unknown as import('@/types').DirNode;
  const street = { dir, length: 100, width: 10, x: 0, y: 0 } as unknown as Street;

  const block: SceneBlock = {
    dir,
    bbox: new THREE.Box3(),
    meanColor: new THREE.Color(0xffffff),
    primaryStreet: street,
    buildings,
    lodCurrent: 'detail',
  };

  // Real InstancedMesh — uses unit box geometry; we don't need the shader
  // material for picker tests (interpretHit never renders).
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, buildings.length);
  mesh.userData.kind = 'buildings';
  mesh.userData.block = block;
  block.detailMesh = mesh;

  return { block, mesh };
}

/**
 * Extend makeBlock with a placeholder mesh mirroring what
 * createPlaceholderMesh produces: a plain Mesh with
 * userData.kind = 'placeholder' and userData.block = block.
 */
function makeBlockWithPlaceholder(buildings: Building[]): {
  block: SceneBlock;
  mesh: THREE.InstancedMesh;
  placeholder: THREE.Mesh;
} {
  const { block, mesh } = makeBlock(buildings);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: block.meanColor });
  const placeholder = new THREE.Mesh(geo, mat);
  placeholder.userData.kind = 'placeholder';
  placeholder.userData.block = block;
  placeholder.visible = false;
  block.placeholderMesh = placeholder;
  return { block, mesh, placeholder };
}

/**
 * Build a fake THREE.Intersection that looks like an InstancedMesh hit.
 * The real Three.js raycaster populates `.instanceId` on the intersection
 * object, not on the mesh — we mirror that here.
 */
function fakeInstancedHit(
  mesh: THREE.InstancedMesh,
  instanceId: number,
): THREE.Intersection<THREE.Object3D> {
  return {
    object: mesh,
    instanceId,
    distance: 10,
    point: new THREE.Vector3(),
  } as unknown as THREE.Intersection<THREE.Object3D>;
}

/**
 * Minimal PickerCityScene stub — the InstancedMesh tests only need
 * interpretHit; the scene stub is needed to construct the picker but
 * the full scene API is not exercised by these tests.
 */
function makeFakeCityScene(blocks: SceneBlock[] = []): PickerCityScene {
  const listeners: Array<() => void> = [];
  return {
    getBuildings: () => [],
    getBlocks: () => blocks,
    getStreetPickables: () => [],
    getRootGem: () => null,
    getBuildingByPath: (_p: string) => null,
    getSidewalkByDir: (_p: string) => null,
    getStreetByDir: (_p: string) => null,
    onChange(cb: () => void) {
      listeners.push(cb);
      return () => {};
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  PICKER_SELECTION_KEY.set(null);
});

describe('picker with InstancedMesh', () => {
  it('returns kind=File with a non-null instanceId when hitting a buildings InstancedMesh', () => {
    const bA = makeBuilding('src/a.ts');
    const bB = makeBuilding('src/b.ts');
    const { mesh } = makeBlock([bA, bB]);

    const fakeScene = makeFakeCityScene();
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    // Hit instance 1 (bB).
    const hit = fakeInstancedHit(mesh, 1);
    const target = p.interpretHit(hit);

    expect(target).not.toBeNull();
    expect(target?.kind).toBe(NodeKind.File);
    if (target?.kind === NodeKind.File) {
      expect(target.instanceId).toBe(1);
    }

    p.dispose();
  });

  it('returns the file whose path matches block.buildings[instanceId]', () => {
    const bA = makeBuilding('src/alpha.ts');
    const bB = makeBuilding('src/beta.ts');
    const bC = makeBuilding('src/gamma.ts');
    const { block, mesh } = makeBlock([bA, bB, bC]);

    const fakeScene = makeFakeCityScene();
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    // Hit each instance and confirm the path matches the array index.
    for (let i = 0; i < block.buildings.length; i++) {
      const hit = fakeInstancedHit(mesh, i);
      const target = p.interpretHit(hit);

      expect(target?.kind).toBe(NodeKind.File);
      if (target?.kind === NodeKind.File) {
        expect(target.file.path).toBe(block.buildings[i].file!.path);
        expect(target.instanceId).toBe(i);
        expect(target.block).toBe(block);
        // Confirm the returned data IS the building at that index.
        expect(target.data).toBe(block.buildings[i]);
      }
    }

    p.dispose();
  });

  it('returns null when instanceId is out of range (beyond buildings array length)', () => {
    const bA = makeBuilding('src/a.ts');
    const { mesh } = makeBlock([bA]);

    const fakeScene = makeFakeCityScene();
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    // Instance 5 does not exist in a 1-building block.
    const hit = fakeInstancedHit(mesh, 5);
    const target = p.interpretHit(hit);

    expect(target).toBeNull();

    p.dispose();
  });

  it('returns null when the hit object is an InstancedMesh without userData.kind=buildings', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, 2);
    // No userData.kind or userData.block set — should not be treated as buildings.

    const fakeScene = makeFakeCityScene();
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    const hit = fakeInstancedHit(mesh, 0);
    const target = p.interpretHit(hit);

    expect(target).toBeNull();

    p.dispose();
  });

  it('returns null when instanceId is null (Three.js degenerate hit)', () => {
    const bA = makeBuilding('src/a.ts');
    const { mesh } = makeBlock([bA]);

    const fakeScene = makeFakeCityScene();
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    // Simulate Three.js returning a hit with no instanceId.
    const hit = {
      object: mesh,
      instanceId: undefined,
      distance: 10,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    const target = p.interpretHit(hit);
    expect(target).toBeNull();

    p.dispose();
  });

  it('returns null for hits outside an InstancedMesh (plain Mesh, no userData)', () => {
    const fakeScene = makeFakeCityScene();
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const plainMesh = new THREE.Mesh(geo, mat);
    // No userData set — not pickable.

    const hit = {
      object: plainMesh,
      distance: 5,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    expect(p.interpretHit(hit)).toBeNull();

    p.dispose();
  });

  it('placeholder hit returns kind=Directory using the block primaryStreet and dir', () => {
    const bA = makeBuilding('src/a.ts');
    const { block, placeholder } = makeBlockWithPlaceholder([bA]);

    const fakeScene = makeFakeCityScene([block]);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    const hit = {
      object: placeholder,
      distance: 50,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    const target = p.interpretHit(hit);

    expect(target).not.toBeNull();
    expect(target?.kind).toBe(NodeKind.Directory);
    if (target?.kind === NodeKind.Directory) {
      expect(target.street).toBe(block.primaryStreet);
      expect(target.dir).toBe(block.dir);
      expect(target.sidewalk).toBe(placeholder);
    }

    p.dispose();
  });

  it('placeholder hit uses the block from userData, not a separate lookup', () => {
    // Two blocks with different dirs; ensure the right block's dir is returned.
    const bA = makeBuilding('src/a.ts');
    const bB = makeBuilding('lib/b.ts');
    const { block: blockA, placeholder: phA } = makeBlockWithPlaceholder([bA]);
    const { block: blockB, placeholder: phB } = makeBlockWithPlaceholder([bB]);
    // Give blockB a distinguishable dir path.
    (blockB.dir as unknown as { path: string }).path = 'lib';

    const fakeScene = makeFakeCityScene([blockA, blockB]);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, cityScene: fakeScene });

    const hitB = {
      object: phB,
      distance: 30,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    const target = p.interpretHit(hitB);
    expect(target?.kind).toBe(NodeKind.Directory);
    if (target?.kind === NodeKind.Directory) {
      expect(target.dir).toBe(blockB.dir);
      expect(target.street).toBe(blockB.primaryStreet);
    }

    // Also confirm phA still resolves to blockA.
    const hitA = {
      object: phA,
      distance: 30,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    const targetA = p.interpretHit(hitA);
    expect(targetA?.kind).toBe(NodeKind.Directory);
    if (targetA?.kind === NodeKind.Directory) {
      expect(targetA.dir).toBe(blockA.dir);
    }

    p.dispose();
  });
});
