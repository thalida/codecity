// createCity builds the path line before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { createPathLine } from '@/city/components/pathLine';
import { createCityState } from '@/city/state';
import {
  seedCityState,
  republishCity,
  makePickableSceneContext,
} from '../../../_helpers/cityFixtures';
import { computePathLinewidthPixels } from '@/city/components/pathLine/renderer';
import { citySettings, settingsStore } from '../../../_helpers/citySettings';
import type { PickTarget } from '@/city/types/picker';
import { NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';

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

// Seeded with SRC_STREET so the derived values resolve. The gem position read
// is counted: one per line-update pass is what the "no extra work" tests want.
async function makeSeeded(): Promise<{
  cityState: ReturnType<typeof createCityState>;
  counters: { gemPosCalls: number };
}> {
  const cityState = await seedCityState({
    streets: [SRC_STREET],
    buildings: [],
  } as unknown as CityLayout);
  // One read per line-update pass is what the "no extra work" tests observe.
  const counters = { gemPosCalls: 0 };
  const gemPos = cityState.gemWorldPos;
  Object.defineProperty(cityState, 'gemWorldPos', {
    configurable: true,
    get: () => {
      counters.gemPosCalls++;
      return gemPos;
    },
  });
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
  // A fresh store per case: each starts at stock values, so nothing has to be
  // restored afterwards.
  let store: ReturnType<typeof settingsStore>;

  beforeEach(() => {
    store = settingsStore();
  });

  afterEach(() => {
    comp?.dispose();
  });

  it('constructs with an empty named group; nothing armed, nothing subscribed', async () => {
    const { cityState, counters } = await makeSeeded();
    const { ctx, picker } = makePickableSceneContext(cityState, store);
    comp = createPathLine(ctx);
    expect(comp.group.name).toBe('city-path-line');
    expect(comp.group.children).toHaveLength(0);
    // Not armed → the rebuild effect doesn't exist yet, so a cityRevision bump
    // recomputes nothing (getGemWorldPos is never called).
    await republishCity(cityState);
    expect(counters.gemPosCalls).toBe(0);
    // A selection set before the first tick produces no line (not armed) —
    // and a STREETS Save is safe (theme effect no-ops over the null inner).
    picker.setSelection(dirTarget());
    store.update({ STREETS: { PATH_LINEWIDTH_PCT: 30 } });
    expect(comp.group.children).toHaveLength(0);
  });

  it('first tick() arms the inner renderer: two line meshes + a live rebuild effect', async () => {
    const { cityState, counters } = await makeSeeded();
    const { ctx } = makePickableSceneContext(cityState, store);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    expect(lines(comp)).toHaveLength(2);
    // The rebuild effect is live: a cityRevision bump recomputes the lines
    // (getGemWorldPos is called from _updatePathLine + _updateHoverPathLine).
    const before = counters.gemPosCalls;
    await republishCity(cityState);
    expect(counters.gemPosCalls).toBeGreaterThan(before);
    // Second tick does not re-arm (still two lines).
    comp.tick(0, FRAME());
    expect(lines(comp)).toHaveLength(2);
  });

  it('a selection after arming shows the selection path line; clearing hides it', async () => {
    const { cityState } = await makeSeeded();
    const { ctx, picker } = makePickableSceneContext(cityState, store);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    const [pathLine] = lines(comp);
    expect(pathLine.visible).toBe(false);

    picker.setSelection(dirTarget());
    expect(pathLine.visible).toBe(true);
    expect((pathLine.material as unknown as { opacity: number }).opacity).toBeCloseTo(
      DEFAULTS.PATH_OPACITY,
      5
    );

    picker.setSelection(null);
    expect(pathLine.visible).toBe(false);
  });

  it('theme effect pushes a fresh linewidth into both materials on STREETS Save', async () => {
    const { cityState } = await makeSeeded();
    const { ctx } = makePickableSceneContext(cityState, store);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());
    store.update({ STREETS: { PATH_LINEWIDTH_PCT: 25 } });
    const expected = computePathLinewidthPixels(25, store.STREET_TIERS.TIERS);
    for (const line of lines(comp)) {
      expect((line.material as unknown as { linewidth: number }).linewidth).toBeCloseTo(
        expected,
        5
      );
    }
  });

  it('untracked discipline: a hover change fires ONLY the hover effect, not the theme effect', async () => {
    const { cityState, counters } = await makeSeeded();
    const { ctx, picker } = makePickableSceneContext(cityState, store);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());

    const before = counters.gemPosCalls;
    picker.setHover(dirTarget());
    // One pass, from the hover effect. Had the theme effect tracked picker.hover
    // through refreshMaterials, this would advance by 2.
    expect(counters.gemPosCalls).toBe(before + 1);
  });

  it('dispose() stops the rebuild effect + all picker effects', async () => {
    const { cityState, counters } = await makeSeeded();
    const { ctx, picker } = makePickableSceneContext(cityState, store);
    comp = createPathLine(ctx);
    comp.tick(0, FRAME());

    comp.dispose();
    expect(comp.group.children).toHaveLength(0);
    // After dispose the rebuild effect is dead: a cityRevision bump no longer
    // recomputes (getGemWorldPos is not called).
    const after = counters.gemPosCalls;
    await republishCity(cityState);
    expect(counters.gemPosCalls).toBe(after);
    // And picker/theme writes over the disposed inner are inert.
    expect(() => {
      picker.setSelection(dirTarget());
      store.update({ STREETS: { PATH_LINEWIDTH_PCT: 30 } });
    }).not.toThrow();
  });
});

describe('computePathLinewidthPixels', () => {
  // The linewidth tracks the NARROWEST street, not the first tier, so a tier
  // list whose smallest width is not first still reads correctly.
  it.each([
    ['smallest tier is not first', [10, 4, 6], 25, 1.0],
    ['default percentage', [10, 4], 10, 0.4],
    ['no tiers at all falls back to pct/100', [], 50, 0.5],
  ])('%s', async (_label, widths, pct, expected) => {
    const tiers = widths.map((width, i) => ({ min_descendants: i * 4, width }));
    expect(computePathLinewidthPixels(pct, tiers)).toBeCloseTo(expected);
  });

  it('uses the shipped tiers when nothing overrides them', async () => {
    // Default widths are 32, 48, 80, 96, 128, so the narrowest is 32.
    expect(computePathLinewidthPixels(10, citySettings().STREET_TIERS.TIERS)).toBeCloseTo(3.2);
  });
});
