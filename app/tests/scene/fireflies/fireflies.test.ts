import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFireflies } from '@/scene/components/fireflies/fireflies';
import { FIREFLIES } from '@/state/settings/fireflies';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement';

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), authors: ['Alice'], subject: 'a', same_day_total: 1 },
];

const PLACEMENTS: TreePlacement[] = [{ x: 0, y: 0, commitIndex: 0, seed: 0 } as TreePlacement];

function ringMeshes(f: ReturnType<typeof createFireflies>): THREE.Mesh[] {
  const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
  if (!ringGroup) return [];
  return ringGroup.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);
}

describe('createFireflies', () => {
  it('returns a group containing one InstancedMesh (orbs) and an empty ring group when commits is non-empty', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
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
    const f = createFireflies(PLACEMENTS, null);
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('returns a group with no descendant InstancedMeshes when placements is empty', () => {
    const f = createFireflies([], COMMITS);
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('dispose() removes all descendant InstancedMeshes and tube Meshes', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.dispose();
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const tubeMeshes = allDescendants.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
    );
    expect(instancedMeshes.length).toBe(0);
    expect(tubeMeshes.length).toBe(0);
  });

  it('setTime(t) is a no-op when the group is empty (no instances)', () => {
    const f = createFireflies([], COMMITS);
    expect(() => f.setTime(1.0)).not.toThrow();
    f.dispose();
  });

  it('exposes setHoveredCommit and setSelectedCommit methods', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    expect(typeof f.setHoveredCommit).toBe('function');
    expect(typeof f.setSelectedCommit).toBe('function');
    // No-throw on null + valid SHA.
    expect(() => f.setHoveredCommit(null)).not.toThrow();
    expect(() => f.setHoveredCommit(COMMITS[0].sha)).not.toThrow();
    expect(() => f.setSelectedCommit(null)).not.toThrow();
    expect(() => f.setSelectedCommit(COMMITS[0].sha)).not.toThrow();
    f.dispose();
  });

  it("empty renderer's setHoveredCommit and setSelectedCommit are no-ops", () => {
    const f = createFireflies([], COMMITS);
    expect(() => f.setHoveredCommit('abc')).not.toThrow();
    expect(() => f.setSelectedCommit('abc')).not.toThrow();
    f.dispose();
  });

  it('returns an empty group when ENABLED is false', () => {
    const orig = FIREFLIES.value.ENABLED;
    FIREFLIES.value = { ...FIREFLIES.value, ENABLED: false };
    try {
      const f = createFireflies(PLACEMENTS, COMMITS);
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
      const f = createFireflies(PLACEMENTS, COMMITS);
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
    const { lightColorForAuthor } = await import('@/scene/components/fireflies/authorColor.js');
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    const ms = ringMeshes(f);
    expect(ms.length).toBe(1);
    // Hover meshes carry per-mesh materials colored as the author's lightRgb,
    // not a shared config color. vertexColors stays false on hover.
    const mat = ms[0].material as THREE.MeshBasicMaterial;
    expect(mat.vertexColors).toBe(false);
    const expected = lightColorForAuthor(COMMITS[0].authors[0]).rgb;
    expect(mat.color.r).toBeCloseTo(expected[0], 3);
    expect(mat.color.g).toBeCloseTo(expected[1], 3);
    expect(mat.color.b).toBeCloseTo(expected[2], 3);
    f.dispose();
  });

  it('selected and hovered on the same commit shows only the selected mesh (rainbow vertex colors)', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    f.setSelectedCommit(COMMITS[0].sha);
    const ms = ringMeshes(f);
    expect(ms.length).toBe(1);
    // Selected uses the shared vertexColors: true material; the static
    // `.color` field is unused for selected rings.
    expect((ms[0].material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
    f.dispose();
  });

  it('deselecting while still hovered restores the hover ring', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    f.setSelectedCommit(COMMITS[0].sha);
    f.setSelectedCommit(null);
    const ms = ringMeshes(f);
    expect(ms.length).toBe(1);
    // The restored mesh is a hover mesh (per-mesh material, vertexColors off).
    expect((ms[0].material as THREE.MeshBasicMaterial).vertexColors).toBe(false);
    f.dispose();
  });

  it('clearing hover with no selection leaves the ring group empty', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    f.setHoveredCommit(null);
    expect(ringMeshes(f).length).toBe(0);
    f.dispose();
  });
});
