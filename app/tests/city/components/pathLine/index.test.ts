// createCityScene builds the path line before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { createPathLine } from '@/city/components/pathLine';
import { createCitySceneState } from '@/city/state';
import { makeCityState, makePickableSceneContext } from '../../../_helpers/cityFixtures';
import { computePathLinewidthPixels } from '@/city/components/pathLine/renderer';
import { STREETS, STREET_TIERS } from '@/state/settings/fields/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, Street } from '@/types';
import type { PickTarget } from '@/types/picker';

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

// Seeded with SRC_STREET so the computeds resolve. gemWorldPos.peek() is spied
// because one peek per line-update pass is what the untracked tests observe.
function makeSeeded(): {
  sceneState: ReturnType<typeof createCitySceneState>;
  counters: { gemPosCalls: number };
} {
  const sceneState = makeCityState();
  sceneState.layout.value = { streets: [SRC_STREET], buildings: [] } as unknown as CityLayout;
  sceneState.structureRevision.value++;
  const counters = { gemPosCalls: 0 };
  const gemSig = sceneState.gemWorldPos;
  const origPeek = gemSig.peek.bind(gemSig);
  (gemSig as { peek: () => THREE.Vector3 | null }).peek = () => {
    counters.gemPosCalls++;
    return origPeek();
  };
  return { sceneState, counters };
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
    const { sceneState, counters } = makeSeeded();
    const { ctx, selection } = makePickableSceneContext(sceneState);
    comp = createPathLine(ctx);
    expect(comp.group.name).toBe('city-path-line');
    expect(comp.group.children).toHaveLength(0);
    // Not armed → the rebuild effect doesn't exist yet, so a cityRevision bump
    // recomputes nothing (getGemWorldPos is never called).
    sceneState.cityRevision.value++;
    expect(counters.gemPosCalls).toBe(0);
    // A selection set before the first tick produces no line (not armed) —
    // and a STREETS Save is safe (theme effect no-ops over the null inner).
    selection.value = dirTarget();
    STREETS.value = { ...STREETS.value };
    expect(comp.group.children).toHaveLength(0);
  });

  it('first tick() arms the inner renderer: two line meshes + a live rebuild effect', () => {
    const { sceneState, counters } = makeSeeded();
    const { ctx } = makePickableSceneContext(sceneState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    expect(lines(comp)).toHaveLength(2);
    // The rebuild effect is live: a cityRevision bump recomputes the lines
    // (getGemWorldPos is called from _updatePathLine + _updateHoverPathLine).
    const before = counters.gemPosCalls;
    sceneState.cityRevision.value++;
    expect(counters.gemPosCalls).toBeGreaterThan(before);
    // Second tick does not re-arm (still two lines).
    comp.tick(0, FRAME());
    expect(lines(comp)).toHaveLength(2);
  });

  it('a selection after arming shows the selection path line; clearing hides it', () => {
    const { sceneState } = makeSeeded();
    const { ctx, selection } = makePickableSceneContext(sceneState);
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
    const { sceneState } = makeSeeded();
    const { ctx } = makePickableSceneContext(sceneState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    STREETS.value = { ...STREETS.value, PATH_LINEWIDTH_PCT: 25 };
    const expected = computePathLinewidthPixels(25, STREET_TIERS.value);
    for (const line of lines(comp)) {
      expect((line.material as unknown as { linewidth: number }).linewidth).toBeCloseTo(
        expected,
        5
      );
    }
  });

  it('untracked discipline: a hover change fires ONLY the hover effect, not the theme effect', () => {
    const { sceneState, counters } = makeSeeded();
    const { ctx, hover } = makePickableSceneContext(sceneState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());

    const before = counters.gemPosCalls;
    hover.value = dirTarget();
    // One pass, from the hover effect. Had the theme effect tracked picker.hover
    // through refreshMaterials, this would advance by 2.
    expect(counters.gemPosCalls).toBe(before + 1);
  });

  it('dispose() stops the rebuild effect + all picker effects', () => {
    const { sceneState, counters } = makeSeeded();
    const { ctx, selection } = makePickableSceneContext(sceneState);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());

    comp.dispose();
    expect(comp.group.children).toHaveLength(0);
    // After dispose the rebuild effect is dead: a cityRevision bump no longer
    // recomputes (getGemWorldPos is not called).
    const after = counters.gemPosCalls;
    sceneState.cityRevision.value++;
    expect(counters.gemPosCalls).toBe(after);
    // And picker/theme writes over the disposed inner are inert.
    expect(() => {
      selection.value = dirTarget();
      STREETS.value = { ...STREETS.value, PATH_LINEWIDTH_PCT: 30 };
    }).not.toThrow();
  });
});

describe('computePathLinewidthPixels', () => {
  const _originalTiers = STREET_TIERS.value;
  afterEach(() => {
    STREET_TIERS.value = _originalTiers;
  });

  // The linewidth tracks the NARROWEST street, not the first tier, so a tier
  // list whose smallest width is not first still reads correctly.
  it.each([
    ['smallest tier is not first', [10, 4, 6], 25, 1.0],
    ['default percentage', [10, 4], 10, 0.4],
    ['no tiers at all falls back to pct/100', [], 50, 0.5],
  ])('%s', (_label, widths, pct, expected) => {
    STREET_TIERS.value = {
      TIERS: widths.map((width, i) => ({ min_descendants: i * 4, width })),
    };
    expect(computePathLinewidthPixels(pct, STREET_TIERS.value)).toBeCloseTo(expected);
  });

  it('uses the shipped tiers when nothing overrides them', () => {
    // Default widths are 32, 48, 80, 96, 128, so the narrowest is 32.
    expect(computePathLinewidthPixels(10, STREET_TIERS.value)).toBeCloseTo(3.2);
  });
});
