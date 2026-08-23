import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

import { createGem } from '@/city/scene/components/gem';
import {
  makePickableSceneContext,
  makePrePickerSceneContext,
} from '../../../../_helpers/cityFixtures';
import { GEM } from '@/city/session/settings/gem';
import { NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';
import type { PickTarget } from '@/city/scene/types/picker';

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
    dir: { name: 'root', path: '.', type: NodeKind.Directory },
  } as unknown as Street;
}

// Build a SceneContext whose picker exposes a controllable hover signal.

const CAMERA = new THREE.PerspectiveCamera();

describe('createGem()', () => {
  let gem: ReturnType<typeof createGem> | null = null;

  afterEach(() => {
    gem?.dispose();
    gem = null;
  });

  it('constructs with an UNPOPULATED picker (ctx.picker=null) and its effect runs', () => {
    // Bridge-safety: world builds the gem before the picker exists. The theme
    // effect must run at construction reading only GEM/BLOOM signals.
    const ctx = makePrePickerSceneContext();
    expect(() => {
      gem = createGem(ctx);
      // Mutating GEM re-runs the effect; must not throw with null refs.
      GEM.value = { ...GEM.value };
    }).not.toThrow();
    expect(gem!.getRootGroup()).toBeNull();
  });

  it('rebuild(street) builds an inner gem with a Gem-typed body and per-face color attribute', () => {
    const { ctx } = makePickableSceneContext();
    gem = createGem(ctx);
    gem.rebuild(makeStreet());

    expect(gem.getRootGroup()).toBeInstanceOf(THREE.Group);
    const body = gem.getRootGroup()!.userData.body as THREE.Mesh;
    expect(body).toBeDefined();
    expect(body.userData.type).toBe(NodeKind.Gem);
    expect(body.geometry.attributes.color).toBeDefined();
    // The inner gem is parented under the component's outer group.
    expect(gem.getRootGroup()!.parent).toBe(gem.group);
  });

  it('rebuild disposes the prior inner gem and swaps in the new one', () => {
    const { ctx } = makePickableSceneContext();
    gem = createGem(ctx);
    gem.rebuild(makeStreet());
    const first = gem.getRootGroup()!;
    gem.rebuild(makeStreet());
    expect(gem.getRootGroup()).not.toBe(first);
    expect(first.parent).toBeNull();
    expect(gem.group.children).toContain(gem.getRootGroup());
  });

  it('tick lerps gem.scale toward HOVER_SCALE when a Gem is hovered', () => {
    const { ctx, hover } = makePickableSceneContext();
    hover.value = { kind: NodeKind.Gem } as PickTarget;
    gem = createGem(ctx);
    gem.rebuild(makeStreet());

    const start = gem.getRootGroup()!.scale.x;
    expect(start).toBe(1);
    for (let i = 0; i < 5; i++) gem.tick!(0.016, { dt: 0.016, time: i * 0.016, camera: CAMERA });
    // HOVER_SCALE default is 1.25; scale should have moved up toward it.
    expect(gem.getRootGroup()!.scale.x).toBeGreaterThan(start);
    expect(gem.getRootGroup()!.scale.x).toBeLessThanOrEqual(GEM.value.HOVER_SCALE + 1e-6);
  });

  // This pins the guards, not the teardown: dispose nulls edges/body, so a
  // leaked effect would be absorbed and look identical from here.
  it('a GEM mutation after dispose() is absorbed by the null guards', () => {
    const { ctx } = makePickableSceneContext();
    gem = createGem(ctx);
    gem.rebuild(makeStreet());
    gem.dispose();
    gem = null;
    expect(() => {
      GEM.value = { ...GEM.value, EDGE_COLOR: '#abcdef' };
    }).not.toThrow();
  });
});
