// picker.test.js — exercises the hover/selection state machine and the
// one-way derivation from selection → selectionKey, plus the
// re-resolution from key → selection on world rebuild.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/city/render/picker';
import { NodeKind } from '@/types';
import type {
  Building,
  DirNode,
  FileNode,
  FileTarget,
  DirTarget,
  PickerWorld,
  Street,
} from '@/types';

// Minimal building / street fixture shapes for the fake scene.
interface FakeBuildingFixture {
  path: string;
  mesh: object;
}
interface FakeStreetFixture {
  path: string;
  sidewalk: object;
}

// camera is only used by raycaster.setFromCamera (never exercised in these
// tests); fake stub cast to the prod type so picker's signature stays honest.
const FAKE_CAMERA = {} as unknown as THREE.Camera;

// Minimal FileTarget / DirTarget builders: tests only exercise identity
// (mesh ===, file.path), so the unrelated fields are stubbed and cast.
function makeFileTarget(
  opts: {
    path?: string;
    mesh?: object;
    data?: object;
  } = {}
): FileTarget {
  return {
    kind: NodeKind.File,
    mesh: (opts.mesh ?? {}) as unknown as THREE.Mesh,
    data: (opts.data ?? {}) as unknown as Building,
    file: { path: opts.path ?? 'x' } as unknown as FileNode,
  };
}

function makeDirTarget(
  opts: { path?: string; sidewalk?: object; street?: object } = {}
): DirTarget {
  return {
    kind: NodeKind.Directory,
    sidewalk: (opts.sidewalk ?? {}) as unknown as THREE.Mesh,
    street: (opts.street ?? {}) as unknown as Street,
    dir: { path: opts.path ?? 'x' } as unknown as DirNode,
  };
}

// Minimal world stub with the accessors picker actually reads. Internal
// fixtures cast to the real types so the helper satisfies PickerWorld.
function makeFakeWorld(
  initialBuildings: FakeBuildingFixture[],
  initialStreets: FakeStreetFixture[]
) {
  let buildingMap: Record<string, { mesh: THREE.Mesh; building: Building }> = {};
  let streetMap: Record<string, Street> = {};
  let sidewalkMap: Record<string, THREE.Mesh> = {};
  const listeners: Array<() => void> = [];
  const rootGem: THREE.Object3D | null = null;

  function setSnapshot(buildings: FakeBuildingFixture[], streets: FakeStreetFixture[]): void {
    buildingMap = {};
    streetMap = {};
    sidewalkMap = {};
    for (let i = 0; i < (buildings || []).length; i++) {
      const b = buildings[i];
      buildingMap[b.path] = {
        mesh: b.mesh as unknown as THREE.Mesh,
        building: {
          file: { path: b.path, type: NodeKind.File },
        } as unknown as Building,
      };
    }
    for (let j = 0; j < (streets || []).length; j++) {
      const s = streets[j];
      streetMap[s.path] = {
        dir: { path: s.path },
        length: 100,
        width: 10,
        x: 0,
        y: 0,
      } as unknown as Street;
      sidewalkMap[s.path] = s.sidewalk as unknown as THREE.Mesh;
    }
    for (let k = 0; k < listeners.length; k++) listeners[k]();
  }
  setSnapshot(initialBuildings, initialStreets);

  const api: PickerWorld = {
    getStreetPickables() {
      return Object.keys(sidewalkMap).map((p) => sidewalkMap[p]);
    },
    getRootGem() {
      return rootGem;
    },
    getBuildingByPath(p: string) {
      return buildingMap[p] || null;
    },
    getSidewalkByDir(p: string) {
      return sidewalkMap[p] || null;
    },
    getStreetByDir(p: string) {
      return streetMap[p] || null;
    },
    onChange(cb: () => void) {
      listeners.push(cb);
      return function () {};
    },
    getBuildingIndex() {
      return null;
    },
    getCells() {
      return new Map();
    },
    getTrees() {
      return null;
    },
  };
  return Object.assign(api, { setSnapshot });
}

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  // Reset the module-level persistable signal between tests so a leftover
  // value from one test can't leak into the next.
  PICKER_SELECTION_KEY.value = null;
});

// Helper: build a fake hit object for interpretHit. Real callers pass
// THREE.Intersection<THREE.Object3D>; tests exercise just the userData.
function fakeHit(userData: Record<string, unknown>): THREE.Intersection<THREE.Object3D> {
  return { object: { userData } } as unknown as THREE.Intersection<THREE.Object3D>;
}

describe('createPicker', () => {
  it('exposes hover, selection, selectionKey signals + setters', () => {
    const fakeScene = makeFakeWorld([], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    expect('value' in p.hover).toBe(true);
    expect('value' in p.selection).toBe(true);
    expect(p.selectionKey).toBe(PICKER_SELECTION_KEY);
    expect(typeof p.setHover).toBe('function');
    expect(typeof p.setSelection).toBe('function');
    expect(typeof p.selectByPath).toBe('function');
    expect(typeof p.pickAt).toBe('function');
    expect(typeof p.interpretHit).toBe('function');
    p.dispose();
  });

  it('setSelection derives selectionKey for a file target', () => {
    const fakeScene = makeFakeWorld([], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.setSelection(makeFileTarget({ path: 'src/index.js' }));
    expect(p.selectionKey.value).toEqual({ kind: NodeKind.File, path: 'src/index.js' });
    p.dispose();
  });

  it('setSelection derives selectionKey for a directory target', () => {
    const fakeScene = makeFakeWorld([], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.setSelection(makeDirTarget({ path: 'src/lib' }));
    expect(p.selectionKey.value).toEqual({ kind: NodeKind.Directory, path: 'src/lib' });
    p.dispose();
  });

  it('setSelection(null) clears selectionKey', () => {
    const fakeScene = makeFakeWorld([], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.setSelection(makeFileTarget({ path: 'a.js' }));
    p.setSelection(null);
    expect(p.selectionKey.value).toBeNull();
    p.dispose();
  });

  it('selectByPath looks up a building by path and selects it', () => {
    const meshA = { name: 'meshA' };
    const fakeScene = makeFakeWorld([{ path: 'a.js', mesh: meshA }], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.selectByPath('a.js');
    const sel = p.selection.value;
    expect(sel?.kind).toBe(NodeKind.File);
    if (sel?.kind === NodeKind.File) {
      expect(sel.mesh).toBe(meshA);
    }
    expect(p.selectionKey.value).toEqual({ kind: NodeKind.File, path: 'a.js' });
    p.dispose();
  });

  it('selectByPath(missing) leaves selection alone', () => {
    const fakeScene = makeFakeWorld([{ path: 'a.js', mesh: {} }], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.selectByPath('a.js');
    p.selectByPath('does-not-exist.js');
    const sel = p.selection.value;
    expect(sel).not.toBeNull();
    if (sel?.kind === NodeKind.File) {
      expect(sel.file.path).toBe('a.js');
    }
  });

  it('world rebuild re-resolves selectionKey to a fresh selection', () => {
    const oldMesh = { id: 'old' };
    const fakeScene = makeFakeWorld([{ path: 'a.js', mesh: oldMesh }], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.selectByPath('a.js');
    const before = p.selection.value;
    if (before?.kind === NodeKind.File) expect(before.mesh).toBe(oldMesh);

    // Simulate a rebuild — same path, new mesh.
    const newMesh = { id: 'new' };
    fakeScene.setSnapshot([{ path: 'a.js', mesh: newMesh }], []);

    const after = p.selection.value;
    if (after?.kind === NodeKind.File) expect(after.mesh).toBe(newMesh);
    p.dispose();
  });

  it('world rebuild that removes the selected path clears selection + key', () => {
    const fakeScene = makeFakeWorld([{ path: 'a.js', mesh: {} }], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.selectByPath('a.js');
    expect(p.selection.value).not.toBeNull();

    fakeScene.setSnapshot([], []); // path no longer exists

    expect(p.selection.value).toBeNull();
    expect(p.selectionKey.value).toBeNull();
    p.dispose();
  });

  it('world rebuild always clears hover (transient, can dangle on disposed mesh otherwise)', () => {
    const fakeScene = makeFakeWorld([{ path: 'a.js', mesh: {} }], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    p.setHover(makeFileTarget({ mesh: { id: 'old' } }));
    expect(p.hover.value).not.toBeNull();

    fakeScene.setSnapshot([{ path: 'a.js', mesh: { id: 'new' } }], []);
    expect(p.hover.value).toBeNull();
    p.dispose();
  });

  it('interpretHit returns NodeKind.Gem for a gem hit', () => {
    const fakeScene = makeFakeWorld([], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    const target = p.interpretHit(fakeHit({ type: NodeKind.Gem }));
    expect(target?.kind).toBe(NodeKind.Gem);
    p.dispose();
  });

  it('interpretHit returns null for an uninterpretable hit', () => {
    const fakeScene = makeFakeWorld([], []);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world: fakeScene });
    expect(p.interpretHit(fakeHit({}))).toBeNull();
    expect(p.interpretHit(null)).toBeNull();
    p.dispose();
  });
});
