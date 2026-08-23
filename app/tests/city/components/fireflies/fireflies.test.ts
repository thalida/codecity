import { TREES } from '@/state/settings/fields/trees';
import { RAINBOW } from '@/state/settings/fields/effects';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFireflyAssembly } from '@/city/components/fireflies/fireflies';
import { FIREFLIES } from '@/state/settings/fields/fireflies';
import { ORBIT_RINGS_GROUP } from '@/city/components/fireflies/orbitRings';
import { lightColorForAuthor } from '@/city/components/fireflies/authorColor';
import { commits as buildCommits } from '../../../_helpers/commits';
import { commitStats } from '../../../_helpers/statsFixtures';
import { treePlacement } from '../../../_helpers/cityFixtures';
import { childGroup, meshesInChildGroup } from '../../../_helpers/sceneGraph';

const COMMITS = buildCommits({ date: '2026-01-01', files: 1, authors: ['Alice'] });
const PLACEMENTS = [treePlacement(0)];

const ringMeshes = (f: { group: THREE.Object3D }) => meshesInChildGroup(f.group, ORBIT_RINGS_GROUP);

describe('createFireflyAssembly', () => {
  it('returns a group containing one Points draw (orbs) and an empty ring group when commits is non-empty', () => {
    const stats = commitStats(COMMITS);
    const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats, null, FIREFLIES, TREES, RAINBOW);
    expect(f.group).toBeInstanceOf(THREE.Group);
    // Two child Groups: the lazy ring group (empty until hover/select) and
    // the renderer's, holding one Points object.
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const orbPoints = allDescendants.filter((c) => c instanceof THREE.Points);
    const tubeMeshes = allDescendants.filter((c) => c instanceof THREE.Mesh);
    expect(orbPoints.length).toBe(1);
    expect(tubeMeshes.length).toBe(0);
    f.dispose();
  });

  it('returns a group with no descendant orb draws when commits is null', () => {
    const f = createFireflyAssembly(PLACEMENTS, null, null, null, FIREFLIES, TREES, RAINBOW);
    const orbs = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.Points);
    expect(orbs.length).toBe(0);
    f.dispose();
  });

  it('returns a group with no descendant InstancedMeshes when placements is empty', () => {
    const f = createFireflyAssembly(
      [],
      COMMITS,
      commitStats(COMMITS),
      null,
      FIREFLIES,
      TREES,
      RAINBOW
    );
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('dispose() removes all descendant InstancedMeshes and tube Meshes', () => {
    const stats = commitStats(COMMITS);
    const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats, null, FIREFLIES, TREES, RAINBOW);
    f.dispose();
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const tubeMeshes = allDescendants.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
    );
    expect(instancedMeshes.length).toBe(0);
    expect(tubeMeshes.length).toBe(0);
  });

  it('returns an empty group when ENABLED is false', () => {
    const orig = FIREFLIES.value.ENABLED;
    FIREFLIES.value = { ...FIREFLIES.value, ENABLED: false };
    try {
      const stats = commitStats(COMMITS);
      const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats, null, FIREFLIES, TREES, RAINBOW);
      expect(f.group.children.length).toBe(0);
      f.dispose();
    } finally {
      FIREFLIES.value = { ...FIREFLIES.value, ENABLED: orig };
    }
  });

  it('orbit ring is absent when ORBIT_RING_ENABLED is false', () => {
    const orig = FIREFLIES.value.ORBIT_RING_ENABLED;
    FIREFLIES.value = { ...FIREFLIES.value, ORBIT_RING_ENABLED: false };
    try {
      const stats = commitStats(COMMITS);
      const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats, null, FIREFLIES, TREES, RAINBOW);
      // The group is still built, it just holds no meshes.
      expect(childGroup(f.group, ORBIT_RINGS_GROUP)).not.toBeNull();
      expect(ringMeshes(f)).toHaveLength(0);
      f.dispose();
    } finally {
      FIREFLIES.value = { ...FIREFLIES.value, ORBIT_RING_ENABLED: orig };
    }
  });

  it("setHoveredCommit shows one ring mesh tinted with the author's pastel color", () => {
    const stats = commitStats(COMMITS);
    const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats, null, FIREFLIES, TREES, RAINBOW);
    f.setHoveredCommit(COMMITS[0].sha);
    const ms = ringMeshes(f);
    expect(ms.length).toBe(1);
    // Hover meshes carry per-mesh materials colored as the author's lightRgb,
    // not a shared config color. vertexColors stays false on hover.
    const mat = ms[0].material as THREE.MeshBasicMaterial;
    expect(mat.vertexColors).toBe(false);
    const hue = stats.authors.find((a) => a.name === COMMITS[0].authors[0])!.hue;
    const expected = lightColorForAuthor(hue).rgb;
    expect(mat.color.r).toBeCloseTo(expected[0], 3);
    expect(mat.color.g).toBeCloseTo(expected[1], 3);
    expect(mat.color.b).toBeCloseTo(expected[2], 3);
    f.dispose();
  });
});
