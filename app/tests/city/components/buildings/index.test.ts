// app/tests/city/components/buildings/index.test.ts
//
// Tests for the persistent createBuildings(ctx, deps) component (Task 12).
// API: createBuildings(ctx, deps) → { group, rebuild(layout, dateRanges),
//      setAtlas, disposeAdPanels, tick(dt, frame), onResize(), dispose(),
//      getByPath, getBuildingsByPath, pickables, tallest, maxHeight, getCells,
//      getBuildingIndex, getMeshForBuilding, getAdPanels }.
//
// The shared-material theme effect reacts to BUILDINGS/FACADE/SCENE/BLOOM at
// construction (safe — no picker). The fader/outline/ghost overlays are
// picker-driven and ARMED on the first tick() (NOT at construction — ctx.picker
// is null there, so a construction-time subscriber would track no signal and
// never re-fire). The arming test below directly guards that: a hover set
// AFTER the first tick must drive the ghost overlay; before any tick, no
// overlay exists at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';

import { createBuildings } from '@/city/components/buildings';
import { createCityState } from '@/city/state';
import { getSharedBuildingUniforms } from '@/city/components/buildings/material';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { NodeKind } from '@/types';
import type { Building, CityLayout, DateRanges, FileTarget, PickTarget } from '@/types';
import type { Picker } from '@/city/render/picker';
import type { SceneContext } from '@/city/types';
import { building } from '../../../_helpers/buildingFixture';

const _origBuildings = BUILDINGS.value;

function resetBuildings(): void {
  BUILDINGS.value = { ..._origBuildings };
}

// A SceneContext whose picker exposes controllable selection + hover signals,
// and a real (fake) renderer.domElement canvas so the outline LineMaterial can
// read clientWidth/Height during arming.
function makeCtx(): {
  ctx: SceneContext;
  selection: ReturnType<typeof signal<PickTarget | null>>;
  hover: ReturnType<typeof signal<PickTarget | null>>;
} {
  const selection = signal<PickTarget | null>(null);
  const hover = signal<PickTarget | null>(null);
  const canvas = document.createElement('canvas');
  const ctx = {
    scene: new THREE.Scene(),
    picker: { selection, hover } as unknown as Picker,
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
    cityState: createCityState(),
  } as SceneContext;
  return { ctx, selection, hover };
}

// Pre-picker ctx: picker/renderer null (the construction-time window). Used to
// prove the theme effect is safe to run at construction and the overlays do
// NOT arm.
function makePrePickerCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    picker: null as unknown as Picker,
    camera: null as unknown as THREE.PerspectiveCamera,
    renderer: null as unknown as THREE.WebGLRenderer,
    cityState: createCityState(),
  } as unknown as SceneContext;
}

const NOOP_DEPS = {
  getStreetByDir: () => null,
};

const EMPTY_DATE_RANGES = {
  createdMin: null,
  createdMax: null,
  modifiedMin: null,
  modifiedMax: null,
} as unknown as DateRanges;

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
    resetBuildings();
  });

  afterEach(() => {
    buildings?.dispose();
  });

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('constructs with an empty named group (pre-rebuild), no throws', () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);
    expect(buildings.group).toBeInstanceOf(THREE.Group);
    expect(buildings.group.name).toBe('city-buildings');
    expect(buildings.group.children).toHaveLength(0);
    expect(buildings.pickables()).toHaveLength(0);
    expect(buildings.getCells().size).toBe(0);
    expect(buildings.getBuildingIndex()).toBeNull();
  });

  it('material theme effect runs at construction with a null picker without throwing', () => {
    const ctx = makePrePickerCtx();
    expect(() => {
      buildings = createBuildings(ctx, NOOP_DEPS);
      BUILDINGS.value = { ...BUILDINGS.value };
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // rebuild() — populates group + cells + lookups
  // ---------------------------------------------------------------------------

  it('rebuild() populates the group, cells, index, and lookups', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);

    const b0 = building({ x: 10, y: 10, h: 4, file: fileOf('src/a.ts') as never });
    const b1 = building({ x: -20, y: -20, h: 9, file: fileOf('src/b.ts') as never });
    await buildings.rebuild(buildingLayout([b0, b1]), EMPTY_DATE_RANGES);

    // Inner cell root is a child of the persistent group.
    expect(buildings.group.children.length).toBe(1);
    expect(buildings.group.children[0].name).toBe('CellRoot');

    // Cells + index populated.
    expect(buildings.getCells().size).toBeGreaterThan(0);
    expect(buildings.getBuildingIndex()).not.toBeNull();
    expect(buildings.pickables().length).toBe(buildings.getCells().size);

    // Lookups keyed by file path.
    const hit = buildings.getByPath('src/a.ts');
    expect(hit).not.toBeNull();
    expect(hit!.building).toBe(b0);
    expect(buildings.getBuildingsByPath()['src/b.ts'].building).toBe(b1);
    expect(buildings.getByPath('nope')).toBeNull();

    // tallest / maxHeight reflect b1 (h=9).
    expect(buildings.maxHeight()).toBe(9);
    expect(buildings.tallest()).toEqual({ x: -20, y: -20, w: b1.w, d: b1.d, h: 9 });

    // getMeshForBuilding resolves through the live cell (cellId/slotId were
    // assigned during rebuild).
    const resolved = buildings.getMeshForBuilding(b0);
    expect(resolved).not.toBeNull();
    expect(resolved!.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(resolved!.slot).toBe(b0.slotId);
  });

  it('rebuild() colors the buildings (writes b.color from the date ranges)', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);
    const b0 = building({ x: 1, y: 1, color: '__unset__', file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]), EMPTY_DATE_RANGES);
    // The color loop overwrote the placeholder with a real CSS color from
    // getBuildingColor (hsl(...) form).
    expect(b0.color).not.toBe('__unset__');
    expect(b0.color).toMatch(/^hsl\(/);
  });

  it('rebuild() disposes the prior cell root WITHOUT freeing the shared material', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);

    await buildings.rebuild(
      buildingLayout([building({ x: 5, y: 5, file: fileOf('src/a.ts') as never })]),
      EMPTY_DATE_RANGES
    );
    const firstCellRoot = buildings.group.children[0];
    const firstMesh = buildings.pickables()[0] as THREE.InstancedMesh;
    const sharedMat = firstMesh.material as THREE.Material;
    // The cell detail mesh shares the module material (guarded by userData).
    expect(firstMesh.userData.sharedMaterial).toBe(true);

    await buildings.rebuild(
      buildingLayout([building({ x: 5, y: 5, file: fileOf('src/a.ts') as never })]),
      EMPTY_DATE_RANGES
    );

    // Old cell root detached; new one swapped in (no accumulation).
    expect(firstCellRoot.parent).toBeNull();
    expect(buildings.group.children.length).toBe(1);
    expect(buildings.group.children[0]).not.toBe(firstCellRoot);

    // The SHARED material survived the prior cell-root disposal — the new
    // cell's detail mesh still references a usable (non-disposed) material.
    const secondMesh = buildings.pickables()[0] as THREE.InstancedMesh;
    expect(secondMesh.material).toBe(sharedMat);
    // A disposed three.js material has no program; a live one still renders.
    // The shared material's uniforms object is intact (not nulled by dispose).
    expect((secondMesh.material as THREE.ShaderMaterial).uniforms).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Shared-material theme effect
  // ---------------------------------------------------------------------------

  it('material effect re-applies uOutlineWidth on BUILDINGS Save', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);
    // Force the shared material to exist (created lazily during rebuild).
    await buildings.rebuild(
      buildingLayout([building({ x: 1, y: 1, file: fileOf('src/a.ts') as never })]),
      EMPTY_DATE_RANGES
    );
    const uniforms = getSharedBuildingUniforms();

    BUILDINGS.value = { ...BUILDINGS.value, OUTLINE_WIDTH: 7.5 };
    expect(uniforms.uOutlineWidth.value).toBe(7.5);

    BUILDINGS.value = { ...BUILDINGS.value, OUTLINE_WIDTH: 2.25 };
    expect(uniforms.uOutlineWidth.value).toBe(2.25);
  });

  // ---------------------------------------------------------------------------
  // Picker overlays — ARMED on the first tick (the arming-bug guard)
  // ---------------------------------------------------------------------------

  it('does NOT arm the overlays before the first tick (no ghost mesh in scene)', async () => {
    const { ctx, hover } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);
    const b0 = building({ x: 5, y: 5, file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]), EMPTY_DATE_RANGES);

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
    const { ctx, hover } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);
    const b0 = building({ x: 5, y: 5, file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]), EMPTY_DATE_RANGES);

    // First tick arms the overlays — the ghost mesh now exists (hidden).
    buildings.tick(0.016, { dt: 0.016, time: 0, camera: ctx.camera });
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

  // ---------------------------------------------------------------------------
  // Self-tween — rebuild() computes its own enter/stay diff and drives the
  // tweens through tick(). The boot rebuild does NOT animate; the 2nd+ do.
  // ---------------------------------------------------------------------------

  it('the FIRST rebuild (boot) does NOT fire enter tweens — the city snaps in', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);

    const b0 = building({ x: 10, y: 10, h: 8, file: fileOf('src/a.ts') as never });

    const now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      await buildings.rebuild(buildingLayout([b0]), EMPTY_DATE_RANGES);

      // The boot rebuild lands the building at its FINAL layout transform
      // (cell assembly), and no tween touches it on tick — so a tick at t=0
      // (where an entering tween would have written scaleY≈0.0001) leaves the
      // full-height matrix in place.
      const resolved = buildings.getMeshForBuilding(b0)!;
      const mesh = resolved.mesh;
      const m = new THREE.Matrix4();

      buildings.tick(0, { dt: 0, time: 0, camera: ctx.camera });
      mesh.getMatrixAt(resolved.slot, m);
      // scaleY is the full height (no grow-in tween was started).
      expect(m.elements[5]).toBeCloseTo(b0.h, 6);
      expect(m.elements[13]).toBeCloseTo(b0.h / 2, 6);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a SECOND rebuild introducing a new building fires its enter tween through tick() and lands the final transform', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);

    // Boot rebuild (no animation) with one building.
    const b0 = building({ x: 10, y: 10, h: 8, file: fileOf('src/a.ts') as never });
    await buildings.rebuild(buildingLayout([b0]), EMPTY_DATE_RANGES);

    const transitionMs = BUILDINGS.value.BUILDING_TRANSITION_MS;
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      // Second rebuild adds a NEW building path → it enters (grows in).
      const b1 = building({ x: -20, y: -20, h: 12, file: fileOf('src/b.ts') as never });
      const a = building({ x: 10, y: 10, h: 8, file: fileOf('src/a.ts') as never });
      await buildings.rebuild(buildingLayout([a, b1]), EMPTY_DATE_RANGES);

      const resolved = buildings.getMeshForBuilding(b1)!;
      const mesh = resolved.mesh;
      const m = new THREE.Matrix4();

      // Mid-tween tick: interpolated scaleY strictly between ~0 and the
      // final height (elements[5] is the Y scale of a makeScale matrix).
      now = transitionMs / 2;
      buildings.tick(0, { dt: 0, time: 0, camera: ctx.camera });
      mesh.getMatrixAt(resolved.slot, m);
      expect(m.elements[5]).toBeGreaterThan(0.0001);
      expect(m.elements[5]).toBeLessThan(b1.h);

      // Past the duration: the final scale + position land exactly.
      now = transitionMs + 1;
      buildings.tick(0, { dt: 0, time: 0, camera: ctx.camera });
      mesh.getMatrixAt(resolved.slot, m);
      expect(m.elements[5]).toBeCloseTo(b1.h, 6);
      expect(m.elements[13]).toBeCloseTo(b1.h / 2, 6);
      expect(m.elements[12]).toBeCloseTo(b1.x, 6);
      expect(m.elements[14]).toBeCloseTo(b1.y, 6);
    } finally {
      vi.restoreAllMocks();
    }
  });

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  it('dispose() empties the group, removes overlays, and stops the material effect', async () => {
    const { ctx } = makeCtx();
    buildings = createBuildings(ctx, NOOP_DEPS);
    await buildings.rebuild(
      buildingLayout([building({ x: 1, y: 1, file: fileOf('src/a.ts') as never })]),
      EMPTY_DATE_RANGES
    );
    buildings.tick(0, { dt: 0, time: 0, camera: ctx.camera });
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
