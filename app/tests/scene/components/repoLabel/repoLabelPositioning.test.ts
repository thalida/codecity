import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel.js';
import { REPO_LABEL } from '@/config/components/repoLabel.js';

function resetStore() {
  REPO_LABEL.set({
    ENABLED: true,
    STYLE: 'ring',
    HEIGHT_ABOVE_CITY: 18,
    ANIMATION_SPEED: 1.0,
    OPACITY: 0.9,
  });
}

describe('RepoLabel positioning', () => {
  let label: ReturnType<typeof createRepoLabel>;
  beforeEach(() => {
    resetStore();
    label = createRepoLabel();
    label.setRepoName('codecity');
  });
  afterEach(() => label.dispose());

  it('lifts to cityHeight + HEIGHT_ABOVE_CITY when cityHeight > anchor.y', () => {
    label.setAnchor(new THREE.Vector3(10, 0, 20), 30, 200);
    expect(label.group.position.toArray()).toEqual([10, 48, 20]);
  });

  it('lifts to anchor.y + HEIGHT_ABOVE_CITY when anchor.y > cityHeight', () => {
    label.setAnchor(new THREE.Vector3(0, 40, 0), 10, 200);
    expect(label.group.position.toArray()).toEqual([0, 58, 0]);
  });

  it('handles an empty manifest at origin with cityHeight = 0', () => {
    label.setAnchor(new THREE.Vector3(), 0, 200);
    expect(label.group.position.toArray()).toEqual([0, 18, 0]);
  });

  it('refresh() picks up a new HEIGHT_ABOVE_CITY without a setAnchor call', () => {
    label.setAnchor(new THREE.Vector3(0, 0, 0), 0, 200);
    expect(label.group.position.y).toBeCloseTo(18);
    REPO_LABEL.setKey('HEIGHT_ABOVE_CITY', 5);
    label.refresh();
    expect(label.group.position.y).toBeCloseTo(5);
  });
});
