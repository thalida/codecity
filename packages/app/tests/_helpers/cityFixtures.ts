// Shared fixtures for city scene tests: scene contexts, bboxes, layouts, tree
// nodes, and the trees/buildings config resets.

import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { SceneContext } from '@/city/types';
import type { Picker } from '@/city/interaction/picker';
import type { TreesConfig } from '@/city/settings/fields/trees';
import type { BuildingDimensionsConfig } from '@/city/settings/fields/buildings';
import type { SettingSignals } from '@/city/settings/store';
import { createCityState, type CityState } from '@/city/state';
import { settingSignals } from './citySettings';
import { commits } from './commits';
import { createTestCityResources } from '../_helpers/cityResources';
import { CommitEntry, NodeKind } from '@/city/types/manifest';
import { CityBbox, CityLayout } from '@/city/types/scene';
import { PickTarget } from '@/city/types/picker';

// A no-op layout client, for tests that never call applyManifest and so never
// spawn the worker. Keeps the real contract.
const STUB_LAYOUT_CLIENT = {
  compute: () => Promise.resolve(null),
  dispose: () => {},
};

/** A placement client that places no trees. The build calls it, so every
 *  cityState needs one, but only the placement tests care what it returns. */
export function stubPlacementClient(placements: unknown[] = []) {
  return { compute: () => Promise.resolve(placements), dispose: () => {} };
}

/** cityState with no-op build workers, for tests that don't drive applyManifest. */
export function makeCityState(settings: SettingSignals = settingSignals()): CityState {
  return createCityState(
    STUB_LAYOUT_CLIENT as never,
    stubPlacementClient() as never,
    createTestCityResources(settings),
    settings
  );
}

/** A canvas whose clientWidth/clientHeight track a mutable `size`, so a test can
 *  resize it and call onResize(). jsdom reports 0 for both otherwise. */
function makeSizedCanvas(): { canvas: HTMLCanvasElement; size: { w: number; h: number } } {
  const size = { w: 800, h: 600 };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { get: () => size.w, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { get: () => size.h, configurable: true });
  return { canvas, size };
}

/** SceneContext for components that never touch the picker; camera/renderer are
 *  null (jsdom can't build a WebGL renderer, and nothing under test reads them).
 *
 *  Pass `settings` to both this and makeCityState when a test tunes one: the
 *  state pipeline and the components read their own, exactly as two cities on
 *  one page do. */
export function makeSceneContext(
  cityState?: CityState,
  settings: SettingSignals = settingSignals()
): SceneContext {
  return {
    scene: new THREE.Scene(),
    canvas: makeSizedCanvas().canvas,
    picker: null as unknown as Picker,
    camera: null as unknown as THREE.PerspectiveCamera,
    renderer: null as unknown as THREE.WebGLRenderer,
    cityState: cityState ?? makeCityState(settings),
    resources: createTestCityResources(settings),
    settings,
  } as unknown as SceneContext;
}

/** SceneContext whose picker carries real signals, returned alongside them so a
 *  test can drive hover/selection and assert what the component does. */
export function makePickableSceneContext(
  cityState?: CityState,
  settings: SettingSignals = settingSignals()
): {
  ctx: SceneContext;
  selection: ReturnType<typeof signal<PickTarget | null>>;
  hover: ReturnType<typeof signal<PickTarget | null>>;
  size: { w: number; h: number };
} {
  const selection = signal<PickTarget | null>(null);
  const hover = signal<PickTarget | null>(null);
  const { canvas, size } = makeSizedCanvas();
  const ctx = {
    scene: new THREE.Scene(),
    canvas,
    picker: { selection, hover } as unknown as Picker,
    cityState: cityState ?? makeCityState(settings),
    resources: createTestCityResources(settings),
    settings,
  } as unknown as SceneContext;
  return { ctx, selection, hover, size };
}

/** Builds a CityBbox from extents, deriving cx/cy/width/depth. */
export function bbox(minX: number, minY: number, maxX: number, maxY: number): CityBbox {
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

/** Minimal CityLayout with empty arrays and zeroed stats, wrapping the given bbox. */
export function emptyLayout(bb: CityBbox): CityLayout {
  return {
    buildings: [],
    streets: [],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: bb,
  };
}

/** A FileNode-shaped fixture, typed loose because it omits the fields no code
 *  under test reads. */
export function mkFile(name: string): any {
  return {
    name,
    type: NodeKind.File,
    path: name,
    extension: '.ts',
    size: 500,
    lines: 20,
    created: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T00:00:00Z',
  };
}

/** A DirNode-shaped fixture that prefixes its children's paths, like a real
 *  manifest: without it, a test filtering by path prefix finds nothing. */
export function mkDir(name: string, children: any[]): any {
  const prefixed = children.map((c) => ({ ...c, path: `${name}/${c.path || c.name}` }));
  return {
    name,
    type: NodeKind.Directory,
    path: name,
    children_count: prefixed.length,
    descendants_count:
      prefixed.length + prefixed.filter((c) => c.type === NodeKind.Directory).length,
    descendants_size: 1000,
    children: prefixed,
  };
}

/** Deterministic TREES values for a test that cares about placement geometry:
 *  round clearances and no falloff, so a change in the shipped defaults cannot
 *  move a placement out from under an assertion. */
export const TEST_TREES: TreesConfig = {
  ENABLED: true,
  CITY_CLEARANCE_PERCENT: 1,
  CITY_CLEARANCE_LIMITS: [0, 2000],
  DENSITY_FALLOFF: 0,
  EDGE_INSET_PERCENT: 1,
  EDGE_INSET_LIMITS: [0, 2000],
  MIN_HEIGHT: 48,
  MAX_HEIGHT: 144,
  MIN_WIDTH: 32,
  MAX_WIDTH: 128,
  TRUNK_HEIGHT_FRAC: 0.25,
  TRUNK_RADIUS_FRAC: 0.15,
  CANOPY_TRUNK_OVERLAP_FRAC: 0.7,
  COLOR_BUSY_DAY: '#0a2613',
  COLOR_SOLO_DAY: '#a8d68a',
  SHADING_STRENGTH: 0.35,
  TRUNK_COLOR: '#4a3220',
  WIDTH_AGE_FLOOR: 1.0,
  HALF_LIFE_DAYS: 180,
  OUTLINE_WIDTH: 1,
  OUTLINE_HOVER_COLOR: '#ffffff',
  OUTLINE_HOVER_OPACITY: 0.5,
  OUTLINE_SELECTED_OPACITY: 0.75,
};

/** Deterministic BUILDING_DIMENSIONS, for the same reason. */
export const TEST_BUILDING_DIMENSIONS: BuildingDimensionsConfig = {
  MIN_FLOORS: 2,
  MAX_FLOORS: 96,
  FULL_HEIGHT_LINES: 2000,
  FLOOR_HEIGHT: 16,
  EMPTY_SLAB_FLOORS: 0.05,
  MIN_WIDTH: 8,
  MAX_WIDTH: 8,
  FULL_WIDTH_KB: 64,
  DISTANCE_FROM_ROAD: 8,
  DATA_HEIGHT_RATIO: 0.7,
};

/** A TreePlacement at (x, y) for the given commit. Seed defaults to 0 so
 *  placements are deterministic unless a test varies it deliberately. */
export function treePlacement(
  commitIndex: number,
  x = 0,
  y = 0,
  seed = 0
): import('@/city/components/trees/treePlacement').TreePlacement {
  return { x, y, seed, commitIndex };
}

/** A Commit PickTarget for the given sha, as the picker hands one to a
 *  component. The mesh is a throwaway: only `kind` and `commit` are read. */
export function commitTarget(sha: string, overrides: Partial<CommitEntry> = {}): PickTarget {
  return {
    kind: NodeKind.Commit,
    mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
    instanceId: 0,
    commit: commits({ date: '2026-01-01', files: 1, authors: ['Alice'], ...overrides, sha })[0],
  };
}
