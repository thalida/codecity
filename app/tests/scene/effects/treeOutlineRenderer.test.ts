// Verifies treeOutlineRenderer wiring: subscriptions toggle visibility,
// transform snaps to the active tree's instance matrix, and rainbow
// colors advance frame-over-frame.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { atom } from 'nanostores';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { createTreeOutlineRenderer } from '@/scene/effects/treeOutlineRenderer';
import { TREE_OUTLINE } from '@/state/settings/components/trees';
import { RAINBOW } from '@/state/settings/effects/effects';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types/picker';

function fakeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { value: 800 });
  Object.defineProperty(c, 'clientHeight', { value: 600 });
  return c;
}

function fakeTrees(activeSha: string, matrix: THREE.Matrix4) {
  return {
    getInstanceTransform: (sha: string, out: THREE.Matrix4) => {
      if (sha !== activeSha) return false;
      out.copy(matrix);
      return true;
    },
    findTreeBySha: (sha: string) => {
      if (sha !== activeSha) return null;
      return {
        mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
        instanceId: 0,
        commit: {
          sha,
          date: '2026-05-27',
          files: 1,
          authors: ['Test Author'],
          subject: 'test commit',
        },
      };
    },
  };
}

function fakePicker() {
  const hover = atom<PickTarget | null>(null);
  const selection = atom<PickTarget | null>(null);
  return { hover, selection };
}

function commitTarget(sha: string): PickTarget {
  return {
    kind: NodeKind.Commit,
    mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
    instanceId: 0,
    commit: { sha, date: '2026-05-27', files: 1, authors: ['Test Author'], subject: 'test commit' },
  };
}

describe('treeOutlineRenderer', () => {
  beforeEach(() => {
    TREE_OUTLINE.set({
      WIDTH: 3,
      HOVER_COLOR: '#ffffff',
      HOVER_OPACITY: 0.5,
      SELECTED_OPACITY: 1.0,
    });
    RAINBOW.set({ SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 });
  });

  it('hover outline is hidden when picker.hover is null', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const matrix = new THREE.Matrix4().makeTranslation(10, 20, 30);
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', matrix),
    });
    expect(r.hoverOutline.visible).toBe(false);
    r.dispose();
  });

  it('hover outline becomes visible and transform matches active tree', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const matrix = new THREE.Matrix4()
      .makeTranslation(10, 20, 30)
      .multiply(new THREE.Matrix4().makeScale(2, 3, 4));
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', matrix),
    });
    picker.hover.set(commitTarget('a'));
    expect(r.hoverOutline.visible).toBe(true);
    for (let i = 0; i < 16; i++) {
      expect(r.hoverOutline.matrix.elements[i]).toBeCloseTo(matrix.elements[i], 5);
    }
    r.dispose();
  });

  it('hover outline hides again when hover clears', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.hover.set(commitTarget('a'));
    picker.hover.set(null);
    expect(r.hoverOutline.visible).toBe(false);
    r.dispose();
  });

  it('selected outline tracks picker.selection the same way', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', new THREE.Matrix4().makeTranslation(5, 0, 0)),
    });
    expect(r.selectedOutline.visible).toBe(false);
    picker.selection.set(commitTarget('a'));
    expect(r.selectedOutline.visible).toBe(true);
    picker.selection.set(null);
    expect(r.selectedOutline.visible).toBe(false);
    r.dispose();
  });

  it('hover outline hides when hover sha is null but selection is set (no double-paint)', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.selection.set(commitTarget('a'));
    picker.hover.set(commitTarget('a')); // same as selected
    expect(r.selectedOutline.visible).toBe(true);
    expect(r.hoverOutline.visible).toBe(false);
    r.dispose();
  });

  it('hovering a non-Commit target does not show the tree outline', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.hover.set({
      kind: NodeKind.File,
      mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
      data: {} as never,
      file: { path: 'foo' } as never,
    });
    expect(r.hoverOutline.visible).toBe(false);
    r.dispose();
  });

  it('refreshMaterials pushes WIDTH and opacity updates into both materials', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    TREE_OUTLINE.set({
      WIDTH: 7,
      HOVER_COLOR: '#ff00ff',
      HOVER_OPACITY: 0.25,
      SELECTED_OPACITY: 0.9,
    });
    r.refreshMaterials();
    expect((r.hoverOutline.material as { linewidth: number }).linewidth).toBe(7);
    expect((r.hoverOutline.material as { opacity: number }).opacity).toBeCloseTo(0.25, 5);
    expect((r.selectedOutline.material as { linewidth: number }).linewidth).toBe(7);
    expect((r.selectedOutline.material as { opacity: number }).opacity).toBeCloseTo(0.9, 5);
    r.dispose();
  });

  it('update advances selected outline rainbow colors over time', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.selection.set(commitTarget('a'));

    // First frame: paint colors from the current time stamp.
    r.update(0);
    const geom = r.selectedOutline.geometry as LineSegmentsGeometry;
    const colorAttr = geom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute;
    const before = Float32Array.from(colorAttr.data.array as Float32Array);

    // Advance time by enough to clear floating-point noise (~200ms) and re-paint.
    const tStart = performance.now();
    while (performance.now() - tStart < 200) {
      // busy wait — vitest's fake timers wouldn't move performance.now()
    }
    r.update(0);
    const after = colorAttr.data.array as Float32Array;

    let diffs = 0;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs(before[i] - after[i]) > 1e-4) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);

    r.dispose();
  });

  it('selecting a d2-tier tree swaps the outline geometry to the d2 tier', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();

    // Build a fake whose findTreeBySha returns an InstancedMesh named with
    // the d2 suffix, so _detailOfMesh resolves to detail tier 2.
    const d2Mesh = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      1
    );
    d2Mesh.name = 'tree-canopy-d2';

    const trees = {
      getInstanceTransform: (sha: string, out: THREE.Matrix4) => {
        if (sha !== 'a') return false;
        out.identity();
        return true;
      },
      findTreeBySha: (sha: string) => {
        if (sha !== 'a') return null;
        return { mesh: d2Mesh, instanceId: 0 };
      },
    };

    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      getTrees: () => trees,
    });

    const initialGeom = r.selectedOutline.geometry;
    picker.selection.set(commitTarget('a'));

    // After selecting a d2-tier tree, the outline geometry should differ
    // from the initial (d0) one.
    expect(r.selectedOutline.geometry).not.toBe(initialGeom);
    expect(r.selectedOutline.visible).toBe(true);

    r.dispose();
  });
});
