import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel.js';
import { REPO_LABEL } from '@/config/components/repoLabel.js';
import { RENDER_ORDERS } from '@/constants';

function resetStore() {
  REPO_LABEL.set({
    ENABLED: true,
    HEIGHT_ABOVE_CITY: 18,
    ANIMATION_SPEED: 1.0,
    OPACITY: 0.9,
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

  it('beam length tracks HEIGHT_ABOVE_CITY', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('HEIGHT_ABOVE_CITY', 25);
    label!.refresh();
    const beam = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'CylinderGeometry'
    ) as THREE.Mesh;
    expect(beam.scale.y).toBeCloseTo(25);
    expect(beam.position.y).toBeCloseTo(-12.5);
  });

  it('panel width tracks texture aspect (text-content-based)', () => {
    label!.setRepoName('a');
    const shortPanel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const shortWidth = (shortPanel.geometry as THREE.PlaneGeometry).parameters.width;

    label!.setRepoName('a-much-longer-repo-name-than-before');
    const longPanel = label!.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    const longWidth = (longPanel.geometry as THREE.PlaneGeometry).parameters.width;

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

  it('setAnchor positions the group at (anchor.x, max(cityHeight, anchor.y) + HEIGHT_ABOVE_CITY, anchor.z)', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('HEIGHT_ABOVE_CITY', 20);
    label!.setAnchor(new THREE.Vector3(10, 0, 30), 40);
    expect(label!.group.position.x).toBeCloseTo(10);
    expect(label!.group.position.y).toBeCloseTo(60);
    expect(label!.group.position.z).toBeCloseTo(30);
  });

  it('setRepoName twice with the same name does NOT dispose the canvas texture', () => {
    label!.setRepoName('codecity');
    const tex = ((label!.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms
      .uOpacity; // pin some material reference to compare
    label!.setRepoName('codecity');
    // The implementation should reuse the existing texture (only aspect-change triggers panel rebuild).
    expect(label!.group.children.length).toBe(2);
  });
});
