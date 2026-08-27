// createCity builds streets before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { createStreets } from '@/city/components/streets';
import { makeCityState, makePickableSceneContext } from '../../../_helpers/cityFixtures';
import { STREETS } from '@/state/settings/fields/streets';
import type { Picker } from '@/city/interaction/picker';
import type { SceneContext } from '@/city/types';
import { NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';
import { PickTarget } from '@/city/types/picker';

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

function resetStreets() {
  STREETS.value = { ...DEFAULTS };
}

// A SceneContext whose picker exposes controllable selection + hover signals.

function makeStreet(overrides: Partial<Street> = {}): Street {
  return {
    x: 0,
    y: 0,
    width: 32,
    length: 600,
    label: 'src',
    orientation: StreetAxis.X,
    isRoot: true,
    dir: { name: 'src', path: 'src', type: NodeKind.Directory },
    ...overrides,
  } as unknown as Street;
}

function singleStreetLayout(overrides: Partial<Street> = {}): CityLayout {
  return {
    buildings: [],
    streets: [makeStreet(overrides)],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: { minX: -300, minY: -16, maxX: 300, maxY: 16, cx: 0, cy: 0, width: 600, depth: 32 },
  } as unknown as CityLayout;
}

// A camera whose world-right vector points along +X (no flip) or -X (flip).
function cameraRight(x: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera();
  cam.matrixWorld.identity();
  // Column 0 (the right vector) = (x, 0, 0).
  cam.matrixWorld.elements[0] = x;
  cam.matrixWorld.elements[1] = 0;
  cam.matrixWorld.elements[2] = 0;
  return cam;
}

// Sidewalks, one merged asphalt mesh and the labels are all direct children of
// the component's group, so the helpers below read them off the live tree.
type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
function asphaltMeshOf(s: ReturnType<typeof createStreets>): FlatMesh | null {
  return (s.group.children.find((c) => c.name === 'city-asphalt') as FlatMesh) ?? null;
}
function labelsOf(s: ReturnType<typeof createStreets>): THREE.Group[] {
  return s.group.children.filter((c) => c.userData.type === NodeKind.Label) as THREE.Group[];
}
// The merged sidewalk carries per-vertex colors; the single-street fixtures put
// every vertex on one street, so vertex 0's color is that street's tint.
function sidewalkColorHex(s: ReturnType<typeof createStreets>): number {
  const sw = s.getPickables()[0];
  const attr = sw.geometry.getAttribute('color') as THREE.BufferAttribute;
  return new THREE.Color(attr.getX(0), attr.getY(0), attr.getZ(0)).getHex();
}
function firstStreetDir(s: ReturnType<typeof createStreets>): unknown {
  return (s.getPickables()[0].userData.pickStreets[0] as { dir: unknown }).dir;
}

describe('createStreets()', () => {
  let streets: ReturnType<typeof createStreets>;

  beforeEach(() => {
    resetStreets();
  });

  afterEach(() => {
    streets?.dispose();
  });

  // Construction

  it('constructs with an empty named group (pre-rebuild), no throws', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    expect(streets.group).toBeInstanceOf(THREE.Group);
    expect(streets.group.name).toBe('city-streets');
    expect(streets.group.children).toHaveLength(0);
    expect(streets.getPickables()).toHaveLength(0);
  });

  it('theme effect runs at construction with a null picker without throwing', () => {
    const ctx = {
      scene: new THREE.Scene(),
      picker: null as unknown as Picker,
      camera: null as unknown as THREE.PerspectiveCamera,
      renderer: null as unknown as THREE.WebGLRenderer,
      cityState: makeCityState(),
    } as unknown as SceneContext;
    streets = createStreets(ctx);
    STREETS.value = { ...STREETS.value };
    expect(streets.group.children).toHaveLength(0);
  });

  it('rebuild() populates group.children, pickables, asphalt, and labels', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());

    // One sidewalk mesh + one merged asphalt mesh + ≥1 label group under group.
    expect(streets.getPickables()).toHaveLength(1);
    expect(asphaltMeshOf(streets)).not.toBeNull();
    expect(labelsOf(streets).length).toBeGreaterThanOrEqual(1);
    // Group holds: 1 sidewalk + 1 asphalt + each label group.
    expect(streets.group.children.length).toBe(2 + labelsOf(streets).length);
  });

  it("rebuild() gives a street's label repeats one geometry, material and texture", () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout({ length: 4000 } as Partial<Street>));

    const planes = labelsOf(streets).map((g) => g.children[0] as FlatMesh);
    expect(planes.length).toBeGreaterThan(1);
    for (const p of planes.slice(1)) {
      expect(p.geometry).toBe(planes[0].geometry);
      expect(p.material).toBe(planes[0].material);
    }
  });

  // The planes opt out of disposing what they share, so if the street stops
  // freeing it the texture leaks silently — nothing else owns it.
  it('rebuild() frees the shared label texture rather than leaking it', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout({ length: 4000 } as Partial<Street>));

    const shared = (labelsOf(streets)[0].children[0] as FlatMesh).material;
    const texture = shared.map!;
    const texSpy = vi.spyOn(texture, 'dispose');
    const matSpy = vi.spyOn(shared, 'dispose');

    streets.rebuild(singleStreetLayout({ length: 4000 } as Partial<Street>));

    expect(texSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
  });

  it('rebuild() builds the sidewalk lookup keyed by street dir.path', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(
      singleStreetLayout({
        dir: { name: 'src', path: 'src', type: NodeKind.Directory },
      } as Partial<Street>)
    );

    const sw = streets.getSidewalkByDir('src');
    expect(sw).toBe(streets.getPickables()[0]);
    expect(streets.getSidewalkByDir('nope')).toBeNull();
  });

  it('rebuild() disposes the prior street set and rebuilds (no leak in group)', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const firstSidewalk = streets.getPickables()[0];
    // Sidewalk meshes are direct children of the outer group now.
    expect(firstSidewalk.parent).toBe(streets.group);
    const firstChildCount = streets.group.children.length;

    streets.rebuild(singleStreetLayout());
    // Old sidewalk detached from the outer group; new sidewalk is a different mesh.
    expect(firstSidewalk.parent).toBeNull();
    expect(streets.group.children).not.toContain(firstSidewalk);
    expect(streets.getPickables()[0]).not.toBe(firstSidewalk);
    // Child count is stable across an identical rebuild (no accumulation).
    expect(streets.group.children.length).toBe(firstChildCount);
  });

  // Theme effect — recolors asphalt + sidewalk on STREETS Save

  it('theme effect recolors asphalt on STREETS.ASPHALT_COLOR mutation', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());

    STREETS.value = { ...STREETS.value, ASPHALT_COLOR: '#abcdef' };
    const asphalt = asphaltMeshOf(streets)!;
    expect(asphalt.material.color.getHex()).toBe(new THREE.Color('#abcdef').getHex());
  });

  it('theme effect resets sidewalk origColor + tint on SIDEWALK_DEFAULT mutation', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());

    STREETS.value = { ...STREETS.value, SIDEWALK_DEFAULT: '#010203' };
    const expected = new THREE.Color('#010203').getHex();
    // No selection/hover → sidewalk paints the default.
    expect(sidewalkColorHex(streets)).toBe(expected);
  });

  it('theme effect rescales label height on LABEL_HEIGHT_FRAC mutation', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const label = labelsOf(streets)[0];
    const plane = label.children[0] as THREE.Mesh;

    // origHeightFrac is the default 0.5; doubling LABEL_HEIGHT_FRAC → scale 2.
    STREETS.value = { ...STREETS.value, LABEL_HEIGHT_FRAC: 1.0 };
    expect(plane.scale.x).toBeCloseTo(1.0 / label.userData.origHeightFrac);
    expect(plane.scale.y).toBeCloseTo(1.0 / label.userData.origHeightFrac);
  });

  // Picker-tint effects — ARMED on first tick (the arming-bug guard)

  it('does NOT re-tint on selection before the first tick (effects not yet armed)', () => {
    const { ctx, selection } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const sw = streets.getPickables()[0];
    const defaultHex = new THREE.Color(DEFAULTS.SIDEWALK_DEFAULT).getHex();
    expect(sidewalkColorHex(streets)).toBe(defaultHex);

    // Set a selection BEFORE any tick — effects aren't armed, so no re-tint.
    selection.value = {
      kind: NodeKind.Directory,
      sidewalk: sw,
      dir: firstStreetDir(streets),
    } as unknown as PickTarget;
    expect(sidewalkColorHex(streets)).toBe(defaultHex);
  });

  it('arms picker-tint effects on first tick; a later selection re-tints to SELECTED', () => {
    const { ctx, selection } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const sw = streets.getPickables()[0];
    const defaultHex = new THREE.Color(DEFAULTS.SIDEWALK_DEFAULT).getHex();
    const selectedHex = new THREE.Color(DEFAULTS.SIDEWALK_SELECTED).getHex();

    // First tick: arms the effects; with no selection yet, sidewalk stays DEFAULT.
    streets.tick(0.016, { dt: 0.016, time: 0, camera: cameraRight(1) });
    expect(sidewalkColorHex(streets)).toBe(defaultHex);

    // Now select this sidewalk — the live, armed effect fires synchronously.
    selection.value = {
      kind: NodeKind.Directory,
      sidewalk: sw,
      dir: firstStreetDir(streets),
    } as unknown as PickTarget;
    expect(sidewalkColorHex(streets)).toBe(selectedHex);

    // Clearing the selection restores the default tint.
    selection.value = null;
    expect(sidewalkColorHex(streets)).toBe(defaultHex);
  });

  it('arms hover tinting; hovering this sidewalk paints SIDEWALK_HOVER', () => {
    const { ctx, hover } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const sw = streets.getPickables()[0];
    const hoverHex = new THREE.Color(DEFAULTS.SIDEWALK_HOVER).getHex();

    streets.tick(0.016, { dt: 0.016, time: 0, camera: cameraRight(1) });
    hover.value = {
      kind: NodeKind.Directory,
      sidewalk: sw,
      dir: firstStreetDir(streets),
    } as unknown as PickTarget;
    expect(sidewalkColorHex(streets)).toBe(hoverHex);
  });

  it('tick() hides labels that project too small (visibility LOD) and re-shows up close', () => {
    const { ctx, size } = makePickableSceneContext();
    size.h = 800;
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const label = labelsOf(streets)[0];

    const camAt = (dist: number) => {
      const c = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
      c.position.set(label.position.x, dist, label.position.z + dist);
      c.updateMatrixWorld(true);
      return c;
    };

    // Close → visible.
    streets.tick(0.016, { dt: 0.016, time: 0, camera: camAt(30) });
    expect(label.visible).toBe(true);
    // Far → hidden (sub-pixel).
    streets.tick(0.016, { dt: 0.016, time: 0, camera: camAt(30000) });
    expect(label.visible).toBe(false);
    // Zoom back in → shown again.
    streets.tick(0.016, { dt: 0.016, time: 0, camera: camAt(30) });
    expect(label.visible).toBe(true);
  });

  // tick() — label camera-orientation hysteresis

  it('tick() flips a label past the −0.15 hysteresis and un-flips past +0.15', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout()); // X-oriented → uses rightX
    const label = labelsOf(streets)[0];
    const base = label.userData.baseRotY || 0;

    // Right vector well inside +THRESH → not flipped.
    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(1) });
    expect(label.userData.flipped).toBe(false);
    expect(label.rotation.y).toBeCloseTo(base);

    // Near-zero (inside dead zone) → no change, stays not-flipped.
    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(0.1) });
    expect(label.userData.flipped).toBe(false);

    // Clearly negative → flips.
    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(-1) });
    expect(label.userData.flipped).toBe(true);
    expect(label.rotation.y).toBeCloseTo(base + Math.PI);

    // Back inside the dead zone → stays flipped (hysteresis).
    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(-0.1) });
    expect(label.userData.flipped).toBe(true);

    // Clearly positive → un-flips.
    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(1) });
    expect(label.userData.flipped).toBe(false);
  });

  // Labels set matrixAutoUpdate = false, so a flip that writes rotation.y and
  // stops there would render at the old angle however right userData looks.
  it('tick() bakes the flip into the label matrix, not just rotation.y', () => {
    const { ctx } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const label = labelsOf(streets)[0];

    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(1) });
    const unflipped = label.matrix.clone();

    streets.tick(0, { dt: 0, time: 0, camera: cameraRight(-1) });
    expect(label.matrix.equals(unflipped)).toBe(false);
    expect(
      label.matrix.equals(
        new THREE.Matrix4().compose(
          label.position,
          new THREE.Quaternion().setFromEuler(label.rotation),
          label.scale
        )
      )
    ).toBe(true);
  });

  // dispose()

  it('dispose() empties the group and stops effects (later STREETS mutations no-op)', () => {
    const { ctx, selection } = makePickableSceneContext();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    streets.tick(0.016, { dt: 0.016, time: 0, camera: cameraRight(1) });
    const sw = streets.getPickables()[0];

    streets.dispose();
    expect(streets.group.children).toHaveLength(0);

    // Effects are stopped — selection + STREETS mutations don't throw and
    // don't re-tint the (now-detached) sidewalk to SELECTED.
    selection.value = {
      kind: NodeKind.Directory,
      sidewalk: sw,
      dir: firstStreetDir(streets),
    } as unknown as PickTarget;
    STREETS.value = { ...STREETS.value, ASPHALT_COLOR: '#000000' };
    expect(sidewalkColorHex(streets)).not.toBe(
      new THREE.Color(DEFAULTS.SIDEWALK_SELECTED).getHex()
    );
  });
});
