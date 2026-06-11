// city/components/gem/index.ts — The root gem COMPONENT (public door).
//
// Self-contained scene component: owns its persistent group, builds the
// inner gem mesh via mesh.ts on rebuild(), reacts to GEM settings via an
// effect, animates per-frame in tick() (reading GEM + BLOOM), and frees
// its own GPU resources + stops its effect in dispose().
//
// Construction-time bridge (Strategy A): the gem is built inside world.ts,
// which runs BEFORE the picker/camera/renderer exist. The component captures
// the SceneContext at construction but only reads ctx.picker in tick(); the
// theme effect reads only GEM signals. renderLoop populates ctx.picker/
// camera/renderer before the first animate() frame, so tick() sees a live
// picker on frame 1.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { GEM } from '@/state/stores/settings/gem';
import { BLOOM } from '@/state/stores/settings/effects';
import { NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { createRootGem, GEM_HOVER_LIFT_FRAC } from './mesh';
import { gemFaceColors, writeFaceColors, type Rgb } from './palette';

// Cycle a THREE.Color in place through a palette of [r,g,b] triples,
// smoothly interpolating between adjacent palette entries. One full
// loop through every color takes `period` seconds; `offset` (0..1)
// shifts the starting phase so multiple sprites can run different
// "ahead-of-each-other" cadences without allocating new Colors.
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

export interface Gem extends SceneComponent {
  /** Build (or rebuild) the inner gem for `street`; disposes the prior one. */
  rebuild(street: Street): void;
  /** Floor anchor (y=0) of the gem, computed in rebuild(). Null pre-rebuild.
   *  Forward interface for the city composer (Task 15); world.getGemWorldPos()
   *  remains the consumed source until cameraRig/pathLine migrate. */
  worldPos: THREE.Vector3 | null;
  /** The INNER gem group (bobbed / picked / handed to repoLabel). Null
   *  pre-rebuild. Re-pointed by world.getRootGem(). NOT the outer `group`. */
  gem: THREE.Group | null;
}

export function createGem(ctx: SceneContext): Gem {
  // Persistent outer group — added to the scene once. rebuild() swaps the
  // inner gem in and out of this group.
  const group = new THREE.Group();

  // Component-level mutable refs, reassigned each rebuild. The theme effect
  // targets these (NOT a stale closure capture) so it hits the live meshes.
  let gem: THREE.Group | null = null;
  let body: GemBody | null = null;
  let edges: GemEdges | null = null;
  let innerGlow: THREE.Sprite | null = null;
  let outerGlow: THREE.Sprite | null = null;
  let worldPos: THREE.Vector3 | null = null;

  function _disposeInnerGem(): void {
    if (!gem) return;
    if (gem.parent) gem.parent.remove(gem);
    gem.traverse((obj) => {
      const d = obj as unknown as {
        geometry?: { dispose?: () => void };
        material?: { dispose?: () => void; [k: string]: unknown };
      };
      if (d.geometry?.dispose) d.geometry.dispose();
      const m = d.material;
      if (m) {
        for (const key in m) {
          if (!Object.hasOwn(m, key)) continue;
          const v = m[key] as { isTexture?: boolean; dispose?: () => void } | undefined;
          if (v?.isTexture && typeof v.dispose === 'function') v.dispose();
        }
        if (typeof m.dispose === 'function') m.dispose();
      }
    });
  }

  function rebuild(street: Street): void {
    // Build the fresh inner gem, then swap it in and dispose the old one.
    const gemGroup = createRootGem(street);
    const inner = (gemGroup.userData.gem as THREE.Group) || null;

    _disposeInnerGem();

    gem = inner;
    body = (inner?.userData.body as GemBody) ?? null;
    edges = (inner?.userData.edges as GemEdges) ?? null;
    innerGlow = (inner?.userData.innerGlowSprite as THREE.Sprite | null) ?? null;
    outerGlow = (inner?.userData.outerGlowSprite as THREE.Sprite | null) ?? null;

    if (inner) group.add(inner);

    // Floor anchor (y=0). Replicates world._computeRootStreetAndGem EXACTLY so
    // the value is identical. world.getGemWorldPos() stays the consumed source
    // until cameraRig/pathLineRenderer migrate (Task 15).
    worldPos = new THREE.Vector3();
    // StreetAxis.X === 'x' (see types/street.ts); matches world._computeRootStreetAndGem.
    if (street.orientation === StreetAxis.X) {
      worldPos.set(street.x - street.length / 2 + street.width / 2, 0, street.y);
    } else {
      worldPos.set(street.x, 0, street.y - street.length / 2 + street.width / 2);
    }
  }

  // Theme effect — reacts to GEM signal changes (Save). Replaces the
  // gem section of renderLoop.applyTheme(). No-ops while refs are null
  // (pre-first-rebuild) exactly as the old `if (rootGemBody?.material)` guards.
  // Runs once at construction (before the picker exists), which is safe: it
  // reads only GEM signals and reproduces the same values mesh.ts baked.
  const stopEffect = effect(() => {
    const gemAppearance = GEM.value;

    if (edges?.material?.color) {
      edges.material.color.set(gemAppearance.EDGE_COLOR);
    }
    if (body?.material) {
      const op = gemAppearance.BODY_OPACITY;
      body.material.opacity = op;
      // Toggle `transparent` to match the opacity. Without this, dropping
      // opacity below 1 has no visual effect after the gem was created
      // with opacity = 1.
      const wantTransparent = op < 1;
      if (body.material.transparent !== wantTransparent) {
        body.material.transparent = wantTransparent;
        body.material.needsUpdate = true;
      }
    }
    // Per-face colors live on the gem body's geometry as a BufferAttribute,
    // baked at construction. Rewrite it in place on Save so palette tweaks
    // take effect without a full applyManifest rebuild.
    if (body?.geometry?.attributes.color) {
      const colorAttr = body.geometry.attributes.color as THREE.BufferAttribute;
      writeFaceColors(colorAttr.array as Float32Array, gemFaceColors.value);
      colorAttr.needsUpdate = true;
    }
    if (gem && gem.userData.streetWidth != null) {
      const hoverFrac = GEM_HOVER_LIFT_FRAC;
      gem.userData.baseY = gem.userData.radius + gem.userData.streetWidth * hoverFrac;
    }

    // Glow halo: scale, opacity, visibility from GEM_GLOW config. Color
    // is driven per-frame by tick() (palette cycle), so we don't touch it here.
    if (gem && gem.userData.radius != null) {
      const r = gem.userData.radius as number;
      const inner = innerGlow;
      const outer = outerGlow;
      if (inner) {
        inner.visible = gemAppearance.GLOW_ENABLED;
        inner.scale.set(r * gemAppearance.GLOW_INNER_SCALE, r * gemAppearance.GLOW_INNER_SCALE, 1);
        (inner.material as THREE.SpriteMaterial).opacity = gemAppearance.GLOW_INNER_OPACITY;
      }
      if (outer) {
        outer.visible = gemAppearance.GLOW_ENABLED;
        outer.scale.set(r * gemAppearance.GLOW_OUTER_SCALE, r * gemAppearance.GLOW_OUTER_SCALE, 1);
        (outer.material as THREE.SpriteMaterial).opacity = gemAppearance.GLOW_OUTER_OPACITY;
      }
    }
  });

  function tick(_dt: number, frame: FrameContext): void {
    if (!gem) return;
    const gemCfg = GEM.value;
    // Absolute time (seconds since render-loop start), NOT dt.
    const t = frame.time;
    gem.rotation.y = t * gemCfg.ROTATION_SPEED;
    // BOB_AMPLITUDE_FRAC is read live each frame so the slider
    // updates without a rebuild. The gem radius is cached on
    // userData at gem-build time (it depends on root-street width).
    gem.position.y =
      gem.userData.baseY +
      Math.sin(t * gemCfg.BOB_FREQUENCY) * (gem.userData.radius * gemCfg.BOB_AMPLITUDE_FRAC);
    // Scale-up affordance on hover so the gem reads as clickable. Hover is
    // read from the captured SceneContext's picker (populated by renderLoop
    // before the first frame), guarded for the pre-population window.
    const hov = ctx.picker?.hover.value ?? null;
    const gemTargetScale = hov && hov.kind === NodeKind.Gem ? gemCfg.HOVER_SCALE : 1.0;
    const curS = gem.scale.x;
    const nextS = curS + (gemTargetScale - curS) * gemCfg.SCALE_LERP_SPEED;
    gem.scale.set(nextS, nextS, nextS);

    // Glow color: animate through GEM_FACE_PALETTE when ANIMATE_COLORS
    // is on; otherwise fall back to the gem's EDGE_COLOR. Two halos
    // cycle on different phases so the gem reads with two colors at
    // any moment, blending as they cross.
    const inner = innerGlow;
    const outer = outerGlow;
    if (inner || outer) {
      if (gemCfg.GLOW_ANIMATE_COLORS) {
        // Memoized computed — cached array, zero per-frame parsing/allocation.
        const colors = gemFaceColors.value;
        const period = Math.max(0.001, gemCfg.GLOW_CYCLE_PERIOD_SECONDS);
        if (inner)
          _setPaletteColor((inner.material as THREE.SpriteMaterial).color, colors, t, period, 0);
        if (outer)
          _setPaletteColor((outer.material as THREE.SpriteMaterial).color, colors, t, period, 0.5);
      } else {
        const edge = gemCfg.EDGE_COLOR;
        if (inner) (inner.material as THREE.SpriteMaterial).color.set(edge);
        if (outer) (outer.material as THREE.SpriteMaterial).color.set(edge);
      }
      // HDR push for selective gem bloom. Sprite color was just set
      // to an LDR palette value; multiplying scales it past 1.0 in
      // linear space so the bloom pass picks it up independently of
      // BLOOM.WINDOW_EMISSION. 1.0 = no bloom from gem; higher = more.
      // Gated on BLOOM.ENABLED so the "flat" comparison mode skips
      // the HDR push entirely.
      const bloomCfg = BLOOM.value;
      const gemEmission = bloomCfg.ENABLED ? bloomCfg.GEM_EMISSION : 1.0;
      if (gemEmission !== 1) {
        if (inner) (inner.material as THREE.SpriteMaterial).color.multiplyScalar(gemEmission);
        if (outer) (outer.material as THREE.SpriteMaterial).color.multiplyScalar(gemEmission);
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
    stopEffect();
  }

  return {
    group,
    rebuild,
    tick,
    dispose,
    get worldPos() {
      return worldPos;
    },
    get gem() {
      return gem;
    },
  };
}
