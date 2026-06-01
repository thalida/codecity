// buildingFader.test.ts — verifies the 5-tier depth-based cascade.
// Default tier covers selected, hovered, and idle buildings; the four
// numbered levels cover same-dir (L1), one-deeper (L2), deeper (L3),
// and outside-subtree (L4).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';
import { createBuildingFader } from '@/scene/effects/buildingFader';
import { BUILDING_FADE } from '@/state/stores/settings/index';
import { FadeDetail, NodeKind } from '@/types';
import type { Building, DirNode, FileNode, PickTarget, Street } from '@/types';

const _originalFade = BUILDING_FADE.value;

afterEach(() => {
  BUILDING_FADE.value = _originalFade;
});

function makeFile(path: string): FileNode {
  return {
    name: path.split('/').pop()!,
    type: NodeKind.File,
    path,
    fullPath: `/repo/${path}`,
    extension: '.ts',
    size: 1,
    lines: 1,
    binary: false,
    created: null,
    modified: null,
    git: null,
  } as unknown as FileNode;
}

function makeDir(path: string): DirNode {
  return {
    name: path === '.' ? 'root' : path.split('/').pop()!,
    type: NodeKind.Directory,
    path,
    fullPath: `/repo/${path}`,
    children: [],
    children_file_count: 0,
    children_dir_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
  } as unknown as DirNode;
}

function makeBuilding(file: FileNode): Building {
  return {
    x: 0,
    y: 0,
    w: 10,
    d: 10,
    h: 20,
    file,
  } as unknown as Building;
}

interface FadeReading {
  opacity: number;
  silhouette: number;
  outlineOpacity: number;
}

function makeFader(opts: {
  buildings: Building[];
  selection?: PickTarget | null;
  hover?: PickTarget | null;
  streetByDir?: Map<string, { dir: DirNode } & Partial<Street>>;
}) {
  const iFadeAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(opts.buildings.length * 3),
    3
  );
  const detailMesh = {
    geometry: { getAttribute: (_: string) => iFadeAttr },
  } as unknown as THREE.InstancedMesh;

  const cell = { detailMesh, buildings: opts.buildings };
  const cells = new Map([[0, cell]]);

  const streetByDir = opts.streetByDir ?? new Map();

  const world = {
    getCells: () => cells,
    getStreetByDir: (path: string) => streetByDir.get(path) ?? null,
    getAdPanels: () => null,
    onChange: () => () => {},
  } as unknown as Parameters<typeof createBuildingFader>[0]['world'];

  const picker = {
    selection: signal<PickTarget | null>(opts.selection ?? null),
    hover: signal<PickTarget | null>(opts.hover ?? null),
  } as unknown as Parameters<typeof createBuildingFader>[0]['picker'];

  const fader = createBuildingFader({ world, picker });

  function readFor(path: string): FadeReading | null {
    const slot = opts.buildings.findIndex((b) => b.file?.path === path);
    if (slot < 0) return null;
    const i = slot * 3;
    return {
      opacity: iFadeAttr.array[i] as number,
      silhouette: iFadeAttr.array[i + 1] as number,
      outlineOpacity: iFadeAttr.array[i + 2] as number,
    };
  }

  return { fader, readFor };
}

/** Set distinctive opacity values per tier so each assertion pins down
 *  exactly one tier without ambiguity. Detail mode is the same so
 *  silhouette isn't a confounder; outline disabled across the board. */
function setKnownFade() {
  BUILDING_FADE.value = {
    ..._originalFade,
    DEFAULT_DETAIL: FadeDetail.Full,
    DEFAULT_BODY_OPACITY: 1.0,
    DEFAULT_OUTLINE: false,
    DEFAULT_OUTLINE_OPACITY: 0.0,
    LEVEL1_DETAIL: FadeDetail.Full,
    LEVEL1_BODY_OPACITY: 0.8,
    LEVEL1_OUTLINE: false,
    LEVEL1_OUTLINE_OPACITY: 0.0,
    LEVEL2_DETAIL: FadeDetail.Full,
    LEVEL2_BODY_OPACITY: 0.6,
    LEVEL2_OUTLINE: false,
    LEVEL2_OUTLINE_OPACITY: 0.0,
    LEVEL3_DETAIL: FadeDetail.Full,
    LEVEL3_BODY_OPACITY: 0.4,
    LEVEL3_OUTLINE: false,
    LEVEL3_OUTLINE_OPACITY: 0.0,
    LEVEL4_DETAIL: FadeDetail.Full,
    LEVEL4_BODY_OPACITY: 0.2,
    LEVEL4_OUTLINE: false,
    LEVEL4_OUTLINE_OPACITY: 0.0,
  };
}

describe('buildingFader 5-tier cascade', () => {
  beforeEach(setKnownFade);

  it('no target → every building gets DEFAULT (1.0 opacity)', () => {
    const a = makeFile('src/a.ts');
    const b = makeFile('src/b.ts');
    const { readFor } = makeFader({
      buildings: [makeBuilding(a), makeBuilding(b)],
      selection: null,
      hover: null,
    });
    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(1.0);
    expect(readFor('src/b.ts')!.opacity).toBeCloseTo(1.0);
  });

  it('selected file → symmetric LCA distance: same dir L1, 1 hop L2, 2 hops L3, 3+ hops L4', () => {
    // dirTarget = src/foo. Distances from src/foo:
    //   src/foo/a.ts   = 0 (self, but rendered as Default)
    //   src/foo/b.ts   = 0 → L1
    //   src/foo/bar/c.ts = 1 down → L2
    //   src/foo/bar/baz/d.ts = 2 down → L3
    //   src/lib/e.ts   = 1 up + 1 down → L3
    //   README.md      = 2 up → L3
    //   far/deep/x.ts  = 2 up + 2 down = 4 → L4
    const a = makeFile('src/foo/a.ts');
    const b = makeFile('src/foo/b.ts');
    const c = makeFile('src/foo/bar/c.ts');
    const d = makeFile('src/foo/bar/baz/d.ts');
    const e = makeFile('src/lib/e.ts');
    const r = makeFile('README.md');
    const far = makeFile('other/deep/x.ts');
    const selBuilding = makeBuilding(a);
    const streetByDir = new Map([['src/foo', { dir: makeDir('src/foo') }]]);

    const { readFor } = makeFader({
      buildings: [
        selBuilding,
        makeBuilding(b),
        makeBuilding(c),
        makeBuilding(d),
        makeBuilding(e),
        makeBuilding(r),
        makeBuilding(far),
      ],
      selection: {
        kind: NodeKind.File,
        mesh: new THREE.Object3D() as unknown as THREE.Mesh,
        data: selBuilding,
        file: a,
      } as unknown as PickTarget,
      streetByDir,
    });

    expect(readFor('src/foo/a.ts')!.opacity).toBeCloseTo(1.0);
    expect(readFor('src/foo/b.ts')!.opacity).toBeCloseTo(0.8);
    expect(readFor('src/foo/bar/c.ts')!.opacity).toBeCloseTo(0.6);
    expect(readFor('src/foo/bar/baz/d.ts')!.opacity).toBeCloseTo(0.4);
    expect(readFor('src/lib/e.ts')!.opacity).toBeCloseTo(0.4);
    expect(readFor('README.md')!.opacity).toBeCloseTo(0.4);
    expect(readFor('other/deep/x.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('selected dir → symmetric distance: direct files L1, 1 hop L2, 2 hops L3', () => {
    // dirTarget = src/foo. Same distance math as the file-selection case.
    const a = makeFile('src/foo/a.ts');
    const b = makeFile('src/foo/b.ts');
    const c = makeFile('src/foo/bar/c.ts');
    const d = makeFile('src/foo/bar/baz/d.ts');
    const e = makeFile('src/lib/e.ts');
    const r = makeFile('README.md');
    const far = makeFile('other/deep/x.ts');
    const dir = makeDir('src/foo');

    const { readFor } = makeFader({
      buildings: [
        makeBuilding(a),
        makeBuilding(b),
        makeBuilding(c),
        makeBuilding(d),
        makeBuilding(e),
        makeBuilding(r),
        makeBuilding(far),
      ],
      selection: {
        kind: NodeKind.Directory,
        sidewalk: new THREE.Object3D() as unknown as THREE.Mesh,
        street: { dir } as Street,
        dir,
      } as unknown as PickTarget,
    });

    expect(readFor('src/foo/a.ts')!.opacity).toBeCloseTo(0.8);
    expect(readFor('src/foo/b.ts')!.opacity).toBeCloseTo(0.8);
    expect(readFor('src/foo/bar/c.ts')!.opacity).toBeCloseTo(0.6);
    expect(readFor('src/foo/bar/baz/d.ts')!.opacity).toBeCloseTo(0.4);
    expect(readFor('src/lib/e.ts')!.opacity).toBeCloseTo(0.4);
    expect(readFor('README.md')!.opacity).toBeCloseTo(0.4);
    expect(readFor('other/deep/x.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('hovered file → hover-self DEFAULT, sibling L1, 1 hop L2, 2 hops L3, 3+ hops L4', () => {
    const a = makeFile('src/foo/a.ts');
    const b = makeFile('src/foo/b.ts');
    const c = makeFile('src/foo/bar/c.ts');
    const e = makeFile('src/lib/e.ts');
    const far = makeFile('other/deep/x.ts');
    const hovBuilding = makeBuilding(a);
    const streetByDir = new Map([['src/foo', { dir: makeDir('src/foo') }]]);

    const { readFor } = makeFader({
      buildings: [
        hovBuilding,
        makeBuilding(b),
        makeBuilding(c),
        makeBuilding(e),
        makeBuilding(far),
      ],
      hover: {
        kind: NodeKind.File,
        mesh: new THREE.Object3D() as unknown as THREE.Mesh,
        data: hovBuilding,
        file: a,
      } as unknown as PickTarget,
      streetByDir,
    });

    expect(readFor('src/foo/a.ts')!.opacity).toBeCloseTo(1.0);
    expect(readFor('src/foo/b.ts')!.opacity).toBeCloseTo(0.8);
    expect(readFor('src/foo/bar/c.ts')!.opacity).toBeCloseTo(0.6);
    expect(readFor('src/lib/e.ts')!.opacity).toBeCloseTo(0.4);
    expect(readFor('other/deep/x.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('root selection → distance is depth from root', () => {
    // dirTarget = root. dp=[], so distance equals depth of each file's parent.
    //   README.md (parent='.')         distance 0 → L1
    //   src/x.ts (parent='src')        distance 1 → L2
    //   src/foo/y.ts                   distance 2 → L3
    //   src/foo/bar/z.ts               distance 3 → L4
    const r = makeFile('README.md');
    const x = makeFile('src/x.ts');
    const y = makeFile('src/foo/y.ts');
    const z = makeFile('src/foo/bar/z.ts');
    const rootDir = makeDir('.');

    const { readFor } = makeFader({
      buildings: [makeBuilding(r), makeBuilding(x), makeBuilding(y), makeBuilding(z)],
      selection: {
        kind: NodeKind.Directory,
        sidewalk: new THREE.Object3D() as unknown as THREE.Mesh,
        street: { dir: rootDir } as Street,
        dir: rootDir,
      } as unknown as PickTarget,
    });

    expect(readFor('README.md')!.opacity).toBeCloseTo(0.8);
    expect(readFor('src/x.ts')!.opacity).toBeCloseTo(0.6);
    expect(readFor('src/foo/y.ts')!.opacity).toBeCloseTo(0.4);
    expect(readFor('src/foo/bar/z.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('prefix-precision: "src-utils" is NOT confused with a child of "src"', () => {
    // dirTarget = src. src/a.ts shares dir → L1 (distance 0).
    // src-utils/x.ts: parent='src-utils', LCA with 'src' = root, so
    // distance = 1 (up) + 1 (down) = 2 → L3, NOT L2. Without the
    // segment-aware split, a naive prefix check would treat 'src-utils'
    // as a child of 'src' and place it at L2.
    const a = makeFile('src/a.ts');
    const lookAlike = makeFile('src-utils/x.ts');
    const dir = makeDir('src');

    const { readFor } = makeFader({
      buildings: [makeBuilding(a), makeBuilding(lookAlike)],
      selection: {
        kind: NodeKind.Directory,
        sidewalk: new THREE.Object3D() as unknown as THREE.Mesh,
        street: { dir } as Street,
        dir,
      } as unknown as PickTarget,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(0.8);
    expect(readFor('src-utils/x.ts')!.opacity).toBeCloseTo(0.4); // L3, not L2
  });

  it('selected file honors DEFAULT config (no hardcoded constants)', () => {
    BUILDING_FADE.value = { ...BUILDING_FADE.value, DEFAULT_BODY_OPACITY: 0.5 };

    const a = makeFile('src/a.ts');
    const selBuilding = makeBuilding(a);
    const streetByDir = new Map([['src', { dir: makeDir('src') }]]);

    const { readFor } = makeFader({
      buildings: [selBuilding],
      selection: {
        kind: NodeKind.File,
        mesh: new THREE.Object3D() as unknown as THREE.Mesh,
        data: selBuilding,
        file: a,
      } as unknown as PickTarget,
      streetByDir,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(0.5);
  });
});
