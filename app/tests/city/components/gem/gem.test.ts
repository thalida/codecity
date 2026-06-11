import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { signal } from '@preact/signals';

import { createGem } from '@/city/components/gem';
import { GEM } from '@/state/stores/settings/gem';
import { NodeKind, StreetAxis } from '@/types';
import type { Street, PickTarget } from '@/types';
import type { Picker } from '@/city/render/picker';
import type { SceneContext } from '@/city/types';

// Minimal root Street fixture (X-oriented). Cast through unknown since the
// gem only reads geometry fields (x/y/width/length/orientation).
function makeStreet(): Street {
  return {
    x: 100,
    y: 40,
    width: 20,
    length: 400,
    orientation: StreetAxis.X,
    isRoot: true,
    dir: { name: 'root', path: '', type: NodeKind.Directory },
  } as unknown as Street;
}

// Build a SceneContext whose picker exposes a controllable hover signal.
function makeCtx(hover: PickTarget | null): {
  ctx: SceneContext;
  hover: ReturnType<typeof signal<PickTarget | null>>;
} {
  const hoverSig = signal<PickTarget | null>(hover);
  const ctx = {
    scene: new THREE.Scene(),
    picker: { hover: hoverSig } as unknown as Picker,
    camera: new THREE.PerspectiveCamera(),
    renderer: null as unknown as THREE.WebGLRenderer,
  } as SceneContext;
  return { ctx, hover: hoverSig };
}

describe('createGem()', () => {
  let gem: ReturnType<typeof createGem> | null = null;

  afterEach(() => {
    gem?.dispose();
    gem = null;
  });

  it('constructs with an UNPOPULATED picker (ctx.picker=null) and its effect runs', () => {
    // Bridge-safety: world builds the gem before the picker exists. The theme
    // effect must run at construction reading only GEM/BLOOM signals.
    const ctx = {
      scene: new THREE.Scene(),
      picker: null as unknown as Picker,
      camera: null as unknown as THREE.PerspectiveCamera,
      renderer: null as unknown as THREE.WebGLRenderer,
    } as unknown as SceneContext;
    expect(() => {
      gem = createGem(ctx);
      // Mutating GEM re-runs the effect; must not throw with null refs.
      GEM.value = { ...GEM.value };
    }).not.toThrow();
    expect(gem!.gem).toBeNull();
  });

  it('rebuild(street) builds an inner gem with a Gem-typed body and per-face color attribute', () => {
    const { ctx } = makeCtx(null);
    gem = createGem(ctx);
    gem.rebuild(makeStreet());

    expect(gem.gem).toBeInstanceOf(THREE.Group);
    const body = gem.gem!.userData.body as THREE.Mesh;
    expect(body).toBeDefined();
    expect(body.userData.type).toBe(NodeKind.Gem);
    expect(body.geometry.attributes.color).toBeDefined();
    // The inner gem is parented under the component's outer group.
    expect(gem.gem!.parent).toBe(gem.group);
    // worldPos is the floor anchor (y=0) of the root street's origin cap.
    expect(gem.worldPos).toBeInstanceOf(THREE.Vector3);
    expect(gem.worldPos!.y).toBe(0);
  });

  it('rebuild disposes the prior inner gem and swaps in the new one', () => {
    const { ctx } = makeCtx(null);
    gem = createGem(ctx);
    gem.rebuild(makeStreet());
    const first = gem.gem!;
    gem.rebuild(makeStreet());
    expect(gem.gem).not.toBe(first);
    expect(first.parent).toBeNull();
    expect(gem.group.children).toContain(gem.gem);
  });

  it('tick lerps gem.scale toward HOVER_SCALE when a Gem is hovered', () => {
    const { ctx } = makeCtx({ kind: NodeKind.Gem } as PickTarget);
    gem = createGem(ctx);
    gem.rebuild(makeStreet());

    const start = gem.gem!.scale.x;
    expect(start).toBe(1);
    for (let i = 0; i < 5; i++)
      gem.tick!(0.016, { dt: 0.016, time: i * 0.016, camera: ctx.camera });
    // HOVER_SCALE default is 1.25; scale should have moved up toward it.
    expect(gem.gem!.scale.x).toBeGreaterThan(start);
    expect(gem.gem!.scale.x).toBeLessThanOrEqual(GEM.value.HOVER_SCALE + 1e-6);
  });

  it('dispose() stops the effect — later GEM mutations do not throw', () => {
    const { ctx } = makeCtx(null);
    gem = createGem(ctx);
    gem.rebuild(makeStreet());
    gem.dispose();
    gem = null;
    expect(() => {
      GEM.value = { ...GEM.value, EDGE_COLOR: '#abcdef' };
    }).not.toThrow();
  });
});
