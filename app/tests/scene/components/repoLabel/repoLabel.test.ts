import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel';
import { REPO_LABEL } from '@/state/settings/gem';
import { RENDER_ORDERS } from '@/scene/renderOrders';
import { resetBuildingsConfig } from '../../../_helpers/cityFixtures';

// Positioning math below assumes BUILDING_DIMENSIONS.MAX_FLOORS=96,
// FLOOR_HEIGHT=16 → maxBldgH = 1536. resetBuildingsConfig pins both so
// the assertions stay stable when production defaults change.
function resetStore() {
  REPO_LABEL.value = {
    ENABLED: true,
    HEIGHT_PCT: 85,
    FONT_SIZE: 128,
    ANIMATION_SPEED: 1.0,
    OPACITY: 0.9,
    BEAM_COLOR: '#bfb3ff',
    TEXT_COLOR: '#ffffff',
  };
  resetBuildingsConfig();
}

describe('createRepoLabel()', () => {
  let label: ReturnType<typeof createRepoLabel> | null = null;

  beforeEach(() => {
    resetStore();
    label = createRepoLabel();
  });

  afterEach(() => {
    label?.dispose();
    label = null;
  });

  it('returns an empty group until setRepoName is called', () => {
    expect(label!.group).toBeInstanceOf(THREE.Group);
    expect(label!.group.children.length).toBe(0);
  });

  it('tick is a no-op before setRepoName is called', () => {
    expect(() => label!.tick(0.016, new THREE.PerspectiveCamera())).not.toThrow();
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

  it('beam length tracks REPO_LABEL.HEIGHT_PCT', () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 50 };
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 100 };
    label!.refresh();
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    // beamLength = max(0, heightWorld - BEAM_FOOT_FALLBACK) = max(0, 768 - 10) = 758
    expect(beam.scale.y).toBeCloseTo(758);
    // groupWorldY = 768 + 50 = 818 (panel center)
    // beamTopWorld = 768, beamBottomWorld = 10
    // beamCenterWorld = (768 + 10) / 2 = 389
    // beam.position.y = 389 - 818 = -429
    expect(beam.position.y).toBeCloseTo(-429);
  });

  it('panel scale tracks FONT_SIZE × textureAspect', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 120 };
    label!.refresh();
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
    label!.tick(0.016, camera);
    const panel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    panel.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(forward.x).toBeGreaterThan(0.5);
    expect(Math.abs(forward.y)).toBeLessThan(0.05);
  });

  it('refresh hides the group when ENABLED is false', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.value = { ...REPO_LABEL.value, ENABLED: false };
    label!.refresh();
    expect(label!.group.visible).toBe(false);
  });

  it('setAnchor positions the group at anchor.x/z and lifts y by heightWorld + FONT_SIZE/2', () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 50 };
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 80 };
    label!.refresh();
    label!.setAnchor(new THREE.Vector3(10, 0, 30));
    expect(label!.group.position.x).toBeCloseTo(10);
    // anchor.y (0) + heightWorld (768) + FONT_SIZE/2 (40) = 808
    expect(label!.group.position.y).toBeCloseTo(808);
    expect(label!.group.position.z).toBeCloseTo(30);
  });

  it('HEIGHT_PCT=0 puts the panel flush with the floor (panel bottom = anchor.y)', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 0 };
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 100 };
    label!.refresh();
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
    // Three.js cannot resize a CanvasTexture's GPU allocation in place;
    // textCanvas.redrawRepoName swaps RepoNameTexture.texture when the
    // canvas width changes. setRepoName must follow that swap by updating
    // the panel material's uMap uniform — otherwise the panel keeps
    // sampling the disposed old texture and the new name never appears.
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
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 50 };
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 100 };
    label!.refresh();
    // Stand-in for the gem — a THREE.Object3D with a settable position.y.
    // (In real use this is the gem THREE.Group; renderLoop mutates its
    // .position.y each frame.)
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
    label!.tick(0.016, new THREE.PerspectiveCamera());
    // beamLength = 768 - 35 = 733
    expect(beam.scale.y).toBeCloseTo(733);
  });

  it('setGem(null) falls back to the constant inset above the anchor', () => {
    label!.setRepoName('codecity');
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 50 };
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 60 };
    label!.refresh();
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
});
