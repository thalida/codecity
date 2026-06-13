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
import { effect } from '@preact/signals';

import { STREETS } from '@/state/stores/settings/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, Street } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { onSettings } from '../../utils/onSettings';
import { createStreetMesh } from './streets';
import { createStreetLabels } from './streetLabels';
import { disposeObject3D } from '@/city/utils/disposeObject3D';

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

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
  pickables(): FlatMesh[];
  /** Flat road-label groups (camera-oriented in tick). */
  labels(): THREE.Group[];
  /** Inner asphalt slabs (recolored by the theme effect). */
  asphalt(): FlatMesh[];
  /** Sidewalk lookup by street directory path. */
  getSidewalkByDir(path: string): FlatMesh | null;
  /** Street lookup by street directory path. */
  getStreetByDir(path: string): Street | null;
  /** Full sidewalk-by-dir-path map (consumed wholesale by some callers). */
  sidewalksByDirMap(): Record<string, FlatMesh>;
  /** Full street-by-dir-path map (consumed wholesale by some callers). */
  streetsByDirMap(): Record<string, Street>;
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
  let streetGroups: THREE.Group[] = [];
  let pickables: FlatMesh[] = [];
  let asphaltMeshes: FlatMesh[] = [];
  let labelGroups: THREE.Group[] = [];
  let sidewalksByDirPath: Record<string, FlatMesh> = {};
  let streetsByDirPath: Record<string, Street> = {};

  // SIDEWALK_COLORS holds CSS strings; pre-convert to numeric hex so the tint
  // loop calls material.color.setHex() without re-parsing every change. The
  // theme effect refreshes these whenever STREETS mutates. (Moved verbatim
  // from renderLoop.ts.)
  const _swc0 = STREETS.value;
  let SIDEWALK_HOVER_COLOR = new THREE.Color(_swc0.SIDEWALK_HOVER).getHex();
  let SIDEWALK_SELECTED_COLOR = new THREE.Color(_swc0.SIDEWALK_SELECTED).getHex();
  let SIDEWALK_DEFAULT_COLOR = new THREE.Color(_swc0.SIDEWALK_DEFAULT).getHex();

  // _refreshSidewalkTints() — repaint every sidewalk's material.color based on
  // the current picker.selection / picker.hover state. (Moved verbatim from
  // renderLoop.ts, but reads the picker DYNAMICALLY off the captured
  // SceneContext so the pre-population window null-guards.)
  function _refreshSidewalkTints(): void {
    const sel = ctx.picker?.selection.value ?? null;
    const hov = ctx.picker?.hover.value ?? null;
    for (const sw of pickables) {
      if (sw.userData.origColor == null) {
        sw.userData.origColor = sw.material.color.getHex();
      }
      let expected = null;
      if (sel?.kind === NodeKind.Directory && sel.sidewalk === sw) {
        expected = SIDEWALK_SELECTED_COLOR;
      } else if (hov?.kind === NodeKind.Directory && hov.sidewalk === sw) {
        expected = SIDEWALK_HOVER_COLOR;
      }
      const swColor = expected ?? sw.userData.origColor;
      sw.material.color.setHex(swColor);
    }
  }

  // Deeply remove + dispose the prior street + label groups (geometry +
  // materials + textures) via the shared disposeObject3D util. Street
  // materials are NOT shared, so its sharedMaterial guard is a no-op here
  // and each mesh's material disposes normally.
  function _disposeInner(): void {
    const all = [...streetGroups, ...labelGroups];
    for (const g of all) {
      if (g.parent) g.parent.remove(g);
      g.traverse(disposeObject3D);
    }
  }

  function rebuild(layout: CityLayout): void {
    _disposeInner();

    streetGroups = [];
    pickables = [];
    asphaltMeshes = [];
    labelGroups = [];

    for (const street of layout.streets ?? []) {
      const sg = createStreetMesh(street, 0);
      group.add(sg);
      streetGroups.push(sg);
      pickables.push(sg.userData.sidewalk as FlatMesh);
      if (sg.userData.asphalt) asphaltMeshes.push(sg.userData.asphalt as FlatMesh);

      const labels = createStreetLabels(street);
      for (const label of labels) {
        group.add(label);
        labelGroups.push(label);
      }
    }

    // Rebuild the lookup maps from each sidewalk's userData.street.dir.path.
    // (Logic moved verbatim from world._buildLookups.)
    sidewalksByDirPath = {};
    streetsByDirPath = {};
    for (const sw of pickables) {
      const swStreet = sw.userData.street;
      const swDir = swStreet?.dir;
      if (swDir?.path != null) {
        sidewalksByDirPath[swDir.path] = sw;
        streetsByDirPath[swDir.path] = swStreet;
      }
    }
  }

  // (0) Layout effect — the reactive rebuild entry point. Tracks
  // cityState.structureRevision (bumped only on a non-reuse apply) and peeks
  // cityState.layout for the data, so it rebuilds the street meshes on a real
  // structure change and skips reuse applies natively — no manual gate. The
  // null-guard makes the construction-time run (layout still null) a no-op.
  const stopLayout = effect(() => {
    void cityState.structureRevision.value;
    const layout = cityState.layout.peek();
    if (layout) rebuild(layout);
  });

  // (1) STREETS theme effect — reacts to STREETS signal changes (Save).
  // Replaces the street blocks of renderLoop.applyTheme(): sidewalk hex
  // cache recompute + origColor reset + tint refresh, asphalt color, and
  // label height-scale. Reads only STREETS signals, so it's safe at
  // construction (before the picker exists; _refreshSidewalkTints null-guards
  // the picker). No-ops over empty arrays pre-first-rebuild.
  const stopTheme = onSettings(STREETS, () => {
    const streets = STREETS.value;

    SIDEWALK_HOVER_COLOR = new THREE.Color(streets.SIDEWALK_HOVER).getHex();
    SIDEWALK_SELECTED_COLOR = new THREE.Color(streets.SIDEWALK_SELECTED).getHex();
    SIDEWALK_DEFAULT_COLOR = new THREE.Color(streets.SIDEWALK_DEFAULT).getHex();
    for (const sw of pickables) {
      sw.userData.origColor = SIDEWALK_DEFAULT_COLOR;
    }
    // _refreshSidewalkTints reads ctx.picker.selection/hover. onSettings runs
    // this whole apply UNTRACKED, so the theme effect subscribes ONLY to
    // STREETS (not the picker signals). Sidewalk hover/selection tinting is
    // owned by the two armed picker effects below — matching the original
    // renderLoop split where applyTheme() was a plain function (no
    // auto-subscribe) and the tint effects were separate. Without untracked, a
    // selection change would also re-run all the asphalt/label work, and
    // (worse) the tint would track selection before tick() arms the dedicated
    // effects.
    _refreshSidewalkTints();

    const asphaltHex = new THREE.Color(streets.ASPHALT_COLOR).getHex();
    for (const mesh of asphaltMeshes) {
      mesh.material.color.setHex(asphaltHex);
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
  // re-fire (sidewalk highlighting would be permanently dead). renderLoop
  // populates ctx.picker before the first animate() frame, so arming on the
  // first tick subscribes to the LIVE selection/hover signals: they fire once
  // (frame 1, no selection yet → sidewalks stay DEFAULT, identical to today)
  // then on every selection/hover change (synchronous, exactly like the old
  // renderLoop effects).
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
  // stay readable from any rotation. (Moved verbatim from renderLoop's
  // _orientLabelsForCamera, with the labelRight scratch component-scoped to a
  // single alloc.) Also arms the picker-tint effects on the first call.
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

    for (const lbl of labelGroups) {
      const street = lbl.userData.street;
      const base = lbl.userData.baseRotY || 0;
      const axis = street.orientation === StreetAxis.X ? rightX : rightZ;
      let flipped = lbl.userData.flipped || false;
      if (flipped) {
        // Currently flipped — only un-flip when axis clearly crosses POSITIVE.
        if (axis > THRESH) flipped = false;
      } else {
        // Not flipped — only flip when axis clearly crosses NEGATIVE.
        if (axis < -THRESH) flipped = true;
      }
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
    pickables: () => pickables,
    labels: () => labelGroups,
    asphalt: () => asphaltMeshes,
    getSidewalkByDir: (p) => sidewalksByDirPath[p] || null,
    getStreetByDir: (p) => streetsByDirPath[p] || null,
    sidewalksByDirMap: () => sidewalksByDirPath,
    streetsByDirMap: () => streetsByDirPath,
  };
}
