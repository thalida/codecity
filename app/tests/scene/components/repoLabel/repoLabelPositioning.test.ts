import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRepoLabel } from '@/scene/components/repoLabel/repoLabel';
import { REPO_LABEL } from '@/state/settings/components/repoLabel';
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

// group.position.y = anchor.y + heightWorld + FONT_SIZE / 2
// where heightWorld = MAX_FLOORS × FLOOR_HEIGHT × HEIGHT_PCT / 100
//                   = 96 × 16 × HEIGHT_PCT / 100 = 1536 × HEIGHT_PCT / 100
// (panel center floats heightWorld + FONT_SIZE/2 above the floor; panel
// bottom sits at heightWorld above the floor)

describe('RepoLabel positioning', () => {
  let label: ReturnType<typeof createRepoLabel>;
  beforeEach(() => {
    resetStore();
    label = createRepoLabel();
    label.setRepoName('codecity');
  });
  afterEach(() => label.dispose());

  it('default config places panel center at anchor.y + heightWorld + FONT_SIZE/2', () => {
    label.setAnchor(new THREE.Vector3(10, 0, 20));
    // heightWorld = 1536 × 85/100 = 1305.6; panel center = 0 + 1305.6 + 64 = 1369.6
    expect(label.group.position.x).toBeCloseTo(10);
    expect(label.group.position.y).toBeCloseTo(1369.6);
    expect(label.group.position.z).toBeCloseTo(20);
  });

  it('non-zero anchor.y is added to heightWorld (label rises from the anchor, not from y=0)', () => {
    label.setAnchor(new THREE.Vector3(0, 40, 0));
    // 40 + 1305.6 + 64 = 1409.6
    expect(label.group.position.y).toBeCloseTo(1409.6);
  });

  it('HEIGHT_PCT=0 places the panel bottom flush with the floor (= anchor.y)', () => {
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 0 };
    label.refresh();
    label.setAnchor(new THREE.Vector3(0, 0, 0));
    // heightWorld = 0; panel center = 0 + 0 + 64 = 64 → panel bottom at 0
    expect(label.group.position.y).toBeCloseTo(64);
  });

  it('refresh() picks up new HEIGHT_PCT without a setAnchor call', () => {
    label.setAnchor(new THREE.Vector3(0, 0, 0));
    expect(label.group.position.y).toBeCloseTo(1369.6);
    // HEIGHT_PCT=50 → heightWorld = 1536 × 50/100 = 768
    REPO_LABEL.value = { ...REPO_LABEL.value, HEIGHT_PCT: 50 };
    label.refresh();
    // 0 + 768 + 64 = 832
    expect(label.group.position.y).toBeCloseTo(832);
  });

  it('refresh() picks up new FONT_SIZE without a setAnchor call', () => {
    label.setAnchor(new THREE.Vector3(0, 0, 0));
    REPO_LABEL.value = { ...REPO_LABEL.value, FONT_SIZE: 200 };
    label.refresh();
    // 0 + 1305.6 + 100 = 1405.6
    expect(label.group.position.y).toBeCloseTo(1405.6);
  });
});
