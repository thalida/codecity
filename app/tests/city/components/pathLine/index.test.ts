// app/tests/city/components/pathLine/index.test.ts
//
// Tests for the persistent createPathLine(ctx) component (door).
// API: createPathLine(ctx) → { group, tick(dt, frame), onResize(),
//      dispose() }.
//
// The inner renderer owns the picker-driven geometry effects and a cityState
// rebuild effect (gemWorldPos + cityRevision), so it is ARMED on the first
// tick() (NOT at construction — ctx.picker is null there, so its effects would
// track no signal and never re-fire). The theme effect tracks ONLY STREETS:
// refreshMaterials
// internally re-evaluates the hover line (which reads picker signals), so it
// runs UNTRACKED — the untracked-discipline test guards that a hover change
// does not re-fire the theme effect.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { createPathLine } from '@/city/components/pathLine';
import { createCityState } from '@/city/state';
import { makeCityState } from '../../../_helpers/cityFixtures';
import { computePathLinewidthPixels } from '@/city/components/pathLine/renderer';
import { STREETS } from '@/state/stores/settings/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, Street } from '@/types';
import type { PickTarget } from '@/types/picker';
import type { Picker } from '@/city/interaction/picker';
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

function makeCtx(cityState: ReturnType<typeof createCityState>): {
  ctx: SceneContext;
  selection: ReturnType<typeof signal<PickTarget | null>>;
  hover: ReturnType<typeof signal<PickTarget | null>>;
} {
  const selection = signal<PickTarget | null>(null);
  const hover = signal<PickTarget | null>(null);
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  const ctx = {
    scene: new THREE.Scene(),
    canvas,
    picker: { selection, hover } as unknown as Picker,
    cityState,
  } as unknown as SceneContext;
  return { ctx, selection, hover };
}

const SRC_STREET = {
  x: 0,
  y: 0,
  width: 32,
  length: 600,
  label: 'src',
  orientation: StreetAxis.X,
  isRoot: true,
  dir: { name: 'src', path: 'src', type: NodeKind.Directory },
} as unknown as Street;

// A cityState seeded with SRC_STREET (isRoot, dir 'src') so its computeds
// resolve: rootStreet → a non-null gemWorldPos anchor, and streetsByDirMap →
// { src: SRC_STREET }. cityRevision drives the renderer's rebuild effect. We
// also spy gemWorldPos.peek() — the renderer peeks it once per line-update
// pass, so the count is the same observable the old getGemWorldPos() dep seam
// gave the untracked-discipline tests.
function makeSeeded(): {
  cityState: ReturnType<typeof createCityState>;
  counters: { gemPosCalls: number };
} {
  const cityState = makeCityState();
  cityState.layout.value = { streets: [SRC_STREET], buildings: [] } as unknown as CityLayout;
  cityState.structureRevision.value++;
  const counters = { gemPosCalls: 0 };
  const gemSig = cityState.gemWorldPos;
  const origPeek = gemSig.peek.bind(gemSig);
  (gemSig as { peek: () => THREE.Vector3 | null }).peek = () => {
    counters.gemPosCalls++;
    return origPeek();
  };
  return { cityState, counters };
}

function dirTarget(): PickTarget {
  return {
    kind: NodeKind.Directory,
    dir: { name: 'src', path: 'src', type: NodeKind.Directory },
    street: SRC_STREET,
  } as unknown as PickTarget;
}

const CAMERA = new THREE.PerspectiveCamera();
const FRAME = (camera: THREE.PerspectiveCamera = CAMERA) => ({ dt: 0, time: 0, camera });

function lines(comp: ReturnType<typeof createPathLine>): LineSegments2[] {
  return comp.group.children.filter((c): c is LineSegments2 => c instanceof LineSegments2);
}

describe('createPathLine() component door', () => {
  let comp: ReturnType<typeof createPathLine>;

  beforeEach(() => {
    STREETS.value = { ...DEFAULTS };
  });

  afterEach(() => {
    comp?.dispose();
  });

  it('constructs with an empty named group; nothing armed, nothing subscribed', () => {
    const { cityState, counters } = makeSeeded();
    const { ctx, selection } = makeCtx(cityState);
    comp = createPathLine(ctx);
    expect(comp.group.name).toBe('city-path-line');
    expect(comp.group.children).toHaveLength(0);
    // Not armed → the rebuild effect doesn't exist yet, so a cityRevision bump
    // recomputes nothing (getGemWorldPos is never called).
    cityState.cityRevision.value++;
    expect(counters.gemPosCalls).toBe(0);
    // A selection set before the first tick produces no line (not armed) —
    // and a STREETS Save is safe (theme effect no-ops over the null inner).
    selection.value = dirTarget();
    STREETS.value = { ...STREETS.value };
    expect(comp.group.children).toHaveLength(0);
  });

  it('first tick() arms the inner renderer: two line meshes + a live rebuild effect', () => {
    const { cityState, counters } = makeSeeded();
    const { ctx } = makeCtx(cityState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    expect(lines(comp)).toHaveLength(2);
    // The rebuild effect is live: a cityRevision bump recomputes the lines
    // (getGemWorldPos is called from _updatePathLine + _updateHoverPathLine).
    const before = counters.gemPosCalls;
    cityState.cityRevision.value++;
    expect(counters.gemPosCalls).toBeGreaterThan(before);
    // Second tick does not re-arm (still two lines).
    comp.tick(0, FRAME());
    expect(lines(comp)).toHaveLength(2);
  });

  it('a selection after arming shows the selection path line; clearing hides it', () => {
    const { cityState } = makeSeeded();
    const { ctx, selection } = makeCtx(cityState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    const [pathLine] = lines(comp);
    expect(pathLine.visible).toBe(false);

    selection.value = dirTarget();
    expect(pathLine.visible).toBe(true);
    expect((pathLine.material as unknown as { opacity: number }).opacity).toBeCloseTo(
      DEFAULTS.PATH_OPACITY,
      5
    );

    selection.value = null;
    expect(pathLine.visible).toBe(false);
  });

  it('theme effect pushes a fresh linewidth into both materials on STREETS Save', () => {
    const { cityState } = makeSeeded();
    const { ctx } = makeCtx(cityState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    STREETS.value = { ...STREETS.value, PATH_LINEWIDTH_PCT: 25 };
    const expected = computePathLinewidthPixels(25);
    for (const line of lines(comp)) {
      expect((line.material as unknown as { linewidth: number }).linewidth).toBeCloseTo(
        expected,
        5
      );
    }
  });

  it('untracked discipline: a hover change fires ONLY the hover effect, not the theme effect', () => {
    const { cityState, counters } = makeSeeded();
    const { ctx, hover } = makeCtx(cityState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());

    const before = counters.gemPosCalls;
    hover.value = dirTarget();
    // Exactly one _updateHoverPathLine pass (the hover effect). If the theme
    // effect had tracked picker.hover through refreshMaterials, it would
    // re-run too and the counter would advance by 2.
    expect(counters.gemPosCalls).toBe(before + 1);
  });

  it('dispose() stops the rebuild effect + all picker effects', () => {
    const { cityState, counters } = makeSeeded();
    const { ctx, selection } = makeCtx(cityState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());

    comp.dispose();
    expect(comp.group.children).toHaveLength(0);
    // After dispose the rebuild effect is dead: a cityRevision bump no longer
    // recomputes (getGemWorldPos is not called).
    const after = counters.gemPosCalls;
    cityState.cityRevision.value++;
    expect(counters.gemPosCalls).toBe(after);
    // And picker/theme writes over the disposed inner are inert.
    expect(() => {
      selection.value = dirTarget();
      STREETS.value = { ...STREETS.value, PATH_LINEWIDTH_PCT: 30 };
    }).not.toThrow();
  });
});
