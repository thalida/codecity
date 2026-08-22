// city/components/footprint/index.ts — the ground slab under the city: one quad
// per building, street and path rect, inflated by the halo. Coplanar overlaps
// with depth-write off compose into one continuous surface, so there is no CSG
// here; a per-instance SDF keeps the corner radius a true world-space radius.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { FOOTPRINT } from '@/state/settings/fields/footprint';
import { RUINS } from '@/state/settings/fields/ruins';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { CityLayout } from '@/types';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
import { rectOfBuilding, rectOfStreet } from '@/city/layout/rect';
import type { Rect } from '@/city/layout/rect';

import type { SceneComponent, SceneContext } from '../../types';
import { onSettings } from '../../utils/onSettings';
import { BuildingLane } from '../buildings/scrubState';
import type { ScrubStates } from '@/city/timeline/scrubPass';
import FOOTPRINT_VERT from './footprint.vert.glsl?raw';
import FOOTPRINT_FRAG from './footprint.frag.glsl?raw';

/** Public contract for the footprint component. */
export interface Footprint extends SceneComponent {
  /** Rebuilt on every apply, reuse included: per-building dims recompute each
   *  time and the slabs have to keep matching them. */
  rebuild(layout: CityLayout): void;
  /** Fade one building's footprint slab, keyed by file path (ruin = tint toward the ruin color). No-op for an unknown path. */
  setBuildingFootprintOpacity(path: string, opacity: number, ruin?: boolean): void;
  /** Fade one street's footprint slab, keyed by its directory path (ruin = tint toward the ruin color). No-op for an unknown street. */
  setStreetFootprintOpacity(dirPath: string, opacity: number, ruin?: boolean): void;
  /** Paint one frame of Timeline scrub across every plot. */
  applyScrub(states: ScrubStates): void;
  /** Move the footprint material into (or out of) the transparent render pass. */
  setFootprintsTransparent(on: boolean): void;
}

export function createFootprint(ctx: SceneContext): Footprint {
  const { cityState } = ctx;
  // Persistent outer group — added to the scene once by createCityScene.
  // rebuild() swaps the inner InstancedMesh in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-footprint';
  group.userData.cyberpunkValley = 'cityFootprint';

  // Reassigned each rebuild and read through by the effect, so it can't end up
  // holding the mesh from a previous one.
  let mesh: THREE.InstancedMesh | null = null;
  let material: THREE.ShaderMaterial | null = null;
  // Instance index lookup for Timeline scrubbing: buildings occupy 0..buildingCount-1
  // (build order), streets follow. Rebuilt every rebuild() alongside the mesh.
  let pathToInstance = new Map<string, number>();
  let streetDirToInstance = new Map<string, number>();
  // Invisible by default in Timeline, where the scrub controller raises the live
  // ones: one it never keys would otherwise strand opaque. Survives a rebuild.
  let _transparent = false;

  function _disposeInnerMesh(): void {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.ShaderMaterial).dispose();
    mesh = null;
    material = null;
  }

  // Write one instance's opacity + ruin-tint slots; no-op for an unknown instance (e.g. pre-rebuild).
  function _setInstance(idx: number | undefined, opacity: number, ruin: boolean): void {
    if (idx === undefined || !mesh) return;
    const op = mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    op.setX(idx, opacity);
    op.needsUpdate = true;
    const ru = mesh.geometry.getAttribute('aRuin') as THREE.InstancedBufferAttribute;
    ru.setX(idx, ruin ? 1 : 0);
    ru.needsUpdate = true;
  }

  function setBuildingFootprintOpacity(path: string, opacity: number, ruin = false): void {
    _setInstance(pathToInstance.get(path), opacity, ruin);
  }

  function setStreetFootprintOpacity(dirPath: string, opacity: number, ruin = false): void {
    _setInstance(streetDirToInstance.get(dirPath), opacity, ruin);
  }

  // Plots follow the lane, not the faded body: a hover dimming the
  // neighbourhood shouldn't take the ground down with it.
  function applyScrub(states: ScrubStates): void {
    for (const [path, s] of states.buildings) {
      setBuildingFootprintOpacity(path, s.op, s.lane === BuildingLane.Ruin);
    }
    for (const [street, st] of states.streets) {
      const dir = street.dir?.path;
      if (dir == null) continue;
      setStreetFootprintOpacity(dir, st.opacity, st.ruin);
    }
  }

  // Timeline hides every instance so the scrub controller opts the live ones
  // back in; live mode never calls this, and renders byte-identically.
  function setFootprintsTransparent(on: boolean): void {
    _transparent = on;
    if (!material || !mesh) return;
    if (material.transparent !== on) {
      material.transparent = on;
      material.needsUpdate = true;
    }
    const op = mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    (op.array as Float32Array).fill(on ? 0 : 1);
    op.needsUpdate = true;
    // Clear ruin tint on every mode switch; the scrub controller re-flags ruins each frame.
    const ru = mesh.geometry.getAttribute('aRuin') as THREE.InstancedBufferAttribute;
    (ru.array as Float32Array).fill(0);
    ru.needsUpdate = true;
  }

  function rebuild(layout: CityLayout): void {
    const cfg = FOOTPRINT.value;
    const halo = Math.max(0, cfg.HALO_WIDTH);

    // Dispose prior mesh first (swap pattern mirrors gem).
    _disposeInnerMesh();
    pathToInstance = new Map();
    streetDirToInstance = new Map();

    // A zero halo is a zero-area slab nobody can see, so the group stays empty
    // rather than holding a mesh that draws nothing.
    if (halo <= 0) {
      return;
    }

    // Instance order is load-bearing for Timeline scrubbing: buildings first
    // (0..buildingCount-1), then streets, matching the loops below.
    const rects: Rect[] = [];
    for (const b of layout.buildings) {
      pathToInstance.set(b.file.path, rects.length);
      rects.push(rectOfBuilding(b));
    }
    for (const s of layout.streets) {
      if (s.dir?.path != null) streetDirToInstance.set(s.dir.path, rects.length);
      rects.push(rectOfStreet(s));
    }

    // Also nothing to render if there are no rects.
    if (rects.length === 0) {
      return;
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);

    // World units, so the shader's SDF keeps a true radius: in unit space the
    // non-uniform per-instance scale would distort every corner.
    const halfExtents = new Float32Array(rects.length * 2);
    for (let i = 0; i < rects.length; i++) {
      halfExtents[i * 2 + 0] = (rects[i].w + halo * 2) * 0.5;
      halfExtents[i * 2 + 1] = (rects[i].d + halo * 2) * 0.5;
    }
    geometry.setAttribute('aHalfExtent', new THREE.InstancedBufferAttribute(halfExtents, 2));

    // Per-instance opacity for Timeline fading. Default 1 (opaque) in live mode;
    // 0 (hidden) in timeline mode so the scrub controller opts live ones back in.
    const opacity = new Float32Array(rects.length).fill(_transparent ? 0 : 1);
    geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacity, 1));
    // Per-instance ruin tint [0..1], driven by the scrub controller for deleted-folder plots/roads.
    geometry.setAttribute(
      'aRuin',
      new THREE.InstancedBufferAttribute(new Float32Array(rects.length), 1)
    );

    const colorUniform = new THREE.Color();
    setColorFromHex(colorUniform, cfg.COLOR);
    const ruinColorUniform = new THREE.Color();
    setColorFromHex(ruinColorUniform, RUINS.value.ROAD_COLOR);

    const mat = new THREE.ShaderMaterial({
      vertexShader: FOOTPRINT_VERT,
      fragmentShader: FOOTPRINT_FRAG,
      depthWrite: false,
      transparent: _transparent,
      uniforms: {
        uColor: { value: colorUniform },
        uRuinColor: { value: ruinColorUniform },
        // Resolved to world units here, so the SDF stays one uniform.
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

  // Colour, radius and enabled: halo width is structural and takes the rebuild
  // path instead. Guarded, since it also runs once before any mesh exists.
  const stopEffect = onSettings(FOOTPRINT, () => {
    const c = FOOTPRINT.value;
    if (material) {
      setColorFromHex(material.uniforms.uColor.value as THREE.Color, c.COLOR);
      material.uniforms.uCornerRadius.value =
        Math.max(0, c.CORNER_RADIUS) * Math.max(0, c.HALO_WIDTH);
    }
    group.visible = c.ENABLED;
  });

  // Ruin road color — reacts to the committed RUINS.ROAD_COLOR (updates on Save);
  // rebuild seeds a fresh material's value, this keeps it current afterward.
  const stopRuinColor = effect(() => {
    const hex = RUINS.value.ROAD_COLOR;
    if (material) setColorFromHex(material.uniforms.uRuinColor.value as THREE.Color, hex);
  });

  // On layout, not structureRevision: per-building dims recompute on every
  // apply, so the slabs have to re-match even when nothing structural moved.
  const stopLayout = effect(() => {
    const layout = cityState.layout.value;
    if (layout) rebuild(layout);
  });

  function dispose(): void {
    _disposeInnerMesh();
    stopEffect();
    stopRuinColor();
    stopLayout();
  }

  return {
    group,
    rebuild,
    dispose,
    setBuildingFootprintOpacity,
    setStreetFootprintOpacity,
    applyScrub,
    setFootprintsTransparent,
  };
}
