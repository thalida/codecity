// createCityScene builds fireflies before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

import { createFireflies } from '@/city/scene/components/fireflies';
import { FIREFLY_ORBS_MESH } from '@/city/scene/components/fireflies/firefliesRenderer';
import {
  commitTarget,
  makePickableSceneContext,
  makePrePickerSceneContext,
  treePlacement,
} from '../../../../_helpers/cityFixtures';
import { FIREFLIES } from '@/city/session/settings/fireflies';
import { commits as buildCommits } from '../../../../_helpers/commits';
import { commitStats } from '../../../../_helpers/statsFixtures';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const COMMITS = buildCommits(
  { date: '2026-01-01', files: 1, sha: SHA_A, authors: ['Alice'] },
  { date: '2026-01-02', files: 1, sha: SHA_B, authors: ['Bob'] }
);
const PLACEMENTS = [treePlacement(0)];

const _origFireflies = FIREFLIES.value;

// Reach the orb shader uniforms through the inner assembly's Points draw.
function orbUniforms(comp: ReturnType<typeof createFireflies>): Record<string, { value: number }> {
  let orbPoints: THREE.Points | null = null;
  comp.group.traverse((obj) => {
    if (obj.name === FIREFLY_ORBS_MESH) orbPoints = obj as THREE.Points;
  });
  if (!orbPoints) throw new Error(`expected ${FIREFLY_ORBS_MESH} Points under the group`);
  return ((orbPoints as THREE.Points).material as THREE.ShaderMaterial).uniforms as Record<
    string,
    { value: number }
  >;
}

const CAMERA = new THREE.PerspectiveCamera();
const FRAME = (camera: THREE.PerspectiveCamera = CAMERA, time = 0) => ({ dt: 0, time, camera });

describe('createFireflies() component door', () => {
  let comp: ReturnType<typeof createFireflies>;

  beforeEach(() => {
    FIREFLIES.value = { ..._origFireflies };
  });

  afterEach(() => {
    comp?.dispose();
    FIREFLIES.value = { ..._origFireflies };
  });

  it('constructs an empty named group, and the theme effect is inert pre-picker', () => {
    comp = createFireflies(makePrePickerSceneContext());
    FIREFLIES.value = { ...FIREFLIES.value };
    expect(comp.group.name).toBe('city-fireflies');
    expect(comp.group.children).toHaveLength(0);
  });

  it('rebuild() builds the inner assembly under the group; clear() empties + nulls', () => {
    const { ctx } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    // The inner assembly's group is the sole child of the component group.
    expect(comp.group.children).toHaveLength(1);
    expect(orbUniforms(comp).uTime.value).toBe(0);

    comp.clear();
    expect(comp.group.children).toHaveLength(0);

    comp.clear(); // idempotent: a second clear leaves the same state
    expect(comp.group.children).toHaveLength(0);
  });

  it('rebuild() disposes the prior assembly (no accumulation)', () => {
    const { ctx } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    const first = comp.group.children[0];
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    expect(comp.group.children[0]).not.toBe(first);
    expect(first.parent).toBeNull();
    expect(comp.group.children).toHaveLength(1);
  });

  it('theme effect pushes fresh animation uniforms on FIREFLIES Save', () => {
    const { ctx } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    const u = orbUniforms(comp);
    FIREFLIES.value = { ...FIREFLIES.value, BOB_AMPLITUDE: 7.25 };
    expect(u.uBobAmp.value).toBeCloseTo(7.25, 5);
  });

  it('tick() writes frame.time into the bob uTime uniform', () => {
    const { ctx } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    comp.tick(0, FRAME(CAMERA, 4.5));
    expect(orbUniforms(comp).uTime.value).toBeCloseTo(4.5, 5);
  });

  it('does NOT boost a hover set before the first tick; arming pushes it in', () => {
    const { ctx, hover } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    const u = orbUniforms(comp);

    // Hover set BEFORE any tick — effects aren't armed, uniform untouched.
    hover.value = commitTarget(SHA_A);
    expect(u.uHoveredCommit.value).toBe(-1);

    // First tick arms the effects; their initial run reads the live hover.
    comp.tick(0, FRAME(CAMERA));
    expect(u.uHoveredCommit.value).toBe(0);

    // Clearing hover resets the boost (live, synchronous effect).
    hover.value = null;
    expect(u.uHoveredCommit.value).toBe(-1);
  });

  it('select boost follows picker.selection after arming', () => {
    const { ctx, selection } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    comp.tick(0, FRAME(CAMERA));
    const u = orbUniforms(comp);
    expect(u.uSelectedCommit.value).toBe(-1);
    selection.value = commitTarget(SHA_B);
    expect(u.uSelectedCommit.value).toBe(1);
    selection.value = null;
    expect(u.uSelectedCommit.value).toBe(-1);
  });

  it('REBUILD-SURVIVAL: boost effects reach the NEW inner on the next signal change', () => {
    const { ctx, hover } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    comp.tick(0, FRAME(CAMERA)); // arm
    hover.value = commitTarget(SHA_A);
    expect(orbUniforms(comp).uHoveredCommit.value).toBe(0);

    // Rebuild: the fresh renderer starts with -1 uniforms (rebuild does NOT
    // push current hover/selection — behavior-identical to the old flow).
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    const u = orbUniforms(comp);
    expect(u.uHoveredCommit.value).toBe(-1);

    // The NEXT hover change pushes into the NEW inner (dynamic _inner read).
    hover.value = commitTarget(SHA_B);
    expect(u.uHoveredCommit.value).toBe(1);
  });

  it('onResize before rebuild is a no-op, not a crash', () => {
    // A window resize can land while the city is still loading, before there
    // is an inner assembly to forward to.
    const { ctx } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.onResize(800, 600);
    expect(comp.group.children).toHaveLength(0);
  });

  it('dispose() empties the group and stops all effects', () => {
    const { ctx, hover } = makePickableSceneContext();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS, commitStats(COMMITS));
    comp.tick(0, FRAME(CAMERA)); // arm
    comp.dispose();
    expect(comp.group.children).toHaveLength(0);
    expect(() => {
      hover.value = commitTarget(SHA_A);
      FIREFLIES.value = { ...FIREFLIES.value, BOB_AMPLITUDE: 1.5 };
    }).not.toThrow();
  });
});
