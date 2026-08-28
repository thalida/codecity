// city/components/streets/index.ts — the streets component: its group, the
// merged sidewalk and asphalt meshes, the road labels, and the sidewalk tinting.
// Rebuilds off structureRevision. The picker-driven tint effects arm on the
// first tick(), since ctx.picker is null at construction.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import { setColorFromHex } from '@/city/utils/color/setColorFromHex';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import {
  createMergedSidewalkMesh,
  createMergedAsphaltMesh,
  type SidewalkRange,
  type AsphaltRange,
} from './streets';
import { createStreetLabels, disposeStreetLabelResources } from './streetLabels';
import { RUINED_STREET_DIRS } from './scrubState';
import type { StreetScrubState } from './scrubState';
import { disposeObject3D } from '@/city/utils/disposeObject3D';
import { NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// Label LOD, in approximate on-screen px, with hysteresis so labels don't
// flicker at the threshold. Low enough that anything readable stays on.
const LABEL_LOD_HIDE_PX = 3;
const LABEL_LOD_SHOW_PX = 6;

/** Public contract for the streets component. */
export interface Streets extends SceneComponent {
  // Required here, optional on SceneComponent: this one always has a tick, and
  // a caller holding this type shouldn't have to prove it.
  tick(dt: number, ctx: FrameContext): void;
  /** Every street mesh and label, rebuilt from the layout. No signature gate:
   *  the effect upstream doesn't fire on a reuse apply. */
  rebuild(layout: CityLayout): void;
  /** Sidewalk pickables (the clickable directory targets). */
  getPickables(): FlatMesh[];
  /** Sidewalk lookup by street directory path. */
  getSidewalkByDir(path: string): FlatMesh | null;
  /** Per-street sidewalk spans (street + vertex range), for Timeline scrubbing. */
  getStreetRanges(): SidewalkRange[];
  /** Per-street asphalt spans, in the same street order as getStreetRanges(). */
  getAsphaltRanges(): AsphaltRange[];
  /** One street's opacity across both merged meshes; `tint` takes the asphalt
   *  toward the ruin colour. */
  setStreetOpacity(street: Street, opacity: number, tint?: number): void;
  /** Fade one street's road labels in lockstep with setStreetOpacity; 0 force-hides (overriding the visibility LOD). */
  setStreetLabelOpacity(street: Street, opacity: number): void;
  /** Paint one frame of Timeline scrub across every street. */
  applyScrub(states: ReadonlyMap<Street, StreetScrubState>): void;
  /** Move both street materials into (or out of) the transparent render pass. */
  setStreetsTransparent(on: boolean): void;
}

export function createStreets(ctx: SceneContext): Streets {
  const { cityState } = ctx;
  // Persistent outer group — added to the scene once. rebuild() swaps the inner
  // street meshes + labels in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-streets';

  // Reassigned each rebuild and read through by the effects and tick, so
  // neither closes over meshes that have since been swapped out.
  let sidewalkMesh: FlatMesh | null = null;
  // Stable pickables array (the picker + tests compare it by reference across
  // reuse applies) — reassigned only on rebuild.
  let pickables: FlatMesh[] = [];
  let sidewalkRanges: SidewalkRange[] = [];
  let sidewalkRangeByPath = new Map<string, SidewalkRange>();
  let asphaltMesh: FlatMesh | null = null;
  let asphaltRanges: AsphaltRange[] = [];
  // Sidewalk + asphalt vertex spans per street, for setStreetOpacity (both merged meshes share build order, so index i lines up).
  let opacityRangeByStreet = new Map<
    Street,
    { sidewalk: SidewalkRange; asphalt: AsphaltRange | null }
  >();
  let labelGroups: THREE.Group[] = [];
  // Label groups keyed by street, for setStreetLabelOpacity (a street can repeat its label several times).
  let labelGroupsByStreet = new Map<Street, THREE.Group[]>();
  // Dir paths currently tinted non-default (selection + hover), so a tint refresh
  // rewrites only the changed streets' vertex spans, not the whole color buffer.
  let _lastTintPaths: string[] = [];

  // Every label on an axis flips together, so this is two booleans rather than
  // per-label state: tick walked 12k labels a frame before.
  let _xFlipped = false;
  let _zFlipped = false;
  let _flipDirty = true;

  // Label visibility LOD state: recompute only when the camera moves (distances
  // change) or after a rebuild swaps in fresh labels — otherwise it's O(1)/frame.
  const _lastCamPos = new THREE.Vector3(NaN, NaN, NaN);
  let _labelVisDirty = true;

  // Tint colors as THREE.Color (written into the merged sidewalk's per-vertex
  // color attribute). The theme effect refreshes them whenever STREETS mutates.
  const _swc0 = ctx.settings.STREETS;
  const _defColor = new THREE.Color(_swc0.SIDEWALK_DEFAULT);
  const _hovColor = new THREE.Color(_swc0.SIDEWALK_HOVER);
  const _selColor = new THREE.Color(_swc0.SIDEWALK_SELECTED);

  // A partial upload for the one span, so hovering a street doesn't re-send the
  // whole colour buffer.
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

  // Write one street's span of a named per-vertex float attribute, queuing a
  // partial GPU upload (mirrors _writeStreetColor). Used for aOpacity + aRuin.
  function _writeSpan(
    mesh: FlatMesh,
    name: string,
    vStart: number,
    vCount: number,
    value: number
  ): void {
    const attr = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let v = vStart; v < vStart + vCount; v++) arr[v] = value;
    attr.addUpdateRange(vStart, vCount);
    attr.needsUpdate = true;
  }

  // Asphalt-only tint: the sidewalk span is spoken for by hover and selection.
  function setStreetOpacity(street: Street, opacity: number, tint = 0): void {
    const r = opacityRangeByStreet.get(street);
    if (!r) return;
    if (sidewalkMesh) {
      _writeSpan(sidewalkMesh, 'aOpacity', r.sidewalk.vStart, r.sidewalk.vCount, opacity);
      _writeSpan(sidewalkMesh, 'aRuin', r.sidewalk.vStart, r.sidewalk.vCount, tint);
    }
    if (asphaltMesh && r.asphalt) {
      _writeSpan(asphaltMesh, 'aOpacity', r.asphalt.vStart, r.asphalt.vCount, opacity);
      _writeSpan(asphaltMesh, 'aRuin', r.asphalt.vStart, r.asphalt.vCount, tint);
    }
  }

  // The scrub pass decides; this fades, and republishes the two sets the picker
  // rejects hits against.
  function applyScrub(states: ReadonlyMap<Street, StreetScrubState>): void {
    RUINED_STREET_DIRS.clear();
    for (const [street, st] of states) {
      setStreetOpacity(street, st.opacity, st.tint);
      setStreetLabelOpacity(street, st.opacity);
      const dir = street.dir?.path;
      if (dir == null) continue;
      if (st.ruin) RUINED_STREET_DIRS.add(dir);
    }
  }

  // Fade one street's labels; scrubHidden is a hard override the visibility LOD respects (tick()),
  // so a faded-out street can't be re-shown by a camera move before its opacity climbs back up.
  function setStreetLabelOpacity(street: Street, opacity: number): void {
    const groups = labelGroupsByStreet.get(street);
    if (!groups) return;
    const hidden = opacity <= 0;
    for (const g of groups) {
      const wasHidden = !!g.userData.scrubHidden;
      if (hidden) {
        g.userData.scrubHidden = true;
        g.visible = false;
        continue;
      }
      const plane = g.children[0] as FlatMesh | undefined;
      if (plane) plane.material.opacity = opacity;
      g.userData.scrubHidden = false;
      // Re-run the LOD once for the street that just came back, so it reappears
      // even if the camera hasn't moved since it was scrub-hidden.
      if (wasHidden) _labelVisDirty = true;
    }
  }

  // Flip both street materials in/out of the transparent pass; live mode never calls it, so streets stay byte-identical.
  function setStreetsTransparent(on: boolean): void {
    for (const m of [sidewalkMesh, asphaltMesh]) {
      if (!m || m.material.transparent === on) continue;
      m.material.transparent = on;
      m.material.needsUpdate = true;
    }
  }

  // Matched by directory path, which survives a rebuild, and rewritten only
  // where the tint actually changed since the last call.
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

  // Street materials aren't shared, so every one of them disposes here.
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
    // Per street, not per label: a street's repeats share one geometry, material
    // and texture, and the planes opt out of freeing them.
    for (const labels of labelGroupsByStreet.values()) disposeStreetLabelResources(labels);
  }

  function rebuild(layout: CityLayout): void {
    _disposeInner();

    asphaltMesh = null;
    labelGroups = [];
    labelGroupsByStreet = new Map();
    _lastTintPaths = [];
    // Fresh labels default to un-flipped; force tick() to apply the live state.
    _flipDirty = true;

    const streets = layout.streets ?? [];

    // Sidewalks + asphalt: one merged mesh each (see createMerged*Mesh).
    const built = createMergedSidewalkMesh(streets, 0, ctx.settings);
    sidewalkMesh = built?.mesh ?? null;
    sidewalkRanges = built?.ranges ?? [];
    sidewalkRangeByPath = new Map();
    for (const r of sidewalkRanges) if (r.path != null) sidewalkRangeByPath.set(r.path, r);
    pickables = sidewalkMesh ? [sidewalkMesh] : [];
    if (sidewalkMesh) group.add(sidewalkMesh);

    const asphaltBuilt = createMergedAsphaltMesh(streets, 0, ctx.settings);
    asphaltMesh = asphaltBuilt?.mesh ?? null;
    if (asphaltMesh) group.add(asphaltMesh);

    // Pair each street's sidewalk + asphalt span (same build order in both meshes).
    opacityRangeByStreet = new Map();
    asphaltRanges = asphaltBuilt?.ranges ?? [];
    for (let i = 0; i < sidewalkRanges.length; i++) {
      opacityRangeByStreet.set(sidewalkRanges[i].street, {
        sidewalk: sidewalkRanges[i],
        asphalt: asphaltRanges[i] ?? null,
      });
    }

    // Built for every street and culled per frame instead of at build time, so
    // zooming in always brings a nearby label back.
    for (const street of streets) {
      const labels = createStreetLabels(street, ctx.settings);
      for (const label of labels) {
        group.add(label);
        labelGroups.push(label);
      }
      if (labels.length) labelGroupsByStreet.set(street, labels);
    }
    _labelVisDirty = true;
  }

  // untracked, or baking the colours subscribes this to STREETS and a Refresh
  // Save recreates every mesh, orphaning the picker's pickables.
  const stopLayout = cityState.on('structure', () => {
    if (cityState.layout) rebuild(cityState.layout);
  });

  // Repaints in place on a STREETS Save. Reads only settings, so it is safe at
  // construction, and no-ops over the empty arrays before the first rebuild.
  const stopTheme = ctx.settings.on('STREETS', () => {
    const streets = ctx.settings.STREETS;

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
    // untracked, so this subscribes to STREETS alone: the tint reads the picker,
    // and tracking it here would re-run the asphalt and label work on a click.
    _refreshSidewalkTints();

    if (asphaltMesh) {
      asphaltMesh.material.color.setHex(new THREE.Color(streets.ASPHALT_COLOR).getHex());
    }

    for (const lg of labelGroups) {
      const origFrac = lg.userData.origHeightFrac;
      if (origFrac && lg.children[0]) {
        const s = streets.LABEL_HEIGHT_FRAC / origFrac;
        lg.children[0].scale.set(s, s, 1);
        lg.children[0].updateMatrix(); // labels opt out of the per-frame recompose
      }
    }
  });

  // rebuild() seeds a fresh mesh's ruin colour; this keeps it current after.
  const stopRuinColor = ctx.settings.on('RUINS', () => {
    const road = ctx.settings.RUINS.ROAD_COLOR;
    const border = ctx.settings.RUINS.SIDEWALK_COLOR;
    const a = asphaltMesh?.material.userData.uRuinColor as { value: THREE.Color } | undefined;
    if (a) setColorFromHex(a.value, road);
    const s = sidewalkMesh?.material.userData.uRuinColor as { value: THREE.Color } | undefined;
    if (s) setColorFromHex(s.value, border);
  });

  // Armed on the first tick, not at construction: ctx.picker is null there, so
  // these would track no signal at all and the highlighting would never fire.
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

  // Turns the flat labels toward the camera, and arms the tint effects once.
  const labelRight = new THREE.Vector3();
  function tick(_dt: number, frame: FrameContext): void {
    _arm.arm();

    const camera = frame.camera;
    // From the camera's world-right, not its position: top-down it can sit
    // over the centre and still be rotated 180°.
    labelRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const rightX = labelRight.x;
    const rightZ = labelRight.z;

    // Crossing ±THRESH, not 0: near top-down, damping jitter flipped every
    // label back and forth every frame.
    const THRESH = 0.15;
    let nx = _xFlipped;
    let nz = _zFlipped;
    if (nx ? rightX > THRESH : rightX < -THRESH) nx = !nx;
    if (nz ? rightZ > THRESH : rightZ < -THRESH) nz = !nz;

    // Hides labels too small to read. Recomputed only on a camera move or a
    // rebuild, since nothing else can change what projects where.
    const vpH = ctx.canvas?.clientHeight ?? 0;
    if (vpH > 0 && (_labelVisDirty || !camera.position.equals(_lastCamPos))) {
      _lastCamPos.copy(camera.position);
      _labelVisDirty = false;
      const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const k = vpH / (2 * halfTan);
      for (const lbl of labelGroups) {
        // A scrub-faded street stays hidden regardless of on-screen size (setStreetLabelOpacity owns it).
        if (lbl.userData.scrubHidden) {
          lbl.visible = false;
          continue;
        }
        const d = Math.max(camera.position.distanceTo(lbl.position), 1e-3);
        const px = ((lbl.userData.worldH ?? 0) * k) / d;
        lbl.visible = lbl.visible ? px >= LABEL_LOD_HIDE_PX : px >= LABEL_LOD_SHOW_PX;
      }
    }

    // ── Camera-follow flip ── only walk labels when a boolean flips or after a
    // rebuild; the common frame is O(1).
    if (!_flipDirty && nx === _xFlipped && nz === _zFlipped) return;
    _xFlipped = nx;
    _zFlipped = nz;
    _flipDirty = false;

    for (const lbl of labelGroups) {
      const base = lbl.userData.baseRotY || 0;
      const flipped = lbl.userData.street.orientation === StreetAxis.X ? _xFlipped : _zFlipped;
      lbl.userData.flipped = flipped;
      lbl.rotation.y = base + (flipped ? Math.PI : 0);
      lbl.updateMatrix(); // labels opt out of the per-frame recompose
    }
  }

  function dispose(): void {
    _disposeInner();
    _arm.dispose();
    stopLayout();
    stopTheme();
    stopRuinColor();
  }

  return {
    group,
    rebuild,
    tick,
    dispose,
    // ONE merged mesh now; the picker raycasts it and resolves faceIndex→street.
    getPickables: () => pickables,
    getSidewalkByDir: (p) => (sidewalkRangeByPath.has(p) ? sidewalkMesh : null),
    getStreetRanges: () => sidewalkRanges,
    getAsphaltRanges: () => asphaltRanges,
    setStreetOpacity,
    setStreetLabelOpacity,
    applyScrub,
    setStreetsTransparent,
  };
}
