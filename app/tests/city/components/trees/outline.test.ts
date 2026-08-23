// Verifies treeOutlineRenderer wiring: subscriptions toggle visibility,
// transform snaps to the active tree's instance matrix, and rainbow
// colors advance frame-over-frame.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { createTreeOutlineRenderer } from '@/city/components/trees/outline';
import { TREES } from '@/state/settings/fields/trees';
import { RAINBOW } from '@/state/settings/fields/effects';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types/picker';
import { commitTarget } from '../../../_helpers/cityFixtures';

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
  const hover = signal<PickTarget | null>(null);
  const selection = signal<PickTarget | null>(null);
  return { hover, selection };
}

describe('treeOutlineRenderer', () => {
  beforeEach(() => {
    TREES.value = {
      ...TREES.value,
      OUTLINE_WIDTH: 3,
      OUTLINE_HOVER_COLOR: '#ffffff',
      OUTLINE_HOVER_OPACITY: 0.5,
      OUTLINE_SELECTED_OPACITY: 1.0,
    };
    RAINBOW.value = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
  });

  it('hover outline is hidden when picker.hover is null', () => {
    const scene = new THREE.Scene();
    const picker = fakePicker();
    const matrix = new THREE.Matrix4().makeTranslation(10, 20, 30);
    const r = createTreeOutlineRenderer({
      canvas: fakeCanvas(),
      scene,
      picker,
      trees: TREES,
      rainbow: RAINBOW,
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', matrix),
    });
    picker.hover.value = commitTarget('a');
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.hover.value = commitTarget('a');
    picker.hover.value = null;
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', new THREE.Matrix4().makeTranslation(5, 0, 0)),
    });
    expect(r.selectedOutline.visible).toBe(false);
    picker.selection.value = commitTarget('a');
    expect(r.selectedOutline.visible).toBe(true);
    picker.selection.value = null;
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.selection.value = commitTarget('a');
    picker.hover.value = commitTarget('a'); // same as selected
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.hover.value = {
      kind: NodeKind.File,
      mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
      data: {} as never,
      file: { path: 'foo' } as never,
    };
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    TREES.value = {
      ...TREES.value,
      OUTLINE_WIDTH: 7,
      OUTLINE_HOVER_COLOR: '#ff00ff',
      OUTLINE_HOVER_OPACITY: 0.25,
      OUTLINE_SELECTED_OPACITY: 0.9,
    };
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
      trees: TREES,
      rainbow: RAINBOW,
      getTrees: () => fakeTrees('a', new THREE.Matrix4()),
    });
    picker.selection.value = commitTarget('a');

    // First frame: paint colors from the current time stamp.
    r.update(0);
    const geom = r.selectedOutline.geometry as LineSegmentsGeometry;
    // SafeLineSegmentsGeometry stores colors as a flat per-segment attribute.
    const colorAttr = geom.attributes.instanceColorStart as THREE.InstancedBufferAttribute;
    const before = Float32Array.from(colorAttr.array as Float32Array);

    // Advance time by enough to clear floating-point noise (~200ms) and re-paint.
    const tStart = performance.now();
    while (performance.now() - tStart < 200) {
      // busy wait — vitest's fake timers wouldn't move performance.now()
    }
    r.update(0);
    const after = colorAttr.array as Float32Array;

    let diffs = 0;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs(before[i] - after[i]) > 1e-4) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);

    r.dispose();
  });
});
