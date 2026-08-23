// COLOR / CORNER_RADIUS / ENABLED reactivity belongs to the component's own
// effect, so these tests drive it by mutating FOOTPRINT.value.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createFootprint } from '@/city/scene/components/footprint';
import { FOOTPRINT } from '@/city/session/settings/footprint';
import { StreetAxis } from '@/city/scene/types';
import type { CityLayout, Street } from '@/city/scene/types';
import {
  BuildingLane,
  blankBuildingScrubState,
  type BuildingScrubState,
} from '@/city/scene/components/buildings/scrubState';
import { StreetTint, type StreetScrubState } from '@/city/scene/components/streets/scrubState';
import type { ScrubStates } from '@/city/scene/scrub/scrubPass';
import { makeSceneContext } from '../../../../_helpers/cityFixtures';

function resetFootprint() {
  FOOTPRINT.value = { ENABLED: true, HALO_WIDTH: 32, CORNER_RADIUS: 1.25, COLOR: '#0a0b0f' };
}

// footprint reads ctx.build for its layout effect; layout stays null here
// (effect no-ops) and tests drive rebuild() directly.

function singleBuildingLayout(): CityLayout {
  return {
    buildings: [
      {
        x: 0,
        y: 0,
        w: 10,
        d: 10,
        h: 16,
        floors: 1,
        file: { path: 'a', size: 0, lines: 0 },
      } as never,
    ],
    streets: [],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10, cx: 0, cy: 0, width: 20, depth: 20 },
  };
}

describe('createFootprint()', () => {
  let fp: ReturnType<typeof createFootprint>;

  beforeEach(() => {
    resetFootprint();
    fp = createFootprint(makeSceneContext());
  });

  afterEach(() => {
    fp.dispose();
  });

  // Construction

  it('constructs with an empty group (pre-rebuild), no throws', () => {
    expect(fp.group).toBeInstanceOf(THREE.Group);
    expect(fp.group.children).toHaveLength(0);
  });

  it('effect is inert before the first rebuild', () => {
    // No mesh yet, so the effect fires against a null material and its
    // `if (material)` guard is what holds.
    FOOTPRINT.value = { ...FOOTPRINT.value };
    expect(fp.group.children).toHaveLength(0);
  });

  it('rebuild() emits one InstancedMesh instance per layout rect', () => {
    const layout: CityLayout = {
      buildings: [
        {
          x: 0,
          y: 0,
          w: 20,
          d: 20,
          h: 32,
          floors: 2,
          file: { path: 'a', size: 0, lines: 0 },
        } as never,
      ],
      streets: [
        {
          x: 100,
          y: 0,
          length: 200,
          width: 32,
          orientation: StreetAxis.X,
          isRoot: true,
          name: 'main',
        } as never,
      ],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
      bbox: { minX: -100, minY: -100, maxX: 200, maxY: 100, cx: 50, cy: 0, width: 300, depth: 200 },
    };
    fp.rebuild(layout);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(2);
  });

  it('rebuild() attaches a per-instance aHalfExtent attribute carrying inflated half-extents', () => {
    FOOTPRINT.value = { ...FOOTPRINT.value, HALO_WIDTH: 50 };
    const layout: CityLayout = {
      buildings: [
        {
          x: 0,
          y: 0,
          w: 20,
          d: 40,
          h: 32,
          floors: 2,
          file: { path: 'a', size: 0, lines: 0 },
        } as never,
      ],
      streets: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
      bbox: { minX: -10, minY: -20, maxX: 10, maxY: 20, cx: 0, cy: 0, width: 20, depth: 40 },
    };
    fp.rebuild(layout);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aHalfExtent') as THREE.InstancedBufferAttribute;
    expect(attr).toBeTruthy();
    // Inflated half-width = (20 + 2*50)/2 = 60; half-depth = (40 + 2*50)/2 = 70
    expect(attr.getX(0)).toBeCloseTo(60);
    expect(attr.getY(0)).toBeCloseTo(70);
  });

  it('rebuild() uses a ShaderMaterial whose uColor matches FOOTPRINT.COLOR at build time', () => {
    FOOTPRINT.value = { ...FOOTPRINT.value, COLOR: '#abcdef' };
    fp.rebuild(singleBuildingLayout());
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    const color = mat.uniforms.uColor.value as THREE.Color;
    const expected = new THREE.Color().setStyle('#abcdef', THREE.LinearSRGBColorSpace);
    expect(color.r).toBeCloseTo(expected.r);
    expect(color.g).toBeCloseTo(expected.g);
    expect(color.b).toBeCloseTo(expected.b);
  });

  it('rebuild() sets uCornerRadius uniform to CORNER_RADIUS scaled by HALO_WIDTH', () => {
    FOOTPRINT.value = { ...FOOTPRINT.value, HALO_WIDTH: 80, CORNER_RADIUS: 0.5 };
    fp.rebuild(singleBuildingLayout());
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uCornerRadius.value).toBeCloseTo(40); // 0.5 × 80
  });

  it('rebuild() hides the group when FOOTPRINT.ENABLED is false', () => {
    FOOTPRINT.value = { ...FOOTPRINT.value, ENABLED: false };
    fp.rebuild(singleBuildingLayout());
    expect(fp.group.visible).toBe(false);
  });

  // rebuild() — stub/empty case

  it('rebuild() leaves the group EMPTY when halo <= 0 (stub case — no mesh)', () => {
    FOOTPRINT.value = { ...FOOTPRINT.value, HALO_WIDTH: 0 };
    fp.rebuild(singleBuildingLayout());
    expect(fp.group.children).toHaveLength(0);
  });

  it('rebuild() disposes the prior mesh when called twice and leaves the group with one child', () => {
    fp.rebuild(singleBuildingLayout());
    const firstMesh = fp.group.children[0] as THREE.InstancedMesh;
    expect(firstMesh).toBeInstanceOf(THREE.InstancedMesh);

    fp.rebuild(singleBuildingLayout());
    // Old mesh should be detached from the group.
    expect(firstMesh.parent).toBeNull();
    // Group should have exactly one child (the new mesh).
    expect(fp.group.children).toHaveLength(1);
    expect(fp.group.children[0]).not.toBe(firstMesh);
  });

  it('rebuild() disposes prior mesh and leaves group EMPTY on stub→empty transition', () => {
    // First build with a valid halo.
    fp.rebuild(singleBuildingLayout());
    const firstMesh = fp.group.children[0] as THREE.InstancedMesh;
    expect(firstMesh).toBeInstanceOf(THREE.InstancedMesh);

    // Second build with halo=0 → should remove & dispose the prior mesh, leave group empty.
    FOOTPRINT.value = { ...FOOTPRINT.value, HALO_WIDTH: 0 };
    fp.rebuild(singleBuildingLayout());
    expect(firstMesh.parent).toBeNull();
    expect(fp.group.children).toHaveLength(0);
  });

  it('effect picks up COLOR change via FOOTPRINT signal mutation', () => {
    fp.rebuild(singleBuildingLayout());
    FOOTPRINT.value = { ...FOOTPRINT.value, COLOR: '#112233' };
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    const color = mat.uniforms.uColor.value as THREE.Color;
    const expected = new THREE.Color().setStyle('#112233', THREE.LinearSRGBColorSpace);
    expect(color.r).toBeCloseTo(expected.r);
    expect(color.g).toBeCloseTo(expected.g);
    expect(color.b).toBeCloseTo(expected.b);
  });

  it('effect picks up CORNER_RADIUS change via FOOTPRINT signal mutation', () => {
    fp.rebuild(singleBuildingLayout());
    // HALO_WIDTH=32 (from resetFootprint), CORNER_RADIUS=0.25 → 0.25×32=8
    FOOTPRINT.value = { ...FOOTPRINT.value, CORNER_RADIUS: 0.25 };
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uCornerRadius.value).toBeCloseTo(8);
  });

  it('effect picks up ENABLED=false via FOOTPRINT signal mutation', () => {
    fp.rebuild(singleBuildingLayout());
    FOOTPRINT.value = { ...FOOTPRINT.value, ENABLED: false };
    expect(fp.group.visible).toBe(false);
    FOOTPRINT.value = { ...FOOTPRINT.value, ENABLED: true };
    expect(fp.group.visible).toBe(true);
  });

  it('effect applies COLOR + CORNER_RADIUS + ENABLED all at once on a single mutation', () => {
    fp.rebuild(singleBuildingLayout());
    FOOTPRINT.value = { ENABLED: false, HALO_WIDTH: 32, CORNER_RADIUS: 0.25, COLOR: '#112233' };
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    const color = mat.uniforms.uColor.value as THREE.Color;
    const expected = new THREE.Color().setStyle('#112233', THREE.LinearSRGBColorSpace);
    expect(color.r).toBeCloseTo(expected.r);
    expect(color.g).toBeCloseTo(expected.g);
    expect(color.b).toBeCloseTo(expected.b);
    expect(mat.uniforms.uCornerRadius.value).toBeCloseTo(8); // 0.25 × 32
    expect(fp.group.visible).toBe(false);
  });

  it('effect targets the NEW mesh after rebuild (no stale-closure leak)', () => {
    fp.rebuild(singleBuildingLayout());
    const firstMesh = fp.group.children[0] as THREE.InstancedMesh;

    // Rebuild swaps the inner mesh.
    fp.rebuild(singleBuildingLayout());
    const secondMesh = fp.group.children[0] as THREE.InstancedMesh;
    expect(secondMesh).not.toBe(firstMesh);

    // Now mutate — the effect must target the SECOND mesh's material.
    FOOTPRINT.value = { ...FOOTPRINT.value, COLOR: '#aabbcc' };
    const mat = secondMesh.material as THREE.ShaderMaterial;
    const color = mat.uniforms.uColor.value as THREE.Color;
    const expected = new THREE.Color().setStyle('#aabbcc', THREE.LinearSRGBColorSpace);
    expect(color.r).toBeCloseTo(expected.r);
    expect(color.g).toBeCloseTo(expected.g);
    expect(color.b).toBeCloseTo(expected.b);
  });

  // dispose()

  // Not a check that the effect stopped: dispose nulls the material and the
  // body is guarded on it, so a leak would look identical. This pins the guard.
  it('a FOOTPRINT mutation after dispose() is absorbed by the material guard', () => {
    fp.rebuild(singleBuildingLayout());
    fp.dispose();
    expect(() => {
      FOOTPRINT.value = { ...FOOTPRINT.value, COLOR: '#abcdef' };
    }).not.toThrow();
  });

  // Timeline opacity (Timeline mode fading)

  function layoutWithBuildingAndStreet(): CityLayout {
    return {
      buildings: [
        {
          x: 0,
          y: 0,
          w: 10,
          d: 10,
          h: 16,
          floors: 1,
          file: { path: 'a/b.txt', size: 0, lines: 0 },
        } as never,
      ],
      streets: [
        {
          x: 0,
          y: 0,
          length: 20,
          width: 8,
          orientation: StreetAxis.X,
          isRoot: true,
          name: 'a',
          dir: { path: 'a' },
        } as never,
      ],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
      bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10, cx: 0, cy: 0, width: 20, depth: 20 },
    };
  }

  it('defaults every instance aOpacity to 1 (opaque)', () => {
    fp.rebuild(layoutWithBuildingAndStreet());
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    expect(attr.getX(0)).toBe(1);
    expect(attr.getX(1)).toBe(1);
  });

  it('setBuildingFootprintOpacity writes aOpacity at the building instance', () => {
    fp.rebuild(layoutWithBuildingAndStreet());
    fp.setBuildingFootprintOpacity('a/b.txt', 0.3);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    expect(attr.getX(0)).toBeCloseTo(0.3);
    expect(attr.getX(1)).toBe(1); // street instance untouched
  });

  it('setStreetFootprintOpacity writes aOpacity at the street instance', () => {
    fp.rebuild(layoutWithBuildingAndStreet());
    fp.setStreetFootprintOpacity('a', 0.3);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    expect(attr.getX(1)).toBeCloseTo(0.3);
    expect(attr.getX(0)).toBe(1); // building instance untouched
  });

  it('the ruin flag writes aRuin, and setFootprintsTransparent clears it', () => {
    fp.rebuild(layoutWithBuildingAndStreet());
    const ruin = () =>
      (fp.group.children[0] as THREE.InstancedMesh).geometry.getAttribute(
        'aRuin'
      ) as THREE.InstancedBufferAttribute;
    fp.setBuildingFootprintOpacity('a/b.txt', 0.2, true);
    fp.setStreetFootprintOpacity('a', 0.2, true);
    expect(ruin().getX(0)).toBe(1);
    expect(ruin().getX(1)).toBe(1);
    fp.setBuildingFootprintOpacity('a/b.txt', 0.2, false);
    expect(ruin().getX(0)).toBe(0);
    // a mode switch clears all ruin tint
    fp.setFootprintsTransparent(true);
    expect(ruin().getX(1)).toBe(0);
  });

  it('opacity setters leave every instance alone for an unknown path', () => {
    fp.rebuild(layoutWithBuildingAndStreet());
    const attr = () =>
      (fp.group.children[0] as THREE.InstancedMesh).geometry.getAttribute(
        'aOpacity'
      ) as THREE.InstancedBufferAttribute;
    fp.setBuildingFootprintOpacity('nope', 0.5);
    fp.setStreetFootprintOpacity('nope', 0.5);
    expect(attr().getX(0)).toBe(1);
    expect(attr().getX(1)).toBe(1);
  });

  describe('applying a scrub frame', () => {
    const bStreet = { dir: { path: 'a' } } as unknown as Street;
    const opacityAt = (i: number) =>
      (
        (fp.group.children[0] as THREE.InstancedMesh).geometry.getAttribute(
          'aOpacity'
        ) as THREE.InstancedBufferAttribute
      ).getX(i);
    const ruinAt = (i: number) =>
      (
        (fp.group.children[0] as THREE.InstancedMesh).geometry.getAttribute(
          'aRuin'
        ) as THREE.InstancedBufferAttribute
      ).getX(i);

    const states = (
      building: Partial<BuildingScrubState>,
      street: Partial<StreetScrubState>
    ): ScrubStates => ({
      buildings: new Map([['a/b.txt', { ...blankBuildingScrubState(), ...building }]]),
      streets: new Map([[bStreet, { opacity: 1, tint: StreetTint.None, ruin: false, ...street }]]),
    });

    beforeEach(() => {
      fp.rebuild(layoutWithBuildingAndStreet());
    });

    it('tracks the lane opacity, not the neighborhood-faded body', () => {
      // A hover dimming the buildings around a selection must not take the
      // ground with it, so the plot follows `op` rather than `bodyOp`.
      fp.applyScrub(states({ lane: BuildingLane.Present, op: 1, bodyOp: 0.2 }, { opacity: 0.5 }));
      expect(opacityAt(0)).toBe(1);
      expect(opacityAt(1)).toBeCloseTo(0.5);
    });

    it('marks a deleted building and road so their plots read as rubble', () => {
      fp.applyScrub(states({ lane: BuildingLane.Ruin, op: 0.3 }, { opacity: 0.4, ruin: true }));
      expect(opacityAt(0)).toBeCloseTo(0.3);
      expect(ruinAt(0)).toBe(1);
      expect(ruinAt(1)).toBe(1);
    });
  });

  it('material defaults to opaque (transparent: false)', () => {
    fp.rebuild(singleBuildingLayout());
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(false);
  });

  it('setFootprintsTransparent(true) flips the material into the transparent pass', () => {
    fp.rebuild(singleBuildingLayout());
    fp.setFootprintsTransparent(true);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    fp.setFootprintsTransparent(false);
    expect(mat.transparent).toBe(false);
  });

  it('setFootprintsTransparent(true) hides every instance (0), false restores opaque (1)', () => {
    fp.rebuild(layoutWithBuildingAndStreet());
    const attr = () =>
      (fp.group.children[0] as THREE.InstancedMesh).geometry.getAttribute(
        'aOpacity'
      ) as THREE.InstancedBufferAttribute;
    fp.setFootprintsTransparent(true);
    expect(attr().getX(0)).toBe(0);
    expect(attr().getX(1)).toBe(0);
    fp.setFootprintsTransparent(false);
    expect(attr().getX(0)).toBe(1);
    expect(attr().getX(1)).toBe(1);
  });

  it('a rebuild while transparent keeps instances hidden (0), so a re-pack cannot strand them opaque', () => {
    fp.setFootprintsTransparent(true); // enter timeline mode before any mesh exists
    fp.rebuild(layoutWithBuildingAndStreet());
    const attr = (fp.group.children[0] as THREE.InstancedMesh).geometry.getAttribute(
      'aOpacity'
    ) as THREE.InstancedBufferAttribute;
    expect(attr.getX(0)).toBe(0);
    expect(attr.getX(1)).toBe(0);
  });
});
