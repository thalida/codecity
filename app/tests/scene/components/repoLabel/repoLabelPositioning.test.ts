import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel.js';
import { REPO_LABEL } from '@/config/components/repoLabel.js';

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

// group.position.y = anchor.y + HEIGHT + FONT_SIZE / 2
// (panel center floats HEIGHT + FONT_SIZE/2 above the floor; panel
// bottom sits at HEIGHT above the floor)

describe('RepoLabel positioning', () => {
  let label: ReturnType<typeof createRepoLabel>;
  beforeEach(() => {
    resetStore();
    label = createRepoLabel();
    label.setRepoName('codecity');
  });
  afterEach(() => label.dispose());

  it('default config places panel center at anchor.y + HEIGHT + FONT_SIZE/2', () => {
    label.setAnchor(new THREE.Vector3(10, 0, 20));
    // 0 + 1305 + 96/2 = 1353
    expect(label.group.position.x).toBeCloseTo(10);
    expect(label.group.position.y).toBeCloseTo(1353);
    expect(label.group.position.z).toBeCloseTo(20);
  });

  it('non-zero anchor.y is added to HEIGHT (label rises from the anchor, not from y=0)', () => {
    label.setAnchor(new THREE.Vector3(0, 40, 0));
    // 40 + 1305 + 48 = 1393
    expect(label.group.position.y).toBeCloseTo(1393);
  });

  it('HEIGHT=0 places the panel bottom flush with the floor (= anchor.y)', () => {
    REPO_LABEL.setKey('HEIGHT', 0);
    label.refresh();
    label.setAnchor(new THREE.Vector3(0, 0, 0));
    // 0 + 0 + 48 = 48 → panel bottom at 0
    expect(label.group.position.y).toBeCloseTo(48);
  });

  it('refresh() picks up new HEIGHT without a setAnchor call', () => {
    label.setAnchor(new THREE.Vector3(0, 0, 0));
    expect(label.group.position.y).toBeCloseTo(1353);
    REPO_LABEL.setKey('HEIGHT', 500);
    label.refresh();
    // 0 + 500 + 48 = 548
    expect(label.group.position.y).toBeCloseTo(548);
  });

  it('refresh() picks up new FONT_SIZE without a setAnchor call', () => {
    label.setAnchor(new THREE.Vector3(0, 0, 0));
    REPO_LABEL.setKey('FONT_SIZE', 200);
    label.refresh();
    // 0 + 1305 + 100 = 1405
    expect(label.group.position.y).toBeCloseTo(1405);
  });
});
