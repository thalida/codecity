// picker.test.js — exercises the hover/selection state machine and the
// one-way derivation from selection → selectionKey, plus the
// re-resolution from key → selection on cityScene rebuild.

import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '../../scene/picker.js';
import { NodeKind } from '../../types';

// Minimal building / street fixture shapes for the fake scene.
interface FakeBuildingFixture {
  path: string;
  mesh: object;
}
interface FakeStreetFixture {
  path: string;
  sidewalk: object;
}

// Minimal cityScene stub with the accessors picker actually reads.
function makeFakeCityScene(
  initialBuildings: FakeBuildingFixture[],
  initialStreets: FakeStreetFixture[]
) {
  let buildingMap: Record<
    string,
    { mesh: object; building: { file: { path: string; type: NodeKind } } }
  > = {};
  let streetMap: Record<
    string,
    { dir: { path: string }; length: number; width: number; x: number; y: number }
  > = {};
  let sidewalkMap: Record<string, object> = {};
  const listeners: Array<(diff: { entering: object; exiting: object; staying: object }) => void> =
    [];
  const rootGem: null = null;

  function setSnapshot(buildings: FakeBuildingFixture[], streets: FakeStreetFixture[]): void {
    buildingMap = {};
    streetMap = {};
    sidewalkMap = {};
    for (let i = 0; i < (buildings || []).length; i++) {
      const b = buildings[i];
      buildingMap[b.path] = {
        mesh: b.mesh,
        building: { file: { path: b.path, type: NodeKind.File } },
      };
    }
    for (let j = 0; j < (streets || []).length; j++) {
      const s = streets[j];
      streetMap[s.path] = { dir: { path: s.path }, length: 100, width: 10, x: 0, y: 0 };
      sidewalkMap[s.path] = s.sidewalk;
    }
    for (let k = 0; k < listeners.length; k++)
      listeners[k]({ entering: {}, exiting: {}, staying: {} });
  }
  setSnapshot(initialBuildings, initialStreets);

  return {
    getBuildings() {
      return Object.keys(buildingMap).map((p) => {
        return buildingMap[p].mesh;
      });
    },
    getStreetPickables() {
      return Object.keys(sidewalkMap).map((p) => {
        return sidewalkMap[p];
      });
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
    onChange(cb: (diff: { entering: object; exiting: object; staying: object }) => void) {
      listeners.push(cb);
      return function () {};
    },
    setSnapshot,
  };
}

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  // Reset the module-level persistable atom between tests so a leftover
  // value from one test can't leak into the next.
  PICKER_SELECTION_KEY.set(null);
});

describe('createPicker', () => {
  it('exposes hover, selection, selectionKey atoms + setters', () => {
    const fakeScene = makeFakeCityScene([], []);
    const camera = { isCamera: true };
    const p = createPicker({ canvas, camera, cityScene: fakeScene });
    expect(typeof p.hover.get).toBe('function');
    expect(typeof p.selection.get).toBe('function');
    expect(p.selectionKey).toBe(PICKER_SELECTION_KEY);
    expect(typeof p.setHover).toBe('function');
    expect(typeof p.setSelection).toBe('function');
    expect(typeof p.selectByPath).toBe('function');
    expect(typeof p.pickAt).toBe('function');
    expect(typeof p.interpretHit).toBe('function');
    p.dispose();
  });

  it('setSelection derives selectionKey for a file target', () => {
    const fakeScene = makeFakeCityScene([], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.setSelection({
      kind: NodeKind.File,
      mesh: {},
      data: {},
      file: { path: 'src/index.js' },
    });
    expect(p.selectionKey.get()).toEqual({ kind: 'file', path: 'src/index.js' });
    p.dispose();
  });

  it('setSelection derives selectionKey for a directory target', () => {
    const fakeScene = makeFakeCityScene([], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.setSelection({
      kind: NodeKind.Directory,
      sidewalk: {},
      street: {},
      dir: { path: 'src/lib' },
    });
    expect(p.selectionKey.get()).toEqual({ kind: 'directory', path: 'src/lib' });
    p.dispose();
  });

  it('setSelection(null) clears selectionKey', () => {
    const fakeScene = makeFakeCityScene([], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.setSelection({ kind: NodeKind.File, file: { path: 'a.js' } });
    p.setSelection(null);
    expect(p.selectionKey.get()).toBeNull();
    p.dispose();
  });

  it('selectByPath looks up a building by path and selects it', () => {
    const meshA = { name: 'meshA' };
    const fakeScene = makeFakeCityScene([{ path: 'a.js', mesh: meshA }], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.selectByPath('a.js');
    expect(p.selection.get().kind).toBe(NodeKind.File);
    expect(p.selection.get().mesh).toBe(meshA);
    expect(p.selectionKey.get()).toEqual({ kind: 'file', path: 'a.js' });
    p.dispose();
  });

  it('selectByPath(missing) leaves selection alone', () => {
    const fakeScene = makeFakeCityScene([{ path: 'a.js', mesh: {} }], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.selectByPath('a.js');
    p.selectByPath('does-not-exist.js');
    expect(p.selection.get()).not.toBeNull();
    expect(p.selection.get().file.path).toBe('a.js');
    p.dispose();
  });

  it('cityScene rebuild re-resolves selectionKey to a fresh selection', () => {
    const oldMesh = { id: 'old' };
    const fakeScene = makeFakeCityScene([{ path: 'a.js', mesh: oldMesh }], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.selectByPath('a.js');
    expect(p.selection.get().mesh).toBe(oldMesh);

    // Simulate a rebuild — same path, new mesh.
    const newMesh = { id: 'new' };
    fakeScene.setSnapshot([{ path: 'a.js', mesh: newMesh }], []);

    expect(p.selection.get().mesh).toBe(newMesh);
    p.dispose();
  });

  it('cityScene rebuild that removes the selected path clears selection + key', () => {
    const fakeScene = makeFakeCityScene([{ path: 'a.js', mesh: {} }], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.selectByPath('a.js');
    expect(p.selection.get()).not.toBeNull();

    fakeScene.setSnapshot([], []); // path no longer exists

    expect(p.selection.get()).toBeNull();
    expect(p.selectionKey.get()).toBeNull();
    p.dispose();
  });

  it('cityScene rebuild always clears hover (transient, can dangle on disposed mesh otherwise)', () => {
    const fakeScene = makeFakeCityScene([{ path: 'a.js', mesh: {} }], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    p.setHover({ kind: NodeKind.File, mesh: { id: 'old' } });
    expect(p.hover.get()).not.toBeNull();

    fakeScene.setSnapshot([{ path: 'a.js', mesh: { id: 'new' } }], []);
    expect(p.hover.get()).toBeNull();
    p.dispose();
  });

  it('interpretHit returns NodeKind.Gem for a gem hit', () => {
    const fakeScene = makeFakeCityScene([], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    const target = p.interpretHit({ object: { userData: { type: NodeKind.Gem } } });
    expect(target.kind).toBe(NodeKind.Gem);
    p.dispose();
  });

  it('interpretHit returns null for an uninterpretable hit', () => {
    const fakeScene = makeFakeCityScene([], []);
    const p = createPicker({ canvas, camera: {}, cityScene: fakeScene });
    expect(p.interpretHit({ object: { userData: {} } })).toBeNull();
    expect(p.interpretHit(null)).toBeNull();
    p.dispose();
  });
});
