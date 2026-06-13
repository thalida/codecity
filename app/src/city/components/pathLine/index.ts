// city/components/pathLine/index.ts — the pathLine component.
//
// Self-contained scene component for the neon selection path line (gem →
// selected node, rainbow chasing) and the faded hover-preview path line. The
// inner renderer (./renderer) owns the meshes, the picker-driven geometry
// effects, and a cityState rebuild effect (gemWorldPos + cityRevision).
//
// The inner renderer subscribes to picker.hover/selection + cityState signals
// and needs the canvas, so it is ARMED on the first tick() once
// ctx.picker/ctx.renderer are live, not at construction. The STREETS theme
// effect is settings-only and safe at construction.

import * as THREE from 'three';

import { STREETS } from '@/state/stores/settings/streets';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { onSettings } from '../../utils/onSettings';
import { createPathLineRenderer, type PathLineWorld } from './renderer';

/** World closures the inner renderer consumes (threaded from the composer's
 *  worldAccessor — gemWorldPos is a `let` there; closures evaluate at call
 *  time). The shape
 *  is declared once in ./renderer (PathLineWorld); this is the public alias
 *  the door exposes. */
export type PathLineDeps = PathLineWorld;

/** Public contract for the pathLine component. */
export interface PathLine extends SceneComponent {
  /** Canvas-resize hook — forwards to the two LineMaterial resolutions. */
  onResize(): void;
}

export function createPathLine(ctx: SceneContext, deps: PathLineDeps): PathLine {
  const { cityState } = ctx;
  // Persistent group — added to the scene once. The inner
  // renderer parents its two line meshes into it at arming (draw order is
  // governed by RENDER_ORDERS.PATH_LINE renderOrder, not graph position).
  const group = new THREE.Group();
  group.name = 'city-path-line';

  let _inner: ReturnType<typeof createPathLineRenderer> | null = null;

  // Inner renderer — ARMED on the first tick(), NOT at construction. Its
  // factory creates the two picker-driven geometry effects + the cityState
  // rebuild effect internally, so constructing it at arming
  // (ctx.picker live) is what makes them live; at construction ctx.picker is
  // null and the effects would be permanently dead. armOnFirstTick's sticky
  // armed flag (not `if (_inner)`) survives dispose() nulling _inner, so a
  // stray post-dispose tick() can't re-arm a dead component (same pattern
  // as streets/buildings/fireflies).
  const _arm = armOnFirstTick(
    ctx,
    () => {
      _inner = createPathLineRenderer({
        canvas: ctx.renderer!.domElement,
        scene: group,
        world: deps,
        picker: ctx.picker!,
        cityState,
      });
      return [
        () => {
          _inner?.dispose();
          _inner = null;
        },
      ];
    },
    { needsRenderer: true }
  );

  // STREETS theme effect — reacts to STREETS Save. Replaces applyTheme()'s
  // `pathLineRenderer.refreshMaterials()` (linewidth, opacity, hover color).
  // refreshMaterials internally calls _updateHoverPathLine, which reads
  // picker.hover/selection — run it UNTRACKED so this effect subscribes ONLY
  // to STREETS (same discipline as the streets component's theme effect).
  // Tracks STREETS only — STREET_TIERS changes are Rebuild-routed and today
  // only reach the linewidth at the next applyTheme; tracking TIERS here
  // would be a behavior change. Safe at construction (pre-picker): _inner is
  // null until arming.
  const stopTheme = onSettings(STREETS, () => _inner?.refreshMaterials());

  // tick() — arms the renderer on the first call, then advances the rainbow
  // chase on the selection line (the old renderLoop
  // `pathLineRenderer.update(0)` slot).
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
    // its cityState rebuild effect.
    _arm.dispose();
  }

  return {
    group,
    tick,
    onResize,
    dispose,
  };
}
