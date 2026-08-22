// city/components/pathLine/index.ts — the neon gem-to-selection path line and
// its faded hover preview. The inner renderer owns the meshes and the
// picker-driven effects, so it is armed on the first tick, not at construction.
import * as THREE from 'three';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { onSettings } from '../../utils/onSettings';
import { createPathLineRenderer } from './renderer';

/** Public contract for the pathLine component. */
export interface PathLine extends SceneComponent {
  // Required here, optional on SceneComponent: this one always has a tick, and
  // a caller holding this type shouldn't have to prove it.
  tick(dt: number, ctx: FrameContext): void;
  /** Canvas-resize hook — forwards to the two LineMaterial resolutions. */
  onResize(): void;
}

export function createPathLine(ctx: SceneContext): PathLine {
  const { sceneState } = ctx;
  // Added to the scene once; the renderer parents its meshes in at arming.
  // Draw order comes from RENDER_ORDERS.PATH_LINE, not graph position.
  const group = new THREE.Group();
  group.name = 'city-path-line';

  let _inner: ReturnType<typeof createPathLineRenderer> | null = null;

  // Armed on first tick, not at construction: ctx.picker is null then and the
  // renderer's effects would be born dead. The sticky flag survives dispose.
  const _arm = armOnFirstTick(ctx, () => {
    _inner = createPathLineRenderer({
      streets: ctx.config.STREETS,
      streetTiers: ctx.config.STREET_TIERS,
      canvas: ctx.canvas,
      scene: group,
      picker: ctx.picker!,
      sceneState,
    });
    return [
      () => {
        _inner?.dispose();
        _inner = null;
      },
    ];
  });

  // untracked, because refreshMaterials reads picker.hover/selection and this
  // effect must subscribe to STREETS alone.
  const stopTheme = onSettings(ctx.config.STREETS, () => _inner?.refreshMaterials());

  // tick() — arms the renderer on the first call, then advances the rainbow
  // chase on the selection line.
  function tick(_dt: number, _frame: FrameContext): void {
    _arm.arm();
    _inner?.update(0);
  }

  function onResize(): void {
    _inner?.onResize();
  }

  function dispose(): void {
    stopTheme();
    // Inner dispose (run via _arm's teardown) also stops its picker effects +
    // its sceneState rebuild effect.
    _arm.dispose();
  }

  return {
    group,
    tick,
    onResize,
    dispose,
  };
}
