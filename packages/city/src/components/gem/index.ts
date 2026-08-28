// city/components/gem/index.ts — the root gem component: rebuilds the inner
// mesh off cityState.rootStreet, repaints on GEM Saves, animates in tick().
// Built before the picker/camera exist, so it reads ctx.picker only in
// tick() (live by the first frame), never at construction.

import * as THREE from 'three';

import { disposeObject3D } from '../../utils/disposeObject3D';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { createRootGem, GEM_HOVER_LIFT_FRAC } from './mesh';
import { createGemPalette, writeFaceColors, type Rgb } from './palette';
import { NodeKind } from '../../types/manifest';
import { Street } from '../../types/street';

// Cycle a Color in place through the palette (one loop per `period`
// seconds); `offset` phases multiple halos apart without allocating.
function _setPaletteColor(
  out: THREE.Color,
  palette: ReadonlyArray<Rgb>,
  t: number,
  period: number,
  offset: number
): void {
  const n = palette.length;
  if (n === 0) return;
  const phase = (((t / period + offset) % 1) + 1) % 1; // wrap negatives
  const idxf = phase * n;
  const a = Math.floor(idxf) % n;
  const b = (a + 1) % n;
  const f = idxf - Math.floor(idxf);
  const A = palette[a];
  const B = palette[b];
  out.setRGB(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
}

type GemBody = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
type GemEdges = THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
type GlowQuad = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

// Scratch for the per-frame glow-quad billboarding (see tick()).
const _glowQuat = new THREE.Quaternion();
const _Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface Gem extends SceneComponent {
  /** Build (or rebuild) the inner gem for `street`; disposes the prior one. */
  rebuild(street: Street): void;
  /** The INNER gem group (bobbed / picked / handed to repoLabel). Null
   *  pre-rebuild. The picker's getRootGem reads it. NOT the outer `group`. */
  getRootGroup(): THREE.Group | null;
}

export function createGem(ctx: SceneContext): Gem {
  // Per city, so two gems never share a palette.
  const gemFaceColors = createGemPalette(ctx.settings);
  const { cityState } = ctx;
  // Persistent outer group — added to the scene once. rebuild() swaps the
  // inner gem in and out of this group.
  const group = new THREE.Group();

  // Component-level mutable refs, reassigned each rebuild. The theme effect
  // targets these (NOT a stale closure capture) so it hits the live meshes.
  let gem: THREE.Group | null = null;
  let body: GemBody | null = null;
  let edges: GemEdges | null = null;
  let innerGlow: GlowQuad | null = null;
  let outerGlow: GlowQuad | null = null;

  // Gem meshes don't share materials, so disposeObject3D's sharedMaterial
  // guard is a no-op here and each mesh's material disposes normally.
  function _disposeInnerGem(): void {
    if (!gem) return;
    if (gem.parent) gem.parent.remove(gem);
    gem.traverse(disposeObject3D);
  }

  function rebuild(street: Street): void {
    // Build the fresh inner gem, then swap it in and dispose the old one.
    const gemGroup = createRootGem(street, ctx.resources.gem, ctx.settings);
    const inner = (gemGroup.userData.gem as THREE.Group) || null;

    _disposeInnerGem();

    gem = inner;
    body = (inner?.userData.body as GemBody) ?? null;
    edges = (inner?.userData.edges as GemEdges) ?? null;
    innerGlow = (inner?.userData.innerGlow as GlowQuad | null) ?? null;
    outerGlow = (inner?.userData.outerGlow as GlowQuad | null) ?? null;

    if (inner) group.add(inner);
  }

  // Structure only: the root street is what the gem sits on, and it moves
  // exactly when the geometry does.
  const stopLayout = cityState.on('structure', () => {
    if (cityState.rootStreet) rebuild(cityState.rootStreet);
  });

  // GEM Save → repaint in place. Safe at construction: null guards no-op
  // until the first rebuild.
  const stopEffect = ctx.settings.on('GEM', () => {
    const gemAppearance = ctx.settings.GEM;

    if (edges?.material?.color) {
      edges.material.color.set(gemAppearance.EDGE_COLOR);
    }
    if (body?.material) {
      const op = gemAppearance.BODY_OPACITY;
      body.material.opacity = op;
      // `transparent` must follow the opacity, or dropping below 1 has no
      // visual effect after an opaque build.
      const wantTransparent = op < 1;
      if (body.material.transparent !== wantTransparent) {
        body.material.transparent = wantTransparent;
        body.material.needsUpdate = true;
      }
    }
    // Face colors are a baked BufferAttribute; rewrite in place so palette
    // tweaks skip a full rebuild.
    if (body?.geometry?.attributes.color) {
      const colorAttr = body.geometry.attributes.color as THREE.BufferAttribute;
      writeFaceColors(colorAttr.array as Float32Array, gemFaceColors());
      colorAttr.needsUpdate = true;
    }
    if (gem && gem.userData.streetWidth != null) {
      const hoverFrac = GEM_HOVER_LIFT_FRAC;
      gem.userData.baseY = gem.userData.radius + gem.userData.streetWidth * hoverFrac;
    }

    // Halo scale/opacity/visibility only — color is tick()'s per-frame job.
    if (gem && gem.userData.radius != null) {
      const r = gem.userData.radius as number;
      const inner = innerGlow;
      const outer = outerGlow;
      if (inner) {
        inner.visible = gemAppearance.GLOW_ENABLED;
        inner.scale.set(r * gemAppearance.GLOW_INNER_SCALE, r * gemAppearance.GLOW_INNER_SCALE, 1);
        inner.material.opacity = gemAppearance.GLOW_INNER_OPACITY;
      }
      if (outer) {
        outer.visible = gemAppearance.GLOW_ENABLED;
        outer.scale.set(r * gemAppearance.GLOW_OUTER_SCALE, r * gemAppearance.GLOW_OUTER_SCALE, 1);
        outer.material.opacity = gemAppearance.GLOW_OUTER_OPACITY;
      }
    }
  });

  function tick(_dt: number, frame: FrameContext): void {
    if (!gem) return;
    const gemCfg = ctx.settings.GEM;
    // Absolute time (seconds since render-loop start), NOT dt.
    const t = frame.time;
    gem.rotation.y = t * gemCfg.ROTATION_SPEED;
    // Config read live each frame so the sliders update without a rebuild.
    gem.position.y =
      gem.userData.baseY +
      Math.sin(t * gemCfg.BOB_FREQUENCY) * (gem.userData.radius * gemCfg.BOB_AMPLITUDE_FRAC);
    // Hover scale-up affordance; ctx.picker is guarded for the brief
    // pre-population window at boot.
    const hov = ctx.picker?.hover ?? null;
    const gemTargetScale = hov && hov.kind === NodeKind.Gem ? gemCfg.HOVER_SCALE : 1.0;
    const curS = gem.scale.x;
    const nextS = curS + (gemTargetScale - curS) * gemCfg.SCALE_LERP_SPEED;
    gem.scale.set(nextS, nextS, nextS);

    // Palette-cycle the halo colors on two phases, so the gem reads with
    // two blending colors at any moment (EDGE_COLOR when not animating).
    const inner = innerGlow;
    const outer = outerGlow;
    if (inner || outer) {
      // Billboard: undo the group's Y-spin, then take the camera's world
      // orientation (the group's parents don't rotate).
      _glowQuat.setFromAxisAngle(_Y_AXIS, -gem.rotation.y).multiply(frame.camera.quaternion);
      if (inner) inner.quaternion.copy(_glowQuat);
      if (outer) outer.quaternion.copy(_glowQuat);
      if (gemCfg.GLOW_ANIMATE_COLORS) {
        // Memoized computed — cached array, zero per-frame parsing/allocation.
        const colors = gemFaceColors();
        const period = Math.max(0.001, gemCfg.GLOW_CYCLE_PERIOD_SECONDS);
        if (inner) _setPaletteColor(inner.material.color, colors, t, period, 0);
        if (outer) _setPaletteColor(outer.material.color, colors, t, period, 0.5);
      } else {
        const edge = gemCfg.EDGE_COLOR;
        if (inner) inner.material.color.set(edge);
        if (outer) outer.material.color.set(edge);
      }
      // HDR push: scaling the LDR halo color past 1.0 is what the bloom
      // threshold picks up; gated on BLOOM.ENABLED for the flat mode.
      const gemEmission = ctx.settings.BLOOM.ENABLED ? gemCfg.GLOW_EMISSION : 1.0;
      if (gemEmission !== 1) {
        if (inner) inner.material.color.multiplyScalar(gemEmission);
        if (outer) outer.material.color.multiplyScalar(gemEmission);
      }
    }
  }

  function dispose(): void {
    _disposeInnerGem();
    gem = null;
    body = null;
    edges = null;
    innerGlow = null;
    outerGlow = null;
    stopLayout();
    stopEffect();
  }

  return {
    group,
    rebuild,
    tick,
    dispose,
    getRootGroup: () => gem,
  };
}
