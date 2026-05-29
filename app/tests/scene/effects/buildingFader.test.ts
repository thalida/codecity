// buildingFader.test.ts — verifies the in-subtree cascade: every building
// under the selected/hovered directory's subtree gets the NEAR tier;
// everything outside gets FAR. Selected and hovered buildings themselves
// keep their dedicated "brightest" tiers.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { atom } from 'nanostores';
import { createBuildingFader } from '@/scene/effects/buildingFader.js';
import { BUILDING_FADE } from '@/config/index.js';
import { FadeDetail, NodeKind } from '@/types';
import type { Building, DirNode, FileNode, PickTarget, Street } from '@/types';

const _originalFade = BUILDING_FADE.get();

afterEach(() => {
  BUILDING_FADE.set(_originalFade);
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
    3,
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
    selection: atom<PickTarget | null>(opts.selection ?? null),
    hover: atom<PickTarget | null>(opts.hover ?? null),
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

function setKnownFade() {
  BUILDING_FADE.set({
    ..._originalFade,
    DEFAULT_DETAIL: FadeDetail.Full,
    DEFAULT_BODY_OPACITY: 1.0,
    DEFAULT_OUTLINE: false,
    DEFAULT_OUTLINE_OPACITY: 0.0,
    NEAR_DETAIL: FadeDetail.Full,
    NEAR_BODY_OPACITY: 0.7,
    NEAR_OUTLINE: false,
    NEAR_OUTLINE_OPACITY: 0.0,
    FAR_DETAIL: FadeDetail.Silhouette,
    FAR_BODY_OPACITY: 0.2,
    FAR_OUTLINE: false,
    FAR_OUTLINE_OPACITY: 0.0,
  });
}

describe('buildingFader subtree cascade', () => {
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

  it('selected building → siblings NEAR, cousins FAR, selected itself Full', () => {
    const a = makeFile('src/a.ts');
    const b = makeFile('src/b.ts');
    const c = makeFile('lib/c.ts');
    const selBuilding = makeBuilding(a);
    const streetByDir = new Map([['src', { dir: makeDir('src') }]]);

    const { readFor } = makeFader({
      buildings: [selBuilding, makeBuilding(b), makeBuilding(c)],
      selection: {
        kind: NodeKind.File,
        mesh: new THREE.Object3D() as unknown as THREE.Mesh,
        data: selBuilding,
        file: a,
      } as unknown as PickTarget,
      streetByDir,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(1.0);
    expect(readFor('src/b.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('lib/c.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('selected building → descendants of the parent dir also NEAR', () => {
    const a = makeFile('src/a.ts');
    const nested = makeFile('src/sub/nested.ts');
    const selBuilding = makeBuilding(a);
    const streetByDir = new Map([['src', { dir: makeDir('src') }]]);

    const { readFor } = makeFader({
      buildings: [selBuilding, makeBuilding(nested)],
      selection: {
        kind: NodeKind.File,
        mesh: new THREE.Object3D() as unknown as THREE.Mesh,
        data: selBuilding,
        file: a,
      } as unknown as PickTarget,
      streetByDir,
    });
    expect(readFor('src/sub/nested.ts')!.opacity).toBeCloseTo(0.7);
  });

  it('selected dir → direct children + nested grandchildren NEAR, others FAR', () => {
    const a = makeFile('src/a.ts');
    const nested = makeFile('src/sub/n.ts');
    const other = makeFile('lib/x.ts');
    const dir = makeDir('src');

    const { readFor } = makeFader({
      buildings: [makeBuilding(a), makeBuilding(nested), makeBuilding(other)],
      selection: {
        kind: NodeKind.Directory,
        sidewalk: new THREE.Object3D() as unknown as THREE.Mesh,
        street: { dir } as Street,
        dir,
      } as unknown as PickTarget,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('src/sub/n.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('lib/x.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('hovered building → siblings NEAR, hovered itself DEFAULT', () => {
    const a = makeFile('src/a.ts');
    const b = makeFile('src/b.ts');
    const c = makeFile('lib/c.ts');
    const hovBuilding = makeBuilding(a);
    const streetByDir = new Map([['src', { dir: makeDir('src') }]]);

    const { readFor } = makeFader({
      buildings: [hovBuilding, makeBuilding(b), makeBuilding(c)],
      hover: {
        kind: NodeKind.File,
        mesh: new THREE.Object3D() as unknown as THREE.Mesh,
        data: hovBuilding,
        file: a,
      } as unknown as PickTarget,
      streetByDir,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(1.0);
    expect(readFor('src/b.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('lib/c.ts')!.opacity).toBeCloseTo(0.2);
  });

  it('root selection (dir.path = ".") → every building NEAR', () => {
    const a = makeFile('src/a.ts');
    const b = makeFile('lib/b.ts');
    const c = makeFile('README.md');
    const rootDir = makeDir('.');

    const { readFor } = makeFader({
      buildings: [makeBuilding(a), makeBuilding(b), makeBuilding(c)],
      selection: {
        kind: NodeKind.Directory,
        sidewalk: new THREE.Object3D() as unknown as THREE.Mesh,
        street: { dir: rootDir } as Street,
        dir: rootDir,
      } as unknown as PickTarget,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('lib/b.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('README.md')!.opacity).toBeCloseTo(0.7);
  });

  it('prefix-precision: "src-utils" is NOT a descendant of "src"', () => {
    const inside = makeFile('src/a.ts');
    const sibling = makeFile('src/b.ts');
    const lookAlike = makeFile('src-utils/x.ts');
    const dir = makeDir('src');

    const { readFor } = makeFader({
      buildings: [makeBuilding(inside), makeBuilding(sibling), makeBuilding(lookAlike)],
      selection: {
        kind: NodeKind.Directory,
        sidewalk: new THREE.Object3D() as unknown as THREE.Mesh,
        street: { dir } as Street,
        dir,
      } as unknown as PickTarget,
    });

    expect(readFor('src/a.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('src/b.ts')!.opacity).toBeCloseTo(0.7);
    expect(readFor('src-utils/x.ts')!.opacity).toBeCloseTo(0.2);
  });
});
