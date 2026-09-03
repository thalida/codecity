// The repo-label component: its mesh tree, the settings effect that pushes
// REPO_LABEL into uniforms and transform, tick's billboarding, and dispose
// releasing GPU resources and stopping the effect.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '../../../src/components/repoLabel';
import { RENDER_ORDERS } from '../../../src/types/renderOrders';
import { TEST_BUILDING_DIMENSIONS, makeSceneContext } from '../../_helpers/cityFixtures';
import { settingsStore } from '../../_helpers/citySettings';
import type { FrameContext } from '../../../src/types';

// The positioning math assumes MAX_FLOORS=96 and FLOOR_HEIGHT=16 (maxBldgH
// 1536), and a label at 85% of it. Stated, not defaulted: production defaults
// have moved before.
const LABEL_SETTINGS = {
  REPO_LABEL: {
    ENABLED: true,
    HEIGHT_PCT: 85,
    FONT_SIZE: 128,
    ANIMATION_SPEED: 1.0,
    OPACITY: 0.9,
    BEAM_COLOR: '#bfb3ff',
    TEXT_COLOR: '#ffffff',
  },
  BUILDING_DIMENSIONS: TEST_BUILDING_DIMENSIONS,
};

// The repoLabel uses nothing from ctx at construction; a minimal stub suffices.

function makeFrame(camera: THREE.Camera): FrameContext {
  return { dt: 0.016, time: 0, camera: camera as THREE.PerspectiveCamera };
}

describe('createRepoLabel()', () => {
  let label: ReturnType<typeof createRepoLabel> | null = null;
  let store: ReturnType<typeof settingsStore>;

  beforeEach(() => {
    store = settingsStore(LABEL_SETTINGS);
    label = createRepoLabel(makeSceneContext(undefined, store), { getGem: () => null });
  });

  afterEach(() => {
    label?.dispose();
    label = null;
  });

  it('returns an empty group until setRepoName is called, and ticking keeps it that way', () => {
    expect(label!.group).toBeInstanceOf(THREE.Group);
    expect(label!.group.children.length).toBe(0);

    label!.tick(0.016, makeFrame(new THREE.PerspectiveCamera()));
    expect(label!.group.children.length).toBe(0);
  });

  it('setRepoName builds a beam + a text panel', () => {
    label!.setRepoName('codecity');
    const types = label!.group.children
      .map((c) => ((c as THREE.Mesh).geometry as { type?: string }).type)
      .sort();
    expect(types).toContain('CylinderGeometry');
    expect(types).toContain('PlaneGeometry');
  });

  it('renderOrder is REPO_LABEL on every mesh', () => {
    label!.setRepoName('codecity');
    for (const child of label!.group.children) {
      expect((child as THREE.Mesh).renderOrder).toBe(RENDER_ORDERS.REPO_LABEL);
    }
  });

  it('beam length tracks REPO_LABEL.HEIGHT_PCT via effect', () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    store.update({ REPO_LABEL: { HEIGHT_PCT: 50, FONT_SIZE: 100 } });
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    // beamLength = max(0, heightWorld - BEAM_FOOT_FALLBACK) = max(0, 768 - 10) = 758
    expect(beam.scale.y).toBeCloseTo(758);
    // panel centre 818, beam centre (768 + 10) / 2 = 389, so the beam sits at
    // 389 - 818 = -429.
    expect(beam.position.y).toBeCloseTo(-429);
  });

  it('panel scale tracks FONT_SIZE × textureAspect via effect', () => {
    label!.setRepoName('codecity');
    store.update({ REPO_LABEL: { FONT_SIZE: 120 } });
    const panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    // Panel scale.y = FONT_SIZE (120); scale.x = FONT_SIZE * aspect.
    expect(panel.scale.y).toBeCloseTo(120);
    expect(panel.scale.x).toBeGreaterThan(panel.scale.y); // text canvas is wider than tall
  });

  it('panel width grows with name length (text-content-based)', () => {
    label!.setRepoName('a');
    let panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const shortWidth = panel.scale.x;

    label!.setRepoName('a-much-longer-repo-name-than-before');
    panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const longWidth = panel.scale.x;

    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('tick rotates the panel to face the camera (Y-locked)', () => {
    label!.setRepoName('codecity');
    label!.group.position.set(0, 50, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(100, 50, 0);
    label!.tick(0.016, makeFrame(camera));
    const panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    panel.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(forward.x).toBeGreaterThan(0.5);
    expect(Math.abs(forward.y)).toBeLessThan(0.05);
  });

  it('settings effect hides the group when ENABLED is false', () => {
    label!.setRepoName('codecity');
    store.update({ REPO_LABEL: { ENABLED: false } });
    expect(label!.group.visible).toBe(false);
  });

  it('setAnchor positions the group at anchor.x/z and lifts y by heightWorld + FONT_SIZE/2', () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    store.update({ REPO_LABEL: { HEIGHT_PCT: 50, FONT_SIZE: 80 } });
    label!.setAnchor(new THREE.Vector3(10, 0, 30));
    expect(label!.group.position.x).toBeCloseTo(10);
    // anchor.y (0) + heightWorld (768) + FONT_SIZE/2 (40) = 808
    expect(label!.group.position.y).toBeCloseTo(808);
    expect(label!.group.position.z).toBeCloseTo(30);
  });

  it('raises the label from the anchor, not from y=0', () => {
    label!.setRepoName('codecity');
    store.update({ REPO_LABEL: { HEIGHT_PCT: 50, FONT_SIZE: 80 } });
    label!.setAnchor(new THREE.Vector3(0, 40, 0));
    // anchor.y (40) + heightWorld (768) + FONT_SIZE/2 (40) = 848
    expect(label!.group.position.y).toBeCloseTo(848);
  });

  it('HEIGHT_PCT=0 puts the panel flush with the floor (panel bottom = anchor.y)', () => {
    label!.setRepoName('codecity');
    store.update({ REPO_LABEL: { HEIGHT_PCT: 0, FONT_SIZE: 100 } });
    label!.setAnchor(new THREE.Vector3(0, 0, 0));
    // Panel center = 0 + 0 + 50 = 50 → panel bottom = 0 (floor). ✓
    expect(label!.group.position.y).toBeCloseTo(50);
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    // beamLength = max(0, 0 - 10) = 0
    expect(beam.scale.y).toBeCloseTo(0);
  });

  it('setRepoName twice keeps both meshes in the group', () => {
    label!.setRepoName('codecity');
    label!.setRepoName('codecity');
    expect(label!.group.children.length).toBe(2);
  });

  it('setRepoName with a wider name repoints the panel uniform at the new texture', () => {
    // A CanvasTexture cannot resize in place, so redrawRepoName swaps it and
    // setRepoName must follow: otherwise the panel samples the disposed one.
    label!.setRepoName('a');
    const panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const mat = panel.material as THREE.ShaderMaterial;
    const oldTex = mat.uniforms.uMap.value as THREE.Texture;
    label!.setRepoName('a-much-longer-repo-name-than-before');
    const newTex = mat.uniforms.uMap.value as THREE.Texture;
    expect(newTex).not.toBe(oldTex);
    expect(newTex).toBeInstanceOf(THREE.CanvasTexture);
  });

  it("setGem makes the beam track the gem's live world Y (hover + bob)", () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    store.update({ REPO_LABEL: { HEIGHT_PCT: 50, FONT_SIZE: 100 } });
    // Stand-in for the gem's THREE.Group, whose position.y renderLoop mutates.
    const fakeGem = new THREE.Object3D();
    fakeGem.position.y = 25; // gem center, dynamic
    label!.setGem(fakeGem);
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    // beamLength = panelBottom (768) - gem (25) = 743
    expect(beam.scale.y).toBeCloseTo(743);
    // Simulate a frame of bob — gem moves up.
    fakeGem.position.y = 35;
    label!.tick(0.016, makeFrame(new THREE.PerspectiveCamera()));
    // beamLength = 768 - 35 = 733
    expect(beam.scale.y).toBeCloseTo(733);
  });

  it('setGem(null) falls back to the constant inset above the anchor', () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    store.update({ REPO_LABEL: { HEIGHT_PCT: 50, FONT_SIZE: 60 } });
    const fakeGem = new THREE.Object3D();
    fakeGem.position.y = 50;
    label!.setGem(fakeGem);
    label!.setGem(null);
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    // Fallback: beam foot at anchor.y (0) + 10 (BEAM_FOOT_FALLBACK).
    // beamLength = 768 - 10 = 758.
    expect(beam.scale.y).toBeCloseTo(758);
  });

  it('settings effect re-applies opacity into uniforms on REPO_LABEL mutation', () => {
    label!.setRepoName('codecity');
    store.update({ REPO_LABEL: { OPACITY: 0.5 } });
    const panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const mat = panel.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.5);
  });

  it('settings effect re-applies colors into uniforms on REPO_LABEL mutation', () => {
    label!.setRepoName('codecity');
    store.update({ REPO_LABEL: { TEXT_COLOR: '#ff0000', BEAM_COLOR: '#00ff00' } });
    const panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const panelMat = panel.material as THREE.ShaderMaterial;
    const tint = panelMat.uniforms.uTint.value as THREE.Color;
    expect(tint.r).toBeCloseTo(1);
    expect(tint.g).toBeCloseTo(0);
    expect(tint.b).toBeCloseTo(0);
  });

  it('dispose() stops the effect: a later REPO_LABEL mutation never moves the group', () => {
    label!.setRepoName('codecity');
    const group = label!.group;
    const y = group.position.y;
    label!.dispose();
    label = null;

    // HEIGHT_PCT writes group.position with no null guard, so a subscription
    // outliving dispose shows up here. OPACITY would not: it is guarded.
    store.update({ REPO_LABEL: { HEIGHT_PCT: store.REPO_LABEL.HEIGHT_PCT + 25 } });

    expect(group.position.y).toBe(y);
  });
});
