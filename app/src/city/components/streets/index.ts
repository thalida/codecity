// city/components/streets/index.ts — the streets component.
//
// Self-contained scene component: owns its persistent group, builds the inner
// street meshes (sidewalk + asphalt slabs) + flat road labels reactively off
// cityState.structureRevision, reacts to STREETS settings via an effect, animates the
// labels' camera-facing orientation per-frame in tick(), tints sidewalks on
// hover/selection via two picker-driven effects, and frees its own GPU
// resources + stops its effects in dispose().
//
// The two picker-driven sidewalk-tint effects are ARMED on the first tick()
// (ctx.picker is null at construction, so they'd track NO signal there), not at
// construction. The inner street meshes / labels are private siblings
// (./streets, ./streetLabels). The component exposes its pickables/labels/
// asphalt arrays via accessors the picker reads straight off.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import { STREETS } from '@/state/stores/settings/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { onSettings } from '../../utils/onSettings';
import { createMergedSidewalkMesh, createMergedAsphaltMesh, type SidewalkRange } from './streets';
import { createStreetLabels } from './streetLabels';
import { disposeObject3D } from '@/city/utils/disposeObject3D';

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// Above this street count, drop labels on the smallest-tier (leaf-dir) streets
// — see the LOD note in rebuild(). Below it, every street keeps its label.
const LABEL_LOD_MIN_STREETS = 500;

/** Public contract for the streets component. */
export interface Streets extends SceneComponent {
  /** Rebuild every street mesh + label from the given layout, disposing any
   *  prior set. Always rebuilds when called — no signature gate; reuse is
   *  handled upstream by the layout-effect's reference-stability (the effect
   *  doesn't fire on a scenic-reuse apply, so rebuild isn't called). Returns
   *  VOID: the street diff in world is vestigial (no consumer reads it), so
   *  this component produces no diff. */
  rebuild(layout: CityLayout): void;
  /** Sidewalk pickables (the clickable directory targets). */
  getPickables(): FlatMesh[];
  /** Sidewalk lookup by street directory path. */
  getSidewalkByDir(path: string): FlatMesh | null;
}

export function createStreets(ctx: SceneContext): Streets {
  const { cityState } = ctx;
  // Persistent outer group — added to the scene once. rebuild() swaps the inner
  // street meshes + labels in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-streets';

  // Component-level mutable refs, reassigned each rebuild. The effects /
  // tick target these (NOT stale closure captures) so they hit the live
  // meshes after every rebuild.
  // ONE merged mesh for all sidewalks (pickable + per-street vertex-color tint)
  // and one for all asphalt; both null pre-build. See createMerged*Mesh.
  let sidewalkMesh: FlatMesh | null = null;
  // Stable pickables array (the picker + tests compare it by reference across
  // reuse applies) — reassigned only on rebuild.
  let pickables: FlatMesh[] = [];
  let sidewalkRanges: SidewalkRange[] = [];
  let sidewalkRangeByPath = new Map<string, SidewalkRange>();
  let asphaltMesh: FlatMesh | null = null;
  let labelGroups: THREE.Group[] = [];
  // Dir paths currently tinted non-default (selection + hover), so a tint refresh
  // rewrites only the changed streets' vertex spans, not the whole color buffer.
  let _lastTintPaths: string[] = [];

  // Camera-follow flip state for labels. Every X-oriented label flips together
  // (they all key off the camera's world-right X), likewise Y-labels off Z — so
  // the flip is TWO booleans, not per-label. tick() re-applies to the label
  // meshes only when a boolean actually flips (rare, on a threshold crossing);
  // _flipDirty forces a re-apply after a rebuild swaps in fresh labels. Without
  // this, tick walked all ~12k labels every frame (a real cost at Linux scale).
  let _xFlipped = false;
  let _zFlipped = false;
  let _flipDirty = true;

  // Tint colors as THREE.Color (written into the merged sidewalk's per-vertex
  // color attribute). The theme effect refreshes them whenever STREETS mutates.
  const _swc0 = STREETS.value;
  const _defColor = new THREE.Color(_swc0.SIDEWALK_DEFAULT);
  const _hovColor = new THREE.Color(_swc0.SIDEWALK_HOVER);
  const _selColor = new THREE.Color(_swc0.SIDEWALK_SELECTED);

  // Write one street's vertex-color span in the merged sidewalk, queuing a
  // partial GPU upload for just that span (addUpdateRange) so tinting a hovered
  // street never re-uploads the whole color buffer.
  function _writeStreetColor(range: SidewalkRange, c: THREE.Color): void {
    const attr = sidewalkMesh!.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let v = range.vStart; v < range.vStart + range.vCount; v++) {
      arr[v * 3] = c.r;
      arr[v * 3 + 1] = c.g;
      arr[v * 3 + 2] = c.b;
    }
    attr.addUpdateRange(range.vStart * 3, range.vCount * 3);
  }

  // _refreshSidewalkTints() — recolor the selection/hover streets' vertex spans
  // in the merged sidewalk (everything else stays default). Matches by DIRECTORY
  // PATH (stable across rebuilds), and only rewrites the streets whose tint
  // changed since last call (tracked via _lastTintPaths). Reads the picker
  // dynamically so the pre-population window null-guards.
  function _refreshSidewalkTints(): void {
    if (!sidewalkMesh) return;
    const sel = ctx.picker?.selection.value ?? null;
    const hov = ctx.picker?.hover.value ?? null;
    const selPath = sel?.kind === NodeKind.Directory ? (sel.dir?.path ?? null) : null;
    const hovPath = hov?.kind === NodeKind.Directory ? (hov.dir?.path ?? null) : null;

    // Selection wins over hover. Only keep paths we actually have a range for.
    const next: Array<[string, THREE.Color]> = [];
    if (selPath != null && sidewalkRangeByPath.has(selPath)) next.push([selPath, _selColor]);
    if (hovPath != null && hovPath !== selPath && sidewalkRangeByPath.has(hovPath)) {
      next.push([hovPath, _hovColor]);
    }
    const nextPaths = next.map(([p]) => p);

    // Reset streets that were tinted but no longer are.
    for (const p of _lastTintPaths) {
      if (!nextPaths.includes(p)) {
        const r = sidewalkRangeByPath.get(p);
        if (r) _writeStreetColor(r, _defColor);
      }
    }
    // Apply the current tints.
    for (const [p, c] of next) {
      const r = sidewalkRangeByPath.get(p);
      if (r) _writeStreetColor(r, c);
    }
    _lastTintPaths = nextPaths;
    (sidewalkMesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  // Deeply remove + dispose the prior street + label groups (geometry +
  // materials + textures) via the shared disposeObject3D util. Street
  // materials are NOT shared, so its sharedMaterial guard is a no-op here
  // and each mesh's material disposes normally.
  function _disposeInner(): void {
    for (const m of [sidewalkMesh, asphaltMesh]) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      disposeObject3D(m);
    }
    for (const g of labelGroups) {
      if (g.parent) g.parent.remove(g);
      g.traverse(disposeObject3D);
    }
  }

  function rebuild(layout: CityLayout): void {
    _disposeInner();

    asphaltMesh = null;
    labelGroups = [];
    _lastTintPaths = [];
    // Fresh labels default to un-flipped; force tick() to apply the live state.
    _flipDirty = true;

    const streets = layout.streets ?? [];

    // Sidewalks + asphalt: one merged mesh each (see createMerged*Mesh).
    const built = createMergedSidewalkMesh(streets, 0);
    sidewalkMesh = built?.mesh ?? null;
    sidewalkRanges = built?.ranges ?? [];
    sidewalkRangeByPath = new Map();
    for (const r of sidewalkRanges) if (r.path != null) sidewalkRangeByPath.set(r.path, r);
    pickables = sidewalkMesh ? [sidewalkMesh] : [];
    if (sidewalkMesh) group.add(sidewalkMesh);

    asphaltMesh = createMergedAsphaltMesh(streets, 0);
    if (asphaltMesh) group.add(asphaltMesh);

    // Label LOD: on a large city, skip labels for the SMALLEST-tier streets
    // (leaf directories). They dominate the count (~35% at PostHog scale), yet
    // their labels are unreadable specks when zoomed out — exactly where the
    // per-label draw call + transparent-sort cost bites — and marginal up close.
    // Scale-gated so a normal repo keeps every label.
    let minLabelWidth = -Infinity;
    if (streets.length > LABEL_LOD_MIN_STREETS) {
      let minW = Infinity;
      for (const s of streets) if (s.width < minW) minW = s.width;
      minLabelWidth = minW;
    }
    for (const street of streets) {
      if (street.width <= minLabelWidth) continue; // LOD-skipped leaf-dir label
      const labels = createStreetLabels(street);
      for (const label of labels) {
        group.add(label);
        labelGroups.push(label);
      }
    }
  }

  // (0) Layout effect — the reactive rebuild entry point. Tracks
  // cityState.structureRevision (bumped only on a non-reuse apply) and peeks
  // cityState.layout for the data, so it rebuilds the street meshes on a real
  // structure change and skips reuse applies natively — no manual gate. The
  // null-guard makes the construction-time run (layout still null) a no-op.
  //
  // rebuild() is wrapped untracked because createStreetMesh reads STREETS.value
  // (to bake the asphalt + sidewalk-default colors at creation). Without it this
  // effect would subscribe to the whole STREETS store and recreate every mesh on
  // a Refresh-route color Save — orphaning the picker's pickables (it only
  // re-syncs on cityRevision, which a Refresh Save doesn't bump), so hover/
  // selection tinting would silently break until the next real rebuild. Color
  // changes belong to the theme effect below, which repaints in place.
  const stopLayout = effect(() => {
    void cityState.structureRevision.value;
    const layout = cityState.layout.peek();
    if (layout) untracked(() => rebuild(layout));
  });

  // (1) STREETS theme effect — reacts to STREETS signal changes (Save):
  // sidewalk hex cache recompute + origColor reset + tint refresh, asphalt
  // color, and label height-scale. Reads only STREETS signals, so it's safe at
  // construction (before the picker exists; _refreshSidewalkTints null-guards
  // the picker). No-ops over empty arrays pre-first-rebuild.
  const stopTheme = onSettings(STREETS, () => {
    const streets = STREETS.value;

    _defColor.set(streets.SIDEWALK_DEFAULT);
    _hovColor.set(streets.SIDEWALK_HOVER);
    _selColor.set(streets.SIDEWALK_SELECTED);
    // Repaint every sidewalk vertex to the new default, then re-apply the live
    // selection/hover tints on top.
    if (sidewalkMesh) {
      const attr = sidewalkMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = _defColor.r;
        arr[i + 1] = _defColor.g;
        arr[i + 2] = _defColor.b;
      }
      attr.needsUpdate = true;
      _lastTintPaths = [];
    }
    // _refreshSidewalkTints reads ctx.picker.selection/hover. onSettings runs
    // this whole apply UNTRACKED, so the theme effect subscribes ONLY to
    // STREETS (not the picker signals). Sidewalk hover/selection tinting is
    // owned by the two armed picker effects below. Without untracked, a
    // selection change would also re-run all the asphalt/label work, and
    // (worse) the tint would track selection before tick() arms the dedicated
    // effects.
    _refreshSidewalkTints();

    if (asphaltMesh) {
      asphaltMesh.material.color.setHex(new THREE.Color(streets.ASPHALT_COLOR).getHex());
    }

    for (const lg of labelGroups) {
      const origFrac = lg.userData.origHeightFrac;
      if (origFrac && lg.children[0]) {
        const s = streets.LABEL_HEIGHT_FRAC / origFrac;
        lg.children[0].scale.set(s, s, 1);
      }
    }
  });

  // (2)+(3) Picker-driven sidewalk-tint effects — ARMED on the first tick(),
  // NOT at construction. At construction ctx.picker is null, so an effect
  // reading ctx.picker?.selection.value would track NO signal and never
  // re-fire (sidewalk highlighting would be permanently dead). ctx.picker is
  // populated before the first frame, so arming on the
  // first tick subscribes to the LIVE selection/hover signals: they fire once
  // (frame 1, no selection yet → sidewalks stay DEFAULT) then on every
  // selection/hover change (synchronous).
  const _arm = armOnFirstTick(ctx, () => {
    const stopSel = effect(() => {
      void ctx.picker!.selection.value;
      _refreshSidewalkTints();
    });
    const stopHov = effect(() => {
      void ctx.picker!.hover.value;
      _refreshSidewalkTints();
    });
    return [stopSel, stopHov];
  });

  // tick() — orient flat street labels toward the camera each frame so they
  // stay readable from any rotation (the labelRight scratch is component-scoped
  // to a single alloc). Also arms the picker-tint effects on the first call.
  const labelRight = new THREE.Vector3();
  function tick(_dt: number, frame: FrameContext): void {
    _arm.arm();

    const camera = frame.camera;
    // Flip decision comes from the camera's world-right vector (matrixWorld
    // column 0), not position — at top-down the camera can sit over center
    // yet still be rotated 180° around Y.
    labelRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const rightX = labelRight.x;
    const rightZ = labelRight.z;

    // Hysteresis: only flip when the relevant axis crosses ±THRESH, not 0.
    // Without this, near-top-down camera positions (where rightX/rightZ are
    // near zero) cause floating-point jitter from OrbitControls' damping to
    // flip labels back and forth every frame.
    const THRESH = 0.15;
    let nx = _xFlipped;
    let nz = _zFlipped;
    if (nx ? rightX > THRESH : rightX < -THRESH) nx = !nx;
    if (nz ? rightZ > THRESH : rightZ < -THRESH) nz = !nz;

    // Common case: no flip crossed and labels already reflect the state — nothing
    // to touch. Only walk the labels when a boolean flips or after a rebuild.
    if (!_flipDirty && nx === _xFlipped && nz === _zFlipped) return;
    _xFlipped = nx;
    _zFlipped = nz;
    _flipDirty = false;

    for (const lbl of labelGroups) {
      const base = lbl.userData.baseRotY || 0;
      const flipped = lbl.userData.street.orientation === StreetAxis.X ? _xFlipped : _zFlipped;
      lbl.userData.flipped = flipped;
      lbl.rotation.y = base + (flipped ? Math.PI : 0);
    }
  }

  function dispose(): void {
    _disposeInner();
    _arm.dispose();
    stopLayout();
    stopTheme();
  }

  return {
    group,
    rebuild,
    tick,
    dispose,
    // ONE merged mesh now; the picker raycasts it and resolves faceIndex→street.
    getPickables: () => pickables,
    getSidewalkByDir: (p) => (sidewalkRangeByPath.has(p) ? sidewalkMesh : null),
  };
}
