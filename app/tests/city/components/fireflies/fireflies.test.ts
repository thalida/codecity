import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFireflyAssembly } from '@/city/components/fireflies/fireflies';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import type { CommitEntry } from '@/types';
import { commitStats } from '../../../_helpers/statsFixtures';
import type { TreePlacement } from '@/city/components/trees/treePlacement';

const COMMITS: CommitEntry[] = [
  {
    date: '2026-01-01',
    files: 1,
    sha: 'a'.repeat(40),
    authors: ['Alice'],
    subject: 'a',
    same_day_total: 1,
  },
];

const PLACEMENTS: TreePlacement[] = [{ x: 0, y: 0, commitIndex: 0, seed: 0 } as TreePlacement];

function ringMeshes(f: ReturnType<typeof createFireflyAssembly>): THREE.Mesh[] {
  const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
  if (!ringGroup) return [];
  return ringGroup.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);
}

describe('createFireflyAssembly', () => {
  it('returns a group containing one InstancedMesh (orbs) and an empty ring group when commits is non-empty', () => {
    const stats = commitStats(COMMITS);
    const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats);
    expect(f.group).toBeInstanceOf(THREE.Group);
    // The parent group has two child Groups (rings + renderer).
    // The ring group is lazy: it starts empty and only spawns meshes on
    // hover/select. The renderer group contains one InstancedMesh.
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const tubeMeshes = allDescendants.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
    );
    expect(instancedMeshes.length).toBe(1);
    expect(tubeMeshes.length).toBe(0);
    f.dispose();
  });

  it('returns a group with no descendant InstancedMeshes when commits is null', () => {
    const f = createFireflyAssembly(PLACEMENTS, null, null);
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('returns a group with no descendant InstancedMeshes when placements is empty', () => {
    const f = createFireflyAssembly([], COMMITS, commitStats(COMMITS));
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('dispose() removes all descendant InstancedMeshes and tube Meshes', () => {
    const stats = commitStats(COMMITS);
    const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats);
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
      const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats);
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
      const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats);
      const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
      // The group exists but has no mesh children when disabled.
      expect(ringGroup).toBeDefined();
      expect(ringGroup!.children.length).toBe(0);
      f.dispose();
    } finally {
      FIREFLIES.value = { ...FIREFLIES.value, ORBIT_RING_ENABLED: orig };
    }
  });

  it("setHoveredCommit shows one ring mesh tinted with the author's pastel color", async () => {
    const { lightColorForAuthor } = await import('@/city/components/fireflies/authorColor.js');
    const stats = commitStats(COMMITS);
    const f = createFireflyAssembly(PLACEMENTS, COMMITS, stats);
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
