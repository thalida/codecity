// createCityScene builds buildings before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { createBuildings } from '@/city/components/buildings';
import { makeCityState, makePickableSceneContext } from '../../../_helpers/cityFixtures';
import { getBuildingMaterial } from '@/city/components/buildings/material';
import buildingFragSrc from '@/city/components/buildings/building.frag.glsl?raw';
import { BUILDINGS } from '@/state/settings/fields/buildings';
import { SCENE } from '@/state/settings/fields/scene';
import { RUINS } from '@/state/settings/fields/ruins';
import { NodeKind } from '@/types';
import type { Building, CityLayout, FileTarget } from '@/types';
import type { Picker } from '@/city/interaction/picker';
import type { SceneContext } from '@/city/types';
import { building } from '../../../_helpers/buildingFixture';
import { makeSession } from '../../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

const _origBuildings = BUILDINGS.value;
const _origScene = SCENE.value;
const _origRuins = RUINS.value;

function resetStores(): void {
  BUILDINGS.value = { ..._origBuildings };
  SCENE.value = { ..._origScene };
  RUINS.value = { ..._origRuins };
}

// A context whose picker exposes drivable selection and hover, and a canvas the
// outline material can measure during arming.

// Pre-picker ctx: picker null (the construction-time window). Used to prove the
// theme effect is safe to run at construction and the overlays do NOT arm.
function makePrePickerCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    canvas: document.createElement('canvas'),
    picker: null as unknown as Picker,
    sceneState: makeCityState(),
  } as unknown as SceneContext;
}

// A throwaway camera for tick() frames where the camera value doesn't matter.
const CAMERA = new THREE.PerspectiveCamera();

// A buildings-only layout. bbox keeps cellSize at the MIN granularity. Two
// buildings at distinct positions so getByPath/tallest are unambiguous.
function buildingLayout(buildings: Building[]): CityLayout {
  return {
    buildings,
    streets: [],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: { minX: -50, minY: -50, maxX: 50, maxY: 50, cx: 0, cy: 0, width: 100, depth: 100 },
  } as unknown as CityLayout;
}

function fileOf(path: string): { name: string; type: NodeKind; path: string; extension: string } {
  return { name: path.split('/').pop()!, type: NodeKind.File, path, extension: '.ts' };
}

// Find the ghost overlay mesh (a Mesh with BoxGeometry) the ghost renderer adds
// to the scene on arming.
function findGhost(scene: THREE.Scene): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (
      !found &&
      (o as THREE.Mesh).isMesh &&
      (o as THREE.Mesh).geometry instanceof THREE.BoxGeometry
    ) {
      found = o as THREE.Mesh;
    }
  });
  return found;
}

describe('createBuildings()', () => {
  let buildings: ReturnType<typeof createBuildings>;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    buildings?.dispose();
    session.timeline.mode.value = false;
  });

  // Construction

  it('constructs with an empty named group (pre-rebuild), no throws', () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    expect(buildings.group).toBeInstanceOf(THREE.Group);
    expect(buildings.group.name).toBe('city-buildings');
    expect(buildings.group.children).toHaveLength(0);
    expect(buildings.getCells().size).toBe(0);
    expect(buildings.getBuildingIndex()).toBeNull();
  });

  it('material theme effect is inert while the picker is still null', () => {
    const ctx = makePrePickerCtx();
    buildings = createBuildings(ctx);
    BUILDINGS.value = { ...BUILDINGS.value };
    expect(buildings.group.children).toHaveLength(0);
  });

  it('rebuild() populates the group, cells, index, and lookups', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);

    const b0 = building({ x: 10, y: 10, h: 4, file: fileOf('src/a.ts') as never });
    const b1 = building({ x: -20, y: -20, h: 9, file: fileOf('src/b.ts') as never });
    await buildings.rebuild(buildingLayout([b0, b1]));

    // Inner cell root is a child of the persistent group.
    expect(buildings.group.children.length).toBe(1);
    expect(buildings.group.children[0].name).toBe('CellRoot');

    // Cells + index populated.
    expect(buildings.getCells().size).toBeGreaterThan(0);
    expect(buildings.getBuildingIndex()).not.toBeNull();

    // Lookups keyed by file path.
    const hit = buildings.getBuildingByPath('src/a.ts');
    expect(hit).not.toBeNull();
    expect(hit!.building).toBe(b0);
    expect(buildings.getBuildingByPath('src/b.ts')!.building).toBe(b1);
    expect(buildings.getBuildingByPath('nope')).toBeNull();

    // getMeshForBuilding resolves through the live cell (cellId/slotId were
    // assigned during rebuild).
    const resolved = buildings.getMeshForBuilding(b0);
    expect(resolved).not.toBeNull();
    expect(resolved!.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(resolved!.slot).toBe(b0.slotId);
  });

  it('rebuild() drops a scrub controller installed for the previous city', async () => {
    // Same hazard the tween queue already guards: the controller holds the old
    // manifest's Buildings, whose cellId/slotId resolve into the NEW cells.
    const { ctx } = makePickableSceneContext(undefined, session.timeline);
    buildings = createBuildings(ctx);
    session.timeline.mode.value = true;

    const oldA = building({ x: 10, y: 10, h: 4, file: fileOf('old/a.ts') as never });
    await buildings.rebuild(buildingLayout([oldA]));

    const controller = { update: vi.fn() };
    buildings.setScrubController(controller);
    buildings.tick(0, { camera: CAMERA } as never);
    expect(controller.update, 'sanity: driven while its city is live').toHaveBeenCalled();
    controller.update.mockClear();

    // A different repo lands while Timeline is still flagged on.
    const newA = building({ x: 10, y: 10, h: 4, file: fileOf('new/a.ts') as never });
    await buildings.rebuild(buildingLayout([newA]));
    buildings.tick(0, { camera: CAMERA } as never);

    expect(
      controller.update,
      'a controller from the previous city must not keep writing into this one'
    ).not.toHaveBeenCalled();
  });

  it('rebuild() colors the buildings (writes b.color from the date ranges)', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    const b0 = building({ x: 1, y: 1, color: '__unset__', file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]));
    // The color loop overwrote the placeholder with a real CSS color from
    // getBuildingColor (hsl(...) form).
    expect(b0.color).not.toBe('__unset__');
    expect(b0.color).toMatch(/^hsl\(/);
  });

  it('rebuild() disposes the prior cell root WITHOUT freeing the shared material', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);

    await buildings.rebuild(
      buildingLayout([building({ x: 5, y: 5, file: fileOf('src/a.ts') as never })])
    );
    const firstCellRoot = buildings.group.children[0];
    const firstMesh = [...buildings.getCells().values()][0].detailMesh;
    const sharedMat = firstMesh.material as THREE.Material;
    // The cell detail mesh shares the module material (guarded by userData).
    expect(firstMesh.userData.sharedMaterial).toBe(true);

    await buildings.rebuild(
      buildingLayout([building({ x: 5, y: 5, file: fileOf('src/a.ts') as never })])
    );

    // Old cell root detached; new one swapped in (no accumulation).
    expect(firstCellRoot.parent).toBeNull();
    expect(buildings.group.children.length).toBe(1);
    expect(buildings.group.children[0]).not.toBe(firstCellRoot);

    // The SHARED material survived the prior cell-root disposal — the new
    // cell's detail mesh still references a usable (non-disposed) material.
    const secondMesh = [...buildings.getCells().values()][0].detailMesh;
    expect(secondMesh.material).toBe(sharedMat);
    // A disposed three.js material has no program; a live one still renders.
    // The shared material's uniforms object is intact (not nulled by dispose).
    expect((secondMesh.material as THREE.ShaderMaterial).uniforms).toBeDefined();
  });

  // Shared-material theme effect

  it('material effect re-applies uOutlineWidth on BUILDINGS Save', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    // Force the shared material to exist (created lazily during rebuild).
    await buildings.rebuild(
      buildingLayout([building({ x: 1, y: 1, file: fileOf('src/a.ts') as never })])
    );
    const uniforms = getBuildingMaterial().uniforms;

    BUILDINGS.value = { ...BUILDINGS.value, OUTLINE_WIDTH: 7.5 };
    expect(uniforms.uOutlineWidth.value).toBe(7.5);

    BUILDINGS.value = { ...BUILDINGS.value, OUTLINE_WIDTH: 2.25 };
    expect(uniforms.uOutlineWidth.value).toBe(2.25);
  });

  it('fog falloff reaches the shader as the raw fraction, unscaled by any city height', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    await buildings.rebuild(
      buildingLayout([building({ x: 1, y: 1, file: fileOf('src/a.ts') as never })])
    );
    const uniforms = getBuildingMaterial().uniforms;

    SCENE.value = { ...SCENE.value, FOG_HEIGHT_FRAC: 0.4 };
    expect(uniforms.uFogHeightFrac.value).toBe(0.4);

    SCENE.value = { ...SCENE.value, FOG_HEIGHT_FRAC: 0.1 };
    expect(uniforms.uFogHeightFrac.value).toBe(0.1);
  });

  it('ruin cross uniforms track the RUINS store', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    await buildings.rebuild(
      buildingLayout([building({ x: 1, y: 1, file: fileOf('src/a.ts') as never })])
    );
    const uniforms = getBuildingMaterial().uniforms;

    RUINS.value = { ...RUINS.value, X_ENABLED: true, X_COLOR: '#ff0000', X_WIDTH: 0.3 };
    expect(uniforms.uRuinXEnabled.value).toBe(true);
    expect((uniforms.uRuinXColor.value as THREE.Color).getHexString()).toBe('ff0000');
    expect(uniforms.uRuinXWidth.value).toBe(0.3);

    RUINS.value = { ...RUINS.value, X_ENABLED: false };
    expect(uniforms.uRuinXEnabled.value).toBe(false);
  });

  it('building shader scales the haze by each instance own height', () => {
    // vScale.y is the per-instance height recovered from the instance matrix;
    // GLSL can't be compile-tested here, so guard the call site.
    expect(buildingFragSrc).toMatch(/applyFog\(outColor\.rgb, vWorldPos, vScale\.y\)/);
  });

  // Picker overlays — ARMED on the first tick (the arming-bug guard)

  it('does NOT arm the overlays before the first tick (no ghost mesh in scene)', async () => {
    const { ctx, hover } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    const b0 = building({ x: 5, y: 5, file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]));

    // No tick yet → overlays not constructed → no ghost mesh exists.
    expect(findGhost(ctx.scene)).toBeNull();

    // Hovering before arming does nothing (no overlay to drive).
    hover.value = {
      kind: NodeKind.File,
      file: fileOf('src/a.ts'),
      data: b0,
    } as unknown as FileTarget;
    expect(findGhost(ctx.scene)).toBeNull();
  });

  it('arms overlays on first tick; a later hover drives the ghost overlay', async () => {
    const { ctx, hover } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    const b0 = building({ x: 5, y: 5, file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]));

    // First tick arms the overlays — the ghost mesh now exists (hidden).
    buildings.tick(0.016, { dt: 0.016, time: 0, camera: CAMERA });
    const ghost = findGhost(ctx.scene);
    expect(ghost).not.toBeNull();
    expect(ghost!.visible).toBe(false);

    // Hovering a File building drives the armed ghost effect synchronously.
    hover.value = {
      kind: NodeKind.File,
      file: fileOf('src/a.ts'),
      data: b0,
    } as unknown as FileTarget;
    expect(ghost!.visible).toBe(true);

    // Clearing the hover hides it again.
    hover.value = null;
    expect(ghost!.visible).toBe(false);
  });

  // Self-tween — rebuild() computes its own enter/stay diff and drives the
  // tweens through tick(). The boot rebuild does NOT animate; the 2nd+ do.

  it('the FIRST rebuild (boot) does NOT fire enter tweens — the city snaps in', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);

    const b0 = building({ x: 10, y: 10, h: 8, file: fileOf('src/a.ts') as never });

    const now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      await buildings.rebuild(buildingLayout([b0]));

      // The boot rebuild lands the building at its final transform, so a tick
      // where an entering tween would write scaleY≈0 leaves it full height.
      const resolved = buildings.getMeshForBuilding(b0)!;
      const mesh = resolved.mesh;
      const m = new THREE.Matrix4();

      buildings.tick(0, { dt: 0, time: 0, camera: CAMERA });
      mesh.getMatrixAt(resolved.slot, m);
      // scaleY is the full height (no grow-in tween was started).
      expect(m.elements[5]).toBeCloseTo(b0.h, 6);
      expect(m.elements[13]).toBeCloseTo(b0.h / 2, 6);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a SECOND rebuild introducing a new building fires its enter tween through tick() and lands the final transform', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    // Boot rebuild (no animation) with one building.
    const b0 = building({ x: 10, y: 10, h: 8, file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]));

    const transitionMs = BUILDINGS.value.BUILDING_TRANSITION_MS;
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      // Second rebuild adds a NEW building path → it enters (grows in).
      const b1 = building({ x: -20, y: -20, h: 12, file: fileOf('src/b.ts') as never });
      const a = building({ x: 10, y: 10, h: 8, file: fileOf('src/a.ts') as never });
      await buildings.rebuild(buildingLayout([a, b1]));

      const resolved = buildings.getMeshForBuilding(b1)!;
      const mesh = resolved.mesh;
      const m = new THREE.Matrix4();

      // Mid-tween tick: interpolated scaleY strictly between ~0 and the
      // final height (elements[5] is the Y scale of a makeScale matrix).
      now = transitionMs / 2;
      buildings.tick(0, { dt: 0, time: 0, camera: CAMERA });
      mesh.getMatrixAt(resolved.slot, m);
      expect(m.elements[5]).toBeGreaterThan(0.0001);
      expect(m.elements[5]).toBeLessThan(b1.h);

      // Past the duration: the final scale + position land exactly.
      now = transitionMs + 1;
      buildings.tick(0, { dt: 0, time: 0, camera: CAMERA });
      mesh.getMatrixAt(resolved.slot, m);
      expect(m.elements[5]).toBeCloseTo(b1.h, 6);
      expect(m.elements[13]).toBeCloseTo(b1.h / 2, 6);
      expect(m.elements[12]).toBeCloseTo(b1.x, 6);
      expect(m.elements[14]).toBeCloseTo(b1.y, 6);
    } finally {
      vi.restoreAllMocks();
    }
  });

  // dispose()

  it('dispose() empties the group, removes overlays, and stops the material effect', async () => {
    const { ctx } = makePickableSceneContext();
    buildings = createBuildings(ctx);
    await buildings.rebuild(
      buildingLayout([building({ x: 1, y: 1, file: fileOf('src/a.ts') as never })])
    );
    buildings.tick(0, { dt: 0, time: 0, camera: CAMERA });
    expect(findGhost(ctx.scene)).not.toBeNull();

    buildings.dispose();
    // Inner cell root removed; lookups cleared.
    expect(buildings.group.children).toHaveLength(0);
    expect(buildings.getCells().size).toBe(0);
    expect(buildings.getBuildingIndex()).toBeNull();
    // Ghost overlay removed from the scene.
    expect(findGhost(ctx.scene)).toBeNull();

    // The material effect is stopped — a later BUILDINGS mutation no-ops
    // (no throw; nothing left to update).
    expect(() => {
      BUILDINGS.value = { ...BUILDINGS.value, OUTLINE_WIDTH: 99 };
    }).not.toThrow();

    buildings = undefined as unknown as ReturnType<typeof createBuildings>;
  });
});
