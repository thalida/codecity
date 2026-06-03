// app/tests/city/components/streets/index.test.ts
//
// Tests for the persistent createStreets(ctx) component.
// API: createStreets(ctx) → { group, rebuild(layout), tick(dt, frame),
//      dispose(), pickables(), labels(), asphalt(), getSidewalkByDir(p),
//      getStreetByDir(p), sidewalksByDirMap(), streetsByDirMap() }.
//
// STREETS settings reactivity (sidewalk/asphalt colors, label height) is owned
// by the component's theme effect; the hover/selection sidewalk tints are owned
// by two picker-driven effects ARMED on the first tick() (NOT at construction —
// at construction ctx.picker is null, so a construction-time effect would track
// no signal and never re-fire). The arming test below directly guards that bug
// fix: a selection set AFTER the first tick must re-tint the sidewalk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';

import { createStreets } from '@/city/components/streets';
import { STREETS } from '@/state/stores/settings/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, PickTarget, Street } from '@/types';
import type { Picker } from '@/city/system/picker';
import type { SceneContext } from '@/city/types';

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
function makeCtx(): {
  ctx: SceneContext;
  selection: ReturnType<typeof signal<PickTarget | null>>;
  hover: ReturnType<typeof signal<PickTarget | null>>;
} {
  const selection = signal<PickTarget | null>(null);
  const hover = signal<PickTarget | null>(null);
  const ctx = {
    scene: new THREE.Scene(),
    picker: { selection, hover } as unknown as Picker,
    camera: new THREE.PerspectiveCamera(),
    renderer: null as unknown as THREE.WebGLRenderer,
  } as SceneContext;
  return { ctx, selection, hover };
}

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

describe('createStreets()', () => {
  let streets: ReturnType<typeof createStreets>;

  beforeEach(() => {
    resetStreets();
  });

  afterEach(() => {
    streets?.dispose();
  });

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('constructs with an empty named group (pre-rebuild), no throws', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    expect(streets.group).toBeInstanceOf(THREE.Group);
    expect(streets.group.name).toBe('city-streets');
    expect(streets.group.children).toHaveLength(0);
    expect(streets.pickables()).toHaveLength(0);
  });

  it('theme effect runs at construction with a null picker without throwing', () => {
    const ctx = {
      scene: new THREE.Scene(),
      picker: null as unknown as Picker,
      camera: null as unknown as THREE.PerspectiveCamera,
      renderer: null as unknown as THREE.WebGLRenderer,
    } as unknown as SceneContext;
    expect(() => {
      streets = createStreets(ctx);
      STREETS.value = { ...STREETS.value };
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // rebuild() — populates group + arrays + lookups
  // ---------------------------------------------------------------------------

  it('rebuild() populates group.children, pickables, asphalt, and labels', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());

    // One sidewalk + one asphalt + ≥1 label group all under the outer group.
    expect(streets.pickables()).toHaveLength(1);
    expect(streets.asphalt()).toHaveLength(1);
    expect(streets.labels().length).toBeGreaterThanOrEqual(1);
    // Group holds the street group (sidewalk+asphalt) + each label group.
    expect(streets.group.children.length).toBe(1 + streets.labels().length);
  });

  it('rebuild() builds lookups keyed by street dir.path', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(
      singleStreetLayout({
        dir: { name: 'src', path: 'src', type: NodeKind.Directory },
      } as Partial<Street>)
    );

    const sw = streets.getSidewalkByDir('src');
    expect(sw).toBe(streets.pickables()[0]);
    const st = streets.getStreetByDir('src');
    expect(st).not.toBeNull();
    expect(st!.dir.path).toBe('src');
    expect(streets.sidewalksByDirMap().src).toBe(sw);
    expect(streets.streetsByDirMap().src).toBe(st);
    expect(streets.getSidewalkByDir('nope')).toBeNull();
    expect(streets.getStreetByDir('nope')).toBeNull();
  });

  it('rebuild() disposes the prior street set and rebuilds (no leak in group)', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const firstSidewalk = streets.pickables()[0];
    // The sidewalk's parent is its street group; that street group is the
    // outer group's child.
    const firstStreetGroup = firstSidewalk.parent!;
    expect(firstStreetGroup.parent).toBe(streets.group);
    const firstChildCount = streets.group.children.length;

    streets.rebuild(singleStreetLayout());
    // Old street group detached from the outer group; new sidewalk is a
    // different mesh.
    expect(firstStreetGroup.parent).toBeNull();
    expect(streets.group.children).not.toContain(firstStreetGroup);
    expect(streets.pickables()[0]).not.toBe(firstSidewalk);
    // Child count is stable across an identical rebuild (no accumulation).
    expect(streets.group.children.length).toBe(firstChildCount);
  });

  // ---------------------------------------------------------------------------
  // Theme effect — recolors asphalt + sidewalk on STREETS Save
  // ---------------------------------------------------------------------------

  it('theme effect recolors asphalt on STREETS.ASPHALT_COLOR mutation', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());

    STREETS.value = { ...STREETS.value, ASPHALT_COLOR: '#abcdef' };
    const asphalt = streets.asphalt()[0];
    expect(asphalt.material.color.getHex()).toBe(new THREE.Color('#abcdef').getHex());
  });

  it('theme effect resets sidewalk origColor + tint on SIDEWALK_DEFAULT mutation', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());

    STREETS.value = { ...STREETS.value, SIDEWALK_DEFAULT: '#010203' };
    const sw = streets.pickables()[0];
    const expected = new THREE.Color('#010203').getHex();
    // No selection/hover → sidewalk paints the default.
    expect(sw.material.color.getHex()).toBe(expected);
    expect(sw.userData.origColor).toBe(expected);
  });

  it('theme effect rescales label height on LABEL_HEIGHT_FRAC mutation', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const label = streets.labels()[0];
    const plane = label.children[0] as THREE.Mesh;

    // origHeightFrac is the default 0.5; doubling LABEL_HEIGHT_FRAC → scale 2.
    STREETS.value = { ...STREETS.value, LABEL_HEIGHT_FRAC: 1.0 };
    expect(plane.scale.x).toBeCloseTo(1.0 / label.userData.origHeightFrac);
    expect(plane.scale.y).toBeCloseTo(1.0 / label.userData.origHeightFrac);
  });

  // ---------------------------------------------------------------------------
  // Picker-tint effects — ARMED on first tick (the arming-bug guard)
  // ---------------------------------------------------------------------------

  it('does NOT re-tint on selection before the first tick (effects not yet armed)', () => {
    const { ctx, selection } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const sw = streets.pickables()[0];
    const defaultHex = new THREE.Color(DEFAULTS.SIDEWALK_DEFAULT).getHex();
    expect(sw.material.color.getHex()).toBe(defaultHex);

    // Set a selection BEFORE any tick — effects aren't armed, so no re-tint.
    selection.value = { kind: NodeKind.Directory, sidewalk: sw } as unknown as PickTarget;
    expect(sw.material.color.getHex()).toBe(defaultHex);
  });

  it('arms picker-tint effects on first tick; a later selection re-tints to SELECTED', () => {
    const { ctx, selection } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const sw = streets.pickables()[0];
    const defaultHex = new THREE.Color(DEFAULTS.SIDEWALK_DEFAULT).getHex();
    const selectedHex = new THREE.Color(DEFAULTS.SIDEWALK_SELECTED).getHex();

    // First tick: arms the effects; with no selection yet, sidewalk stays DEFAULT.
    streets.tick(0.016, { dt: 0.016, time: 0, camera: cameraRight(1) });
    expect(sw.material.color.getHex()).toBe(defaultHex);

    // Now select this sidewalk — the live, armed effect fires synchronously.
    selection.value = { kind: NodeKind.Directory, sidewalk: sw } as unknown as PickTarget;
    expect(sw.material.color.getHex()).toBe(selectedHex);

    // Clearing the selection restores the default tint.
    selection.value = null;
    expect(sw.material.color.getHex()).toBe(defaultHex);
  });

  it('arms hover tinting; hovering this sidewalk paints SIDEWALK_HOVER', () => {
    const { ctx, hover } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    const sw = streets.pickables()[0];
    const hoverHex = new THREE.Color(DEFAULTS.SIDEWALK_HOVER).getHex();

    streets.tick(0.016, { dt: 0.016, time: 0, camera: cameraRight(1) });
    hover.value = { kind: NodeKind.Directory, sidewalk: sw } as unknown as PickTarget;
    expect(sw.material.color.getHex()).toBe(hoverHex);
  });

  // ---------------------------------------------------------------------------
  // tick() — label camera-orientation hysteresis
  // ---------------------------------------------------------------------------

  it('tick() flips a label past the −0.15 hysteresis and un-flips past +0.15', () => {
    const { ctx } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout()); // X-oriented → uses rightX
    const label = streets.labels()[0];
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

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  it('dispose() empties the group and stops effects (later STREETS mutations no-op)', () => {
    const { ctx, selection } = makeCtx();
    streets = createStreets(ctx);
    streets.rebuild(singleStreetLayout());
    streets.tick(0.016, { dt: 0.016, time: 0, camera: cameraRight(1) });
    const sw = streets.pickables()[0];

    streets.dispose();
    expect(streets.group.children).toHaveLength(0);

    // Effects are stopped — selection + STREETS mutations don't throw and
    // don't re-tint the (now-detached) sidewalk to SELECTED.
    expect(() => {
      selection.value = { kind: NodeKind.Directory, sidewalk: sw } as unknown as PickTarget;
      STREETS.value = { ...STREETS.value, ASPHALT_COLOR: '#000000' };
    }).not.toThrow();
    expect(sw.material.color.getHex()).not.toBe(
      new THREE.Color(DEFAULTS.SIDEWALK_SELECTED).getHex()
    );
  });
});
