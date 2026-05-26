import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel.js';
import { REPO_LABEL } from '@/config/components/repoLabel.js';
import { RENDER_ORDERS } from '@/constants';

function resetStore() {
  REPO_LABEL.set({
    ENABLED: true,
    HEIGHT: 1305,
    FONT_SIZE: 96,
    ANIMATION_SPEED: 1.0,
    OPACITY: 0.9,
    BEAM_COLOR: '#33ffff',
    TEXT_COLOR: '#ffffff',
  });
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

  it('beam length tracks REPO_LABEL.HEIGHT', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('HEIGHT', 250);
    REPO_LABEL.setKey('FONT_SIZE', 100);
    label!.refresh();
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    // beamLength = max(0, HEIGHT - BEAM_FOOT_INSIDE_GEM) = max(0, 250 - 10) = 240
    expect(beam.scale.y).toBeCloseTo(240);
    // Beam top sits at panel bottom (local y = -FONT_SIZE/2 = -50);
    // beam bottom sits at panel bottom - beamLength = -50 - 240 = -290.
    // Center of beam is therefore at (-50 + -290) / 2 = -170.
    expect(beam.position.y).toBeCloseTo(-170);
  });

  it('panel scale tracks FONT_SIZE × textureAspect', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('FONT_SIZE', 120);
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
    REPO_LABEL.setKey('ENABLED', false);
    label!.refresh();
    expect(label!.group.visible).toBe(false);
  });

  it('setAnchor positions the group at anchor.x/z and lifts y by HEIGHT + FONT_SIZE/2', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('HEIGHT', 100);
    REPO_LABEL.setKey('FONT_SIZE', 80);
    label!.refresh();
    label!.setAnchor(new THREE.Vector3(10, 0, 30));
    expect(label!.group.position.x).toBeCloseTo(10);
    // anchor.y (0) + HEIGHT (100) + FONT_SIZE/2 (40) = 140
    expect(label!.group.position.y).toBeCloseTo(140);
    expect(label!.group.position.z).toBeCloseTo(30);
  });

  it('HEIGHT=0 puts the panel flush with the floor (panel bottom = anchor.y)', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('HEIGHT', 0);
    REPO_LABEL.setKey('FONT_SIZE', 100);
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
});
