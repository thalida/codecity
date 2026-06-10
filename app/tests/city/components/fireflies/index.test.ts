// app/tests/city/components/fireflies/index.test.ts
//
// Tests for the persistent createFireflies(ctx) component (door).
// API: createFireflies(ctx) → { group, rebuild(placements, commits),
//      clear(), handle(), tick(dt, frame), onResize(w, h), dispose() }.
//
// FIREFLIES settings reactivity (bob/pulse/emission uniforms) is owned by
// the component's theme effect; the hover/select boost effects are
// picker-driven and ARMED on the first tick() (NOT at construction —
// ctx.picker is null there, so they'd track no signal and never re-fire).
// The rebuild-survival test guards the dynamic-_inner contract: the effect
// bodies must reach the CURRENT inner renderer after a rebuild, exactly like
// the old renderLoop effects re-fetched world.getFireflies() each fire.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';

import { createFireflies } from '@/city/components/fireflies';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import { NodeKind } from '@/types';
import type { CommitEntry } from '@/types';
import type { PickTarget } from '@/types/picker';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import type { Picker } from '@/city/runtime/picker';
import type { SceneContext } from '@/city/types';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: SHA_A, authors: ['Alice'], subject: 'a', same_day_total: 1 },
  { date: '2026-01-02', files: 1, sha: SHA_B, authors: ['Bob'], subject: 'b', same_day_total: 1 },
];

const PLACEMENTS: TreePlacement[] = [{ x: 0, y: 0, seed: 0, commitIndex: 0 } as TreePlacement];

const _origFireflies = FIREFLIES.value;

function makeCtx(): {
  ctx: SceneContext;
  selection: ReturnType<typeof signal<PickTarget | null>>;
  hover: ReturnType<typeof signal<PickTarget | null>>;
} {
  const selection = signal<PickTarget | null>(null);
  const hover = signal<PickTarget | null>(null);
  const ctx = {
    scene: new THREE.Scene(),
    picker: { selection, hover } as unknown as Picker,
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: document.createElement('canvas') } as unknown as THREE.WebGLRenderer,
  } as SceneContext;
  return { ctx, selection, hover };
}

function makePrePickerCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    picker: null as unknown as Picker,
    camera: null as unknown as THREE.PerspectiveCamera,
    renderer: null as unknown as THREE.WebGLRenderer,
  } as unknown as SceneContext;
}

function commitTarget(sha: string): PickTarget {
  return {
    kind: NodeKind.Commit,
    mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
    instanceId: 0,
    commit: { sha, date: '2026-01-01', files: 1, authors: ['Alice'], subject: 'a' },
  } as unknown as PickTarget;
}

// Reach the orb shader uniforms through the inner assembly's InstancedMesh.
function orbUniforms(comp: ReturnType<typeof createFireflies>): Record<string, { value: number }> {
  let mesh: THREE.InstancedMesh | null = null;
  comp.group.traverse((obj) => {
    if (obj.name === 'fireflies-orbs') mesh = obj as THREE.InstancedMesh;
  });
  if (!mesh) throw new Error("expected 'fireflies-orbs' InstancedMesh under the group");
  return ((mesh as THREE.InstancedMesh).material as THREE.ShaderMaterial).uniforms as Record<
    string,
    { value: number }
  >;
}

const FRAME = (camera: THREE.PerspectiveCamera, time = 0) => ({ dt: 0, time, camera });

describe('createFireflies() component door', () => {
  let comp: ReturnType<typeof createFireflies>;

  beforeEach(() => {
    FIREFLIES.value = { ..._origFireflies };
  });

  afterEach(() => {
    comp?.dispose();
    FIREFLIES.value = { ..._origFireflies };
  });

  it('constructs with an empty named group and a null handle; theme effect safe pre-picker', () => {
    expect(() => {
      comp = createFireflies(makePrePickerCtx());
      FIREFLIES.value = { ...FIREFLIES.value };
    }).not.toThrow();
    expect(comp.group.name).toBe('city-fireflies');
    expect(comp.group.children).toHaveLength(0);
    expect(comp.handle()).toBeNull();
  });

  it('rebuild() builds the inner assembly under the group; clear() empties + nulls', () => {
    const { ctx } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    expect(comp.handle()).not.toBeNull();
    expect(comp.handle()!.group.parent).toBe(comp.group);
    expect(orbUniforms(comp).uTime.value).toBe(0);

    comp.clear();
    expect(comp.handle()).toBeNull();
    expect(comp.group.children).toHaveLength(0);
    expect(() => comp.clear()).not.toThrow(); // idempotent
  });

  it('rebuild() disposes the prior assembly (no accumulation)', () => {
    const { ctx } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    const first = comp.handle()!;
    comp.rebuild(PLACEMENTS, COMMITS);
    expect(comp.handle()).not.toBe(first);
    expect(first.group.parent).toBeNull();
    expect(comp.group.children).toHaveLength(1);
  });

  it('theme effect pushes fresh animation uniforms on FIREFLIES Save', () => {
    const { ctx } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    const u = orbUniforms(comp);
    FIREFLIES.value = { ...FIREFLIES.value, BOB_AMPLITUDE: 7.25 };
    expect(u.uBobAmp.value).toBeCloseTo(7.25, 5);
  });

  it('tick() writes frame.time into the bob uTime uniform', () => {
    const { ctx } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    comp.tick(0, FRAME(ctx.camera, 4.5));
    expect(orbUniforms(comp).uTime.value).toBeCloseTo(4.5, 5);
  });

  it('does NOT boost a hover set before the first tick; arming pushes it in', () => {
    const { ctx, hover } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    const u = orbUniforms(comp);

    // Hover set BEFORE any tick — effects aren't armed, uniform untouched.
    hover.value = commitTarget(SHA_A);
    expect(u.uHoveredCommit.value).toBe(-1);

    // First tick arms the effects; their initial run reads the live hover.
    comp.tick(0, FRAME(ctx.camera));
    expect(u.uHoveredCommit.value).toBe(0);

    // Clearing hover resets the boost (live, synchronous effect).
    hover.value = null;
    expect(u.uHoveredCommit.value).toBe(-1);
  });

  it('select boost follows picker.selection after arming', () => {
    const { ctx, selection } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    comp.tick(0, FRAME(ctx.camera));
    const u = orbUniforms(comp);
    expect(u.uSelectedCommit.value).toBe(-1);
    selection.value = commitTarget(SHA_B);
    expect(u.uSelectedCommit.value).toBe(1);
    selection.value = null;
    expect(u.uSelectedCommit.value).toBe(-1);
  });

  it('REBUILD-SURVIVAL: boost effects reach the NEW inner on the next signal change', () => {
    const { ctx, hover } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    comp.tick(0, FRAME(ctx.camera)); // arm
    hover.value = commitTarget(SHA_A);
    expect(orbUniforms(comp).uHoveredCommit.value).toBe(0);

    // Rebuild: the fresh renderer starts with -1 uniforms (rebuild does NOT
    // push current hover/selection — behavior-identical to the old flow).
    comp.rebuild(PLACEMENTS, COMMITS);
    const u = orbUniforms(comp);
    expect(u.uHoveredCommit.value).toBe(-1);

    // The NEXT hover change pushes into the NEW inner (dynamic _inner read).
    hover.value = commitTarget(SHA_B);
    expect(u.uHoveredCommit.value).toBe(1);
  });

  it('onResize(w, h) forwards to the inner assembly', () => {
    const { ctx } = makeCtx();
    comp = createFireflies(ctx);
    expect(() => comp.onResize(800, 600)).not.toThrow(); // null inner → no-op
    comp.rebuild(PLACEMENTS, COMMITS);
    const spy = vi.spyOn(comp.handle()!, 'onResize');
    comp.onResize(1024, 768);
    expect(spy).toHaveBeenCalledWith(1024, 768);
  });

  it('dispose() empties the group and stops all effects', () => {
    const { ctx, hover } = makeCtx();
    comp = createFireflies(ctx);
    comp.rebuild(PLACEMENTS, COMMITS);
    comp.tick(0, FRAME(ctx.camera)); // arm
    comp.dispose();
    expect(comp.handle()).toBeNull();
    expect(comp.group.children).toHaveLength(0);
    expect(() => {
      hover.value = commitTarget(SHA_A);
      FIREFLIES.value = { ...FIREFLIES.value, BOB_AMPLITUDE: 1.5 };
    }).not.toThrow();
  });
});
