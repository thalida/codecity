import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel.js';
import { REPO_LABEL } from '@/config/components/repoLabel.js';
import { RENDER_ORDERS } from '@/constants';

function resetStore() {
  REPO_LABEL.set({
    ENABLED: true,
    STYLE: 'ring',
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

  it('returns a group with no style mesh until setRepoName is called', () => {
    expect(label!.group).toBeInstanceOf(THREE.Group);
    expect(label!.group.children.length).toBe(0);
  });

  it('tick is a no-op before setRepoName is called', () => {
    expect(() => label!.tick(0.016, new THREE.PerspectiveCamera())).not.toThrow();
  });

  it('setRepoName builds the active style (default ring) and adds it as a child', () => {
    label!.setRepoName('codecity');
    expect(label!.group.children.length).toBe(1);
    expect(label!.group.children[0].name).toBe('repoLabel:ring');
  });

  it('renderOrder is set on every child of the active style', () => {
    label!.setRepoName('codecity');
    const styleGroup = label!.group.children[0];
    for (const child of styleGroup.children) {
      expect((child as THREE.Mesh).renderOrder).toBe(RENDER_ORDERS.REPO_LABEL);
    }
  });

  it('refresh swaps the active style when STYLE changes', () => {
    label!.setRepoName('codecity');
    expect(label!.group.children[0].name).toBe('repoLabel:ring');
    REPO_LABEL.setKey('STYLE', 'hologram');
    label!.refresh();
    expect(label!.group.children[0].name).toBe('repoLabel:hologram');
    REPO_LABEL.setKey('STYLE', 'concentric');
    label!.refresh();
    expect(label!.group.children[0].name).toBe('repoLabel:concentric');
  });

  it('refresh hides the group when ENABLED is false', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('ENABLED', false);
    label!.refresh();
    expect(label!.group.visible).toBe(false);
    REPO_LABEL.setKey('ENABLED', true);
    label!.refresh();
    expect(label!.group.visible).toBe(true);
  });

  it('setAnchor positions the group at (anchor.x, max(cityHeight, anchor.y) + HEIGHT_ABOVE_CITY, anchor.z)', () => {
    label!.setRepoName('codecity');
    REPO_LABEL.setKey('HEIGHT_ABOVE_CITY', 20);
    label!.setAnchor(new THREE.Vector3(10, 0, 30), 40, 200);
    expect(label!.group.position.x).toBeCloseTo(10);
    expect(label!.group.position.y).toBeCloseTo(60);
    expect(label!.group.position.z).toBeCloseTo(30);
  });

  it('setAnchor propagates setDimensions to the active style', () => {
    label!.setRepoName('codecity');
    label!.setAnchor(new THREE.Vector3(0, 0, 0), 0, 200);
    const styleGroup = label!.group.children[0];
    const mesh = styleGroup.children[0] as THREE.Mesh;
    // Ring style: scale = 0.5 * 200 / 8 = 12.5
    expect(mesh.scale.x).toBeCloseTo(12.5);
  });

  it('setRepoName called twice does NOT dispose the canvas texture', () => {
    label!.setRepoName('codecity');
    const firstMesh = label!.group.children[0].children[0] as THREE.Mesh;
    const firstMat = firstMesh.material as THREE.ShaderMaterial;
    const firstTex = firstMat.uniforms.uMap.value as THREE.Texture;
    label!.setRepoName('a-different-name');
    const secondMesh = label!.group.children[0].children[0] as THREE.Mesh;
    const secondMat = secondMesh.material as THREE.ShaderMaterial;
    const secondTex = secondMat.uniforms.uMap.value as THREE.Texture;
    expect(secondTex).toBe(firstTex);
  });

  it('dispose releases the style and the canvas texture', () => {
    label!.setRepoName('codecity');
    label!.dispose();
    label = null;
    // Re-create to verify the next instance starts clean.
    const fresh = createRepoLabel();
    expect(fresh.group.children.length).toBe(0);
    fresh.dispose();
  });
});
