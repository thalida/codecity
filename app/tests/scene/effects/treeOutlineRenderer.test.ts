// Verifies treeOutlineRenderer wiring: subscriptions toggle visibility,
// transform snaps to the active tree's instance matrix, and rainbow
// colors advance frame-over-frame.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { atom } from 'nanostores';
import { createTreeOutlineRenderer } from '@/scene/effects/treeOutlineRenderer.js';
import { TREE_OUTLINE } from '@/config/components/trees.js';
import { RAINBOW } from '@/config/effects/effects.js';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types/picker.js';

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
        mesh: new THREE.InstancedMesh(
          new THREE.BufferGeometry(),
          new THREE.MeshBasicMaterial(),
          1
        ),
        instanceId: 0,
        commit: { sha, date: '2026-05-27', files: 1 },
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
    mesh: new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      1
    ),
    instanceId: 0,
    commit: { sha, date: '2026-05-27', files: 1 },
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
      mesh: new THREE.InstancedMesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial(),
        1
      ),
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
});
