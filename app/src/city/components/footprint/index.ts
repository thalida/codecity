// city/components/footprint/index.ts — Cyberpunk Valley city footprint COMPONENT.
//
// Self-contained scene component: owns its persistent group, builds the
// inner InstancedMesh via rebuild(layout), reacts to FOOTPRINT settings via
// an effect, and frees its own GPU resources + stops its effect in dispose().
//
// One InstancedMesh of axis-aligned quads on the XZ plane, one
// instance per (building | street | path) rect from the CityLayout.
// Each instance is the rect inflated by FOOTPRINT.HALO_WIDTH in both
// axes. Coplanar overlaps with depthWrite: false compose visually
// into one continuous asphalt slab — no CSG, no triangulation, no
// explicit contour computation.
//
// Each instance carries its inflated half-extents (in world units)
// as a vec2 per-instance attribute, and the fragment shader runs a
// rounded-rectangle SDF in world-distance-from-edge space so that
// FOOTPRINT.CORNER_RADIUS (a uniform in world units) stays a true
// world-space radius regardless of the non-uniform per-instance
// scale. Where two rects overlap heavily the rounded corner of one
// is masked by its neighbor — outer silhouette corners read as
// rounded; internal "step" corners still composite continuously.
//
// Structural changes (HALO_WIDTH) trigger a rebuild via state/settingsReactions.ts;
// the settings effect handles COLOR, CORNER_RADIUS, and ENABLED only.
//
// Lifecycle matches the other persistent scene-component factories (e.g. createGem):
//
//   const fp = createFootprint(ctx);
//   scene.add(fp.group);          // once at world init
//   // then rebuilds itself reactively off cityState.layout
//   fp.dispose();                 // on world.dispose()

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { CityLayout } from '@/types';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
import { rectOfBuilding, rectOfStreet } from '@/city/layout/rect';
import type { Rect } from '@/city/layout/rect';

import type { SceneComponent, SceneContext } from '../../types';
import { onSettings } from '../../utils/onSettings';
import FOOTPRINT_VERT from './footprint.vert.glsl?raw';
import FOOTPRINT_FRAG from './footprint.frag.glsl?raw';

/** Public contract for the footprint component. */
export interface Footprint extends SceneComponent {
  /** Rebuild the InstancedMesh from the given layout, disposing any prior mesh.
   *  Driven by the cityState.layout effect (the EVERY-apply signal): the slabs
   *  wrap each building's rect, and per-building dims recompute every apply
   *  (incl. a reuse apply), so the footprint must re-match. When halo <= 0 or no
   *  rects, leaves the group EMPTY (prior mesh disposed). */
  rebuild(layout: CityLayout): void;
}

export function createFootprint(ctx: SceneContext): Footprint {
  const { cityState } = ctx;
  // Persistent outer group — added to the scene once by createCity.
  // rebuild() swaps the inner InstancedMesh in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-footprint';
  group.userData.cyberpunkValley = 'cityFootprint';

  // Component-level mutable refs, reassigned each rebuild. The settings
  // effect targets these (NOT stale closure captures) so it hits the
  // live mesh/material after every rebuild.
  let mesh: THREE.InstancedMesh | null = null;
  let material: THREE.ShaderMaterial | null = null;

  function _disposeInnerMesh(): void {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.ShaderMaterial).dispose();
    mesh = null;
    material = null;
  }

  function rebuild(layout: CityLayout): void {
    const cfg = FOOTPRINT.value;
    const halo = Math.max(0, cfg.HALO_WIDTH);

    // Dispose prior mesh first (swap pattern mirrors gem).
    _disposeInnerMesh();

    // Halo at zero (or negative — clamped to 0 above) means the footprint
    // would render as a 0-area asphalt halo that's invisible to the user.
    // Leave the group EMPTY (no mesh added) — the persistent component
    // gracefully represents "no footprint" by an empty group.
    if (halo <= 0) {
      return;
    }

    const rects: Rect[] = [];
    for (const b of layout.buildings) rects.push(rectOfBuilding(b));
    for (const s of layout.streets) rects.push(rectOfStreet(s));

    // Also nothing to render if there are no rects.
    if (rects.length === 0) {
      return;
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);

    // Per-instance half-extents in world units, so the fragment shader
    // can SDF a rounded rectangle in world-space instead of unit-space
    // (which would distort the corner radius under non-uniform scaling).
    const halfExtents = new Float32Array(rects.length * 2);
    for (let i = 0; i < rects.length; i++) {
      halfExtents[i * 2 + 0] = (rects[i].w + halo * 2) * 0.5;
      halfExtents[i * 2 + 1] = (rects[i].d + halo * 2) * 0.5;
    }
    geometry.setAttribute('aHalfExtent', new THREE.InstancedBufferAttribute(halfExtents, 2));

    const colorUniform = new THREE.Color();
    setColorFromHex(colorUniform, cfg.COLOR);

    const mat = new THREE.ShaderMaterial({
      vertexShader: FOOTPRINT_VERT,
      fragmentShader: FOOTPRINT_FRAG,
      depthWrite: false,
      uniforms: {
        uColor: { value: colorUniform },
        // CORNER_RADIUS is a fraction of HALO_WIDTH (0 → sharp, 1 → one
        // halo width, 2 → two). Compute world-units radius here so the
        // shader's SDF can keep using a single uniform.
        uCornerRadius: { value: Math.max(0, cfg.CORNER_RADIUS) * halo },
      },
    });

    const newMesh = new THREE.InstancedMesh(geometry, mat, rects.length);
    newMesh.name = 'city-footprint';
    newMesh.renderOrder = RENDER_ORDERS.CITY_FOOTPRINT;
    newMesh.frustumCulled = false;

    const tmpMatrix = new THREE.Matrix4();
    const tmpV3a = new THREE.Vector3();
    const tmpV3b = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      // Rect lives on the layout plane: its y axis is the world's z axis.
      tmpV3a.set(r.x, 0, r.y);
      tmpV3b.set(r.w + halo * 2, 1, r.d + halo * 2);
      tmpMatrix.compose(tmpV3a, tmpQ, tmpV3b);
      newMesh.setMatrixAt(i, tmpMatrix);
    }
    newMesh.instanceMatrix.needsUpdate = true;

    // Assign component-level refs BEFORE adding to group so the effect
    // (which may re-run synchronously) targets the live mesh.
    mesh = newMesh;
    material = mat;
    group.add(newMesh);

    // Apply current FOOTPRINT settings (visibility) to the freshly-built group.
    group.visible = cfg.ENABLED;
  }

  // Settings effect — reacts to FOOTPRINT signal changes (Save). Replaces the
  // footprint section of renderLoop.applyTheme(). Handles COLOR + CORNER_RADIUS
  // + ENABLED only (NOT HALO_WIDTH — that's structural, rebuild path).
  // Null-guards when no mesh exists (pre-first-rebuild OR empty/stub state).
  // Runs once at construction, which is safe: refs are null, guards no-op.
  const stopEffect = onSettings(FOOTPRINT, () => {
    const c = FOOTPRINT.value;
    if (material) {
      setColorFromHex(material.uniforms.uColor.value as THREE.Color, c.COLOR);
      material.uniforms.uCornerRadius.value =
        Math.max(0, c.CORNER_RADIUS) * Math.max(0, c.HALO_WIDTH);
    }
    group.visible = c.ENABLED;
  });

  // Layout effect — reactive rebuild entry point. Subscribes to cityState.layout
  // (the EVERY-apply signal — NOT structureRevision): per-building dims recompute
  // every apply, so the footprint slabs must re-match even on a reuse apply.
  // Null-guard makes the construction-time run (layout still null) a no-op.
  const stopLayout = effect(() => {
    const layout = cityState.layout.value;
    if (layout) rebuild(layout);
  });

  function dispose(): void {
    _disposeInnerMesh();
    stopEffect();
    stopLayout();
  }

  return { group, rebuild, dispose };
}
