// cityScene.test.js — applyManifest builds meshes + lookup maps; a
// second applyManifest fires onChange with the right entering / exiting
// / staying buckets; disposeMesh is idempotent.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCityScene } from '@/scene/cityScene.js';
import { BUILDING_DIMENSIONS, STREET_TIERS } from '@/config/index.js';
import type { BuildingDimensionsConfig } from '@/config/building.js';
import type { StreetTier } from '@/config/street.js';
import { NodeKind } from '@/types';
import type { FileNode, Manifest } from '@/types';

interface ManifestFileSpec {
  path: string;
  size: number;
  lines: number;
  ext?: string;
}

// Smallest manifest that exercises buildings + streets + a child dir.
function makeManifest(name: string, files: ManifestFileSpec[]): Manifest {
  // files: [{ path, size, lines, ext }, …]
  const children: FileNode[] = files.map((f) => ({
    name: f.path.split('/').pop() || f.path,
    type: NodeKind.File,
    path: f.path,
    fullPath: `/${f.path}`,
    extension: f.ext || '.js',
    size: f.size,
    lines: f.lines,
    binary: false,
    created: '2024-01-10T09:00:00Z',
    modified: '2024-03-22T14:30:00Z',
    git: null,
  }));
  return {
    root: `/tmp/${name}`,
    scanned_at: '2026-05-04T00:00:00Z',
    signature: `${name}:${files.map((f) => f.path).join(',')}`,
    tree_signature: `test-fp-${name}-${files.map((f) => f.path).join(',')}`,
    repo: null,
    tree: {
      name,
      type: NodeKind.Directory,
      path: '.',
      fullPath: `/tmp/${name}`,
      children,
      children_count: children.length,
      children_file_count: children.length,
      children_dir_count: 0,
      descendants_count: children.length,
      descendants_file_count: children.length,
      descendants_dir_count: 0,
      descendants_size: files.reduce((s, f) => s + f.size, 0),
    },
  };
}

// Minimal building-dimension config so layoutCity has knobs to read
// without needing the full app boot.
const TEST_DIMS: Partial<BuildingDimensionsConfig> = {
  MIN_FLOORS: 1,
  MAX_FLOORS: 5,
  FLOOR_HEIGHT: 10,
  MIN_WIDTH: 4,
  MAX_WIDTH: 12,
};
const TEST_TIERS: StreetTier[] = [{ min_descendants: 0, width: 10 }];

// Stub 2D canvas context — jsdom returns null from getContext('2d') and
// engine.js uses it for label texture generation. Just enough surface
// for createStreetLabels to run without throwing; we don't assert on
// pixel output.
function _stubCanvasContext() {
  // Genuinely monkey-patching the prototype — `as any` is intentional so
  // we can stamp our own sentinel + replace getContext.
  const proto = HTMLCanvasElement.prototype as unknown as {
    __codecityStubbed?: boolean;
    getContext: HTMLCanvasElement['getContext'];
  };
  if (proto.__codecityStubbed) return;
  proto.__codecityStubbed = true;
  const orig = proto.getContext;
  proto.getContext = function (type: string) {
    if (type === '2d') {
      const noop = () => {};
      const getImageData = () => ({ data: new Uint8ClampedArray(4) });
      return new Proxy(
        {
          font: '',
          fillStyle: '',
          strokeStyle: '',
          textAlign: '',
          textBaseline: '',
          lineWidth: 0,
          globalAlpha: 1,
          globalCompositeOperation: 'source-over',
          canvas: { width: 256, height: 64 },
          measureText: (text: string) => ({
            width: text.length * 6,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          }),
          getImageData,
          createImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData: noop,
        } as Record<string, unknown>,
        {
          // Any method we haven't defined falls through as a noop. Saves
          // listing every Canvas2D rendering call (strokeRect, fillRect,
          // beginPath, drawImage, etc.) one by one.
          get(target, prop: string) {
            if (prop in target) return target[prop];
            return noop;
          },
          set(target, prop: string, value) {
            target[prop] = value;
            return true;
          },
        }
      );
    }
    return orig ? orig.call(this, type) : null;
  } as HTMLCanvasElement['getContext'];
}

let _origDims: BuildingDimensionsConfig | null = null;
let _origTiers: StreetTier[] | null = null;
let canvas: HTMLCanvasElement;

beforeEach(() => {
  _stubCanvasContext();
  _origDims = { ...BUILDING_DIMENSIONS.get() };
  _origTiers = STREET_TIERS.get();
  (Object.keys(TEST_DIMS) as Array<keyof BuildingDimensionsConfig>).forEach((k) => {
    BUILDING_DIMENSIONS.setKey(k, TEST_DIMS[k]!);
  });
  STREET_TIERS.set(TEST_TIERS); // STREET_TIERS is an atom(), not a map()
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
});
afterEach(() => {
  if (_origDims) {
    const dims = _origDims;
    (Object.keys(dims) as Array<keyof BuildingDimensionsConfig>).forEach((k) => {
      BUILDING_DIMENSIONS.setKey(k, dims[k]);
    });
  }
  if (_origTiers) STREET_TIERS.set(_origTiers);
});

describe('createCityScene', () => {
  it('exposes the documented public API', () => {
    const cs = createCityScene(canvas);
    expect(cs.scene).toBeDefined();
    expect(typeof cs.applyManifest).toBe('function');
    expect(typeof cs.onChange).toBe('function');
    expect(typeof cs.onBeforeChange).toBe('function');
    expect(typeof cs.disposeMesh).toBe('function');
    expect(typeof cs.dispose).toBe('function');
    // Accessors before any applyManifest should not throw.
    expect(cs.getManifest()).toBeNull();
    expect(cs.getBuildings()).toEqual([]);
    expect(cs.getStreetPickables()).toEqual([]);
    cs.dispose();
  });

  it('applyManifest builds meshes and exposes them through accessors', async () => {
    const cs = createCityScene(canvas);
    const m = makeManifest('one', [
      { path: 'a.js', size: 100, lines: 5 },
      { path: 'b.js', size: 200, lines: 10 },
    ]);
    await cs.applyManifest(m);

    expect(cs.getManifest()).toBe(m);
    expect(cs.getRoot().name).toBe('one');
    // TODO(Task 8/9): getBuildings() now returns an empty stub array.
    // Per-building mesh count check replaced by block count check below.
    // expect(cs.getBuildings().length).toBe(2);
    expect(cs.getBlocks().length).toBeGreaterThanOrEqual(1);
    expect(cs.getStreetPickables().length).toBeGreaterThanOrEqual(1);
    // Lookup map populated for both files.
    expect(cs.getBuildingByPath('a.js')).not.toBeNull();
    expect(cs.getBuildingByPath('b.js')).not.toBeNull();
    expect(cs.getBuildingByPath('does-not-exist.js')).toBeNull();
    // bbox is non-empty.
    expect(cs.getBbox()).toBeDefined();
    expect(cs.getBbox().isEmpty()).toBe(false);
    cs.dispose();
  });

  it('a second applyManifest fires onChange with entering/exiting/staying (InstancedMesh diff)', async () => {
    const cs = createCityScene(canvas);
    const m1 = makeManifest('two', [
      { path: 'a.js', size: 100, lines: 5 },
      { path: 'b.js', size: 200, lines: 10 },
    ]);
    await cs.applyManifest(m1);

    let capturedDiff: Parameters<Parameters<typeof cs.onChange>[0]>[0] | null = null;
    cs.onChange((diff) => {
      capturedDiff = diff;
    });

    const m2 = makeManifest('two', [
      { path: 'a.js', size: 100, lines: 5 }, // staying (same path)
      { path: 'c.js', size: 300, lines: 15 }, // entering (new path)
    ]);
    await cs.applyManifest(m2);

    expect(capturedDiff).not.toBeNull();
    const diff = capturedDiff!;

    // Staying: a.js was present in m1 and m2.
    const stayingPaths = diff.staying.buildings.map((e) => {
      const b = cs.getBuildingByInstance(e.block, e.instanceId);
      return b?.file?.path ?? null;
    });
    expect(stayingPaths.sort()).toEqual(['a.js']);

    // Entering: c.js is new in m2.
    const enteringPaths = diff.entering.buildings.map((e) => {
      const b = cs.getBuildingByInstance(e.block, e.instanceId);
      return b?.file?.path ?? null;
    });
    expect(enteringPaths.sort()).toEqual(['c.js']);

    // Exiting: b.js was in m1 but not m2.
    // V1 exit entries carry no path — just verify the count is correct.
    expect(diff.exiting.buildings.length).toBe(1);

    // Staying entries carry the new transform (positive scale) and old transform.
    for (const s of diff.staying.buildings) {
      expect(s.newScaleY).toBeGreaterThan(0);
      expect(s.newScaleX).toBeGreaterThan(0);
      expect(s.newScaleZ).toBeGreaterThan(0);
    }

    // Entering entries carry the new transform but no old transform.
    for (const e of diff.entering.buildings) {
      expect(e.newScaleY).toBeGreaterThan(0);
      // EnteringBuilding has no old* fields — verify block + instanceId are valid.
      expect(e.block).toBeDefined();
      expect(e.instanceId).toBeGreaterThanOrEqual(0);
    }

    cs.dispose();
  });

  // TODO(Task 12): rewrite for InstancedMesh.
  // getBuildings() now returns an empty stub array (per-building meshes no
  // longer exist after Task 8). disposeMesh per-block semantics are still
  // in transition while outline/ghost meshes (Tasks 12/13) are pending.
  //
  // it('disposeMesh is idempotent', () => {
  //   const cs = createCityScene(canvas);
  //   cs.applyManifest(makeManifest('one', [{ path: 'a.js', size: 100, lines: 5 }]));
  //   const mesh = cs.getBuildings()[0];
  //   expect(mesh).toBeDefined();
  //
  //   cs.disposeMesh(mesh);
  //   expect(mesh.userData.disposed).toBe(true);
  //
  //   // Second call must no-op (no throw, flag stays).
  //   cs.disposeMesh(mesh);
  //   expect(mesh.userData.disposed).toBe(true);
  //   cs.dispose();
  // });

  it('onBeforeChange fires before the new build', async () => {
    const cs = createCityScene(canvas);
    await cs.applyManifest(makeManifest('a', [{ path: 'x.js', size: 50, lines: 3 }]));

    let beforeRootName = null;
    cs.onBeforeChange((prev) => {
      // `prev` is the snapshot from before disposal.
      beforeRootName = prev.manifest && prev.manifest.tree.name;
    });

    await cs.applyManifest(makeManifest('b', [{ path: 'y.js', size: 50, lines: 3 }]));
    expect(beforeRootName).toBe('a');
    cs.dispose();
  });
});
