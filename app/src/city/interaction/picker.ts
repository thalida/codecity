// city/interaction/picker.ts — owns the raycaster + the hover and selection
// state machine. State rides on @preact/signals so consumers
// (the outline, path-line, and building-fader renderers) use the same
// `effect` / `.value` idiom they already use for every settings store.
//
// Public contract:
//
//   const picker = createPicker({ canvas, camera, world });
//
//   picker.hover                  // signal: null | hover target
//   picker.selection              // signal: null | selection target
//   picker.setHover(target)       // updates hover signal
//   picker.setSelection(target)   // updates selection + derived selectionKey signals
//   picker.selectByPath(path)     // tree clicks, breadcrumb segment clicks
//   picker.selectByCommit(sha)    // commit/tree landmark selection
//   picker.pickAt(x, y)           // raycast against living meshes; returns null | hit
//   picker.interpretHit(hit)      // null | { kind, mesh|sidewalk, file|street|dir }
//   picker.dispose()
//
// Target shape (the value held by hover / selection):
//   null
//   { kind: NodeKind.Gem }
//   { kind: NodeKind.File,      mesh, data, file }
//   { kind: NodeKind.Directory, sidewalk, street, dir }
//   { kind: NodeKind.Commit,    mesh, instanceId, commit }
//
// Selection key (in-memory only)
// ------------------------------
// PICKER_SELECTION_KEY holds the path/sha form of the current selection, a
// tagged union over the same three discriminators carried by selection:
//   { kind: NodeKind.File,      path: string }
//   { kind: NodeKind.Directory, path: string }
//   { kind: NodeKind.Commit,    sha: string }
// One-way derivation: selection is the source of truth; whenever it changes,
// picker writes the matching key. On a city rebuild (cityState.cityRevision
// bumps) the key is re-resolved to a live selection (or cleared if the path is
// gone) so an in-session rebuild — a settings change recreates the city's
// meshes — keeps the selected node alive instead of leaving a dangling mesh
// ref. A Commit selection additionally re-resolves when the deferred trees
// attach (cityState.decorationRevision). The key is NOT persisted: a
// fresh page load starts with no selection, and nothing is remembered across
// sessions or source switches.

import * as THREE from 'three';
import { ObjectBVH } from 'three-mesh-bvh';
import { signal, effect, untracked } from '@preact/signals';
import { NodeKind } from '@/types';
import { sidewalkStreetForFace } from '@/city/components/streets/streets';
import { TIMELINE_MODE, SCRUB_POS } from '@/state/stores/timeline';
import { RUINED_STREET_DIRS, FUTURE_STREET_DIRS } from '@/city/timeline/scrubController';

import type { PickTarget, PickerWorld, PickerSelectionKey } from '@/types';
import type { CityState } from '@/city/state';

// In-memory selection key. Reset to null on a fresh load; survives in-session
// world rebuilds via the re-resolution below. Never written to localStorage.
export const PICKER_SELECTION_KEY = signal<PickerSelectionKey | null>(null);

export function createPicker({
  canvas,
  camera,
  world,
  cityState,
}: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  world: PickerWorld;
  cityState: CityState;
}) {
  const hover = signal<PickTarget | null>(null);
  const selection = signal<PickTarget | null>(null);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Cached pickables list. Refreshed on the cityRevision/decorationRevision
  // effects below so per-frame raycasts don't allocate a new array.
  let pickables: THREE.Object3D[] = [];
  // Spatial index over the pickables. THREE's intersectObjects tests every
  // building instance per pointer move (~34ms/cast at 80k); an ObjectBVH (each
  // InstancedMesh instance is a BVH primitive) turns that into ~0.07ms/cast.
  // Built lazily on the first pickAt after a refresh — deferred so the ~180ms
  // build (80k instances) stays off the manifest-apply path, AND so the world
  // matrices the BVH reads are already fresh from the frame loop by then.
  let _bvh: ObjectBVH | null = null;
  let _bvhDirty = true;
  function _refreshPickables() {
    pickables = world.getStreetPickables().slice();

    // Add the detail InstancedMesh from each cell — buildings live in
    // CellTile meshes (userData.cellId + userData.meshKind).
    for (const cell of world.getCells().values()) {
      if (cell.detailMesh) pickables.push(cell.detailMesh);
    }

    const gem = world.getRootGem();
    if (gem) {
      // Body lives at gem.userData.body — don't index children, since
      // the glow sprites are also children and the order shifts.
      const gemBody = gem.userData.body as THREE.Object3D | undefined;
      if (gemBody) pickables.push(gemBody);
    }

    const trees = world.getTrees();
    if (trees) {
      for (const child of trees.group.children) {
        const kind = child.userData?.meshKind;
        if (kind === 'tree-canopy' || kind === 'tree-trunk') {
          pickables.push(child);
        }
      }
    }
    // Invalidate the spatial index; rebuilt lazily on the next pickAt.
    _bvh = null;
    _bvhDirty = true;
  }

  // ── Selection → key derivation ────────────────────────────────────
  // selection is the source of truth. Any time it changes, we recompute
  // PICKER_SELECTION_KEY so the re-resolution below has the current anchor.
  // No code path writes to both signals simultaneously.
  //
  // _suspendKeyDerive guards against feedback: it's raised while
  // _resolveKeyToSelection writes selection.value, so that write doesn't
  // re-fire this effect and overwrite the key mid-resolution. The initial
  // fire is suppressed for the same reason (the key starts null on a fresh
  // load — nothing to derive yet).
  let _suspendKeyDerive = true;
  const _disposeSelectionEffect = effect(() => {
    const sel = selection.value;
    if (_suspendKeyDerive) return;
    if (!sel) {
      PICKER_SELECTION_KEY.value = null;
      return;
    }
    if (sel.kind === NodeKind.File && sel.file?.path != null) {
      PICKER_SELECTION_KEY.value = { kind: NodeKind.File, path: sel.file.path };
      return;
    }
    if (sel.kind === NodeKind.Directory && sel.dir?.path != null) {
      PICKER_SELECTION_KEY.value = { kind: NodeKind.Directory, path: sel.dir.path };
      return;
    }
    if (sel.kind === NodeKind.Commit && sel.commit?.sha) {
      PICKER_SELECTION_KEY.value = { kind: NodeKind.Commit, sha: sel.commit.sha };
      return;
    }
  });
  // Lift the initial suppression now that the first (no-op) fire is done.
  _suspendKeyDerive = false;

  // ── Key → selection re-resolution on world rebuild ────────────
  // After a manifest swap, any prior live selection (mesh, street ref)
  // is stale. Re-resolve from the persistable key so the user's
  // selected node survives across rebuilds when its path still exists,
  // and clears cleanly when it doesn't.
  function _resolveKeyToSelection() {
    const key = PICKER_SELECTION_KEY.value;
    _refreshPickables(); // also refresh pickables on every rebuild

    if (!key) {
      // Drop selection in case it referred to disposed meshes.
      _suspendKeyDerive = true;
      selection.value = null;
      _suspendKeyDerive = false;
      return;
    }
    if (key.kind === NodeKind.File) {
      const b = world.getBuildingByPath(key.path);
      _suspendKeyDerive = true;
      if (b) {
        selection.value = {
          kind: NodeKind.File,
          mesh: b.mesh,
          data: b.building,
          file: b.building.file,
          instanceId: b.instanceId,
        };
      } else {
        selection.value = null;
        PICKER_SELECTION_KEY.value = null;
      }
      _suspendKeyDerive = false;
      return;
    }
    if (key.kind === NodeKind.Directory) {
      const sw = world.getSidewalkByDir(key.path);
      const st = world.getStreetByDir(key.path);
      _suspendKeyDerive = true;
      if (sw && st && st.dir) {
        selection.value = {
          kind: NodeKind.Directory,
          sidewalk: sw,
          street: st,
          dir: st.dir,
        };
      } else {
        selection.value = null;
        PICKER_SELECTION_KEY.value = null;
      }
      _suspendKeyDerive = false;
      return;
    }
    // trees is null when the manifest hasn't applied yet or ENABLED
    // is off. Either way, the SHA can't be located, so we clear — same
    // collapse rule the File / Directory branches use when their
    // path lookup misses.
    if (key.kind === NodeKind.Commit) {
      const trees = world.getTrees();
      const hit = trees?.findTreeBySha(key.sha) ?? null;
      _suspendKeyDerive = true;
      if (hit) {
        selection.value = {
          kind: NodeKind.Commit,
          mesh: hit.mesh,
          instanceId: hit.instanceId,
          commit: hit.commit,
        };
      } else {
        selection.value = null;
        PICKER_SELECTION_KEY.value = null;
      }
      _suspendKeyDerive = false;
      return;
    }
  }

  // Hover always clears on rebuild — it's transient and would point at
  // a stale mesh otherwise.
  function _clearHoverOnRebuild() {
    hover.value = null;
  }

  // ── Rebuild reactions ─────────────────────────────────────────────
  // cityRevision bumps ONCE per applyManifest (streets/buildings already
  // rebuilt by the time it fires). Clear the now-stale hover, then re-resolve
  // the selection key against the fresh scene + refresh pickables. The body
  // runs untracked() so the
  // effect subscribes ONLY to cityRevision: _resolveKeyToSelection reads (and
  // writes) PICKER_SELECTION_KEY + selection, which would otherwise make this
  // effect re-fire on every ordinary selection change.
  const _disposeCityRevEffect = effect(() => {
    void cityState.cityRevision.value;
    untracked(() => {
      _clearHoverOnRebuild();
      _resolveKeyToSelection();
    });
  });
  // decorationRevision bumps AFTER the deferred trees attach. At cityRevision
  // time getTrees() was null (trees cleared), so a Commit selection was cleared
  // and the pickables had no tree meshes. Re-resolve + refresh now that the live
  // tree group exists. Hover is left alone (it was already cleared above, and a
  // foliage attach shouldn't drop an interactive hover the user just made).
  const _disposeDecorationRevEffect = effect(() => {
    void cityState.decorationRevision.value;
    untracked(_resolveKeyToSelection);
  });
  // Note: both effects fire ONCE at construction (revisions start at 0). That
  // initial resolve runs with key null → selection cleared + pickables primed.

  // Timeline scrub mutates every building's instance matrix each frame (height +
  // the age-lean shear). The cached ObjectBVH stores bounds at build time, so
  // without this it keeps the heights from whenever it was last built — the
  // hitbox freezes while the render follows the scrub. Invalidate on SCRUB_POS so
  // the next pickAt rebuilds against the scrubbed matrices. Live mode never fires
  // the rebuild (matrices are static there).
  const _disposeScrubBvhEffect = effect(() => {
    void SCRUB_POS.value;
    if (!TIMELINE_MODE.peek()) return;
    _bvh = null;
    _bvhDirty = true;
  });

  // ── Public setters ─────────────────────────────────────────────────
  function setHover(h: PickTarget | null): void {
    hover.value = h;
  }

  function setSelection(sel: PickTarget | null): void {
    selection.value = sel;
  }

  /** Convenience for "deselect everything" — equivalent to setSelection(null)
   *  but gives view-side code a self-documenting verb instead of a magic
   *  null argument. */
  function clearSelection(): void {
    selection.value = null;
  }

  // Resolve a path string (file or directory) to a live PickTarget, or null
  // if it matches nothing. Pure — no side effects. The single place that maps
  // a path to scene internals (building mesh / street / sidewalk), so view
  // code never switches on node kind or constructs PickTargets itself; it
  // just calls selectByPath / hoverByPath, or feeds the result to
  // rig.focusSelection.
  function targetForPath(path: string): PickTarget | null {
    if (!path) return null;
    const b = world.getBuildingByPath(path);
    if (b) {
      return {
        kind: NodeKind.File,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file,
        instanceId: b.instanceId,
      };
    }
    const sw = world.getSidewalkByDir(path);
    const st = world.getStreetByDir(path);
    if (sw && st && st.dir) {
      return { kind: NodeKind.Directory, sidewalk: sw, street: st, dir: st.dir };
    }
    return null;
  }

  // Resolve a path and set it as the selection. Used by tree-row clicks and
  // breadcrumb-segment clicks. No-op if the path doesn't match anything.
  function selectByPath(path: string): void {
    const t = targetForPath(path);
    if (t) setSelection(t);
  }

  // Resolve a commit sha to its live tree target and select it. No-op if
  // trees aren't attached yet or the sha isn't found.
  function selectByCommit(sha: string): void {
    const hit = world.getTrees()?.findTreeBySha(sha) ?? null;
    if (hit) {
      setSelection({
        kind: NodeKind.Commit,
        mesh: hit.mesh,
        instanceId: hit.instanceId,
        commit: hit.commit,
      });
    }
  }

  // Resolve a path and set it as the hover target (tree-row hover → city
  // highlight). No-op if the path doesn't match anything.
  function hoverByPath(path: string): void {
    const t = targetForPath(path);
    if (t) setHover(t);
  }

  // ── Timeline scrub-hidden guard ─────────────────────────────────────
  // Scrub-faded/zeroed meshes stay in the scene (never removed), so the
  // raycast still hits them; reject a resolved hit here rather than let a
  // faded-out building/tree/street stay hoverable or selectable. Only
  // active in Timeline mode — live-mode resolution is untouched.
  const SCRUB_HIDE_EPS = 0.02;
  const _scrubMatrix = new THREE.Matrix4();

  // Building presence is iFade.x, the same value the shader reads for opacity.
  // A ruin is NOT hidden — it's a visible stub, hoverable + selectable (the
  // tooltip flags it as a ruin, and the right panel is suppressed elsewhere). A
  // future slab (iRuin 2) IS treated as hidden: it's a marker for a file that
  // doesn't exist yet, so it can't be selected.
  function _buildingScrubHidden(mesh: THREE.InstancedMesh, slot: number): boolean {
    const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
    if (iFade && iFade.getX(slot) < SCRUB_HIDE_EPS) return true;
    const iRuin = mesh.geometry.getAttribute('iRuin') as THREE.BufferAttribute | undefined;
    return !!iRuin && iRuin.getX(slot) > 1.5;
  }

  // A visible ghost-ruin building (for the hover tooltip's "ruin" note); the
  // future slab (iRuin 2) isn't a ruin, and is unpickable anyway.
  function _buildingIsRuin(mesh: THREE.InstancedMesh, slot: number): boolean {
    const iRuin = mesh.geometry.getAttribute('iRuin') as THREE.BufferAttribute | undefined;
    return !!iRuin && iRuin.getX(slot) > 0.5 && iRuin.getX(slot) < 1.5;
  }

  // Trees are gated by zero-scaling their instance matrix (setScrubCommit).
  // Read the X-column length directly rather than Matrix4.decompose, which
  // special-cases a zero-determinant (fully collapsed) matrix back to scale (1,1,1).
  function _treeScrubHidden(mesh: THREE.InstancedMesh, slot: number): boolean {
    mesh.getMatrixAt(slot, _scrubMatrix);
    const e = _scrubMatrix.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    return sx < SCRUB_HIDE_EPS;
  }

  // Streets fade per-vertex (aOpacity); read the hit face's vertex directly
  // so this can't drift from what the shader is actually drawing.
  function _streetScrubHidden(hit: THREE.Intersection<THREE.Object3D>): boolean {
    const mesh = hit.object as THREE.Mesh;
    const aOpacity = mesh.geometry?.getAttribute('aOpacity') as THREE.BufferAttribute | undefined;
    const vi = hit.face?.a;
    if (!aOpacity || vi == null) return false;
    return aOpacity.getX(vi) < SCRUB_HIDE_EPS;
  }

  // ── Raycasting ────────────────────────────────────────────────────

  // Tie-break: when an InstancedMesh (cell detail) hit lies within
  // ~0.1% of the closest hit's distance, prefer it over any sidewalk at the
  // same distance — same-distance ties otherwise swing arbitrarily by JS
  // sort stability and the user gets a directory tooltip when their cursor
  // is plainly over a building.
  function _resolveTieBreak(
    hits: THREE.Intersection<THREE.Object3D>[]
  ): THREE.Intersection<THREE.Object3D> | null {
    if (hits.length === 0) return null;
    const closest = hits[0];
    const tieThreshold = closest.distance * 1.001;
    for (const h of hits) {
      if (h.distance > tieThreshold) break;
      if (h.object instanceof THREE.InstancedMesh) {
        const hud = h.object.userData;
        if (hud.cellId != null && hud.meshKind === 'detail') {
          return h;
        }
      }
    }
    return closest;
  }

  // pickAt(x, y) — raycast at canvas-relative client coords; returns
  // the first hit or null. Pickables are cached + spatially indexed (ObjectBVH),
  // both refreshed on world rebuild. The BVH is (re)built here on first use so
  // its object world matrices are already fresh from the frame loop.
  function pickAt(clientX: number, clientY: number): THREE.Intersection<THREE.Object3D> | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (_bvhDirty) {
      _bvh = pickables.length > 0 ? new ObjectBVH(pickables) : null;
      _bvhDirty = false;
    }
    if (!_bvh) return null;
    // ObjectBVH returns hits unsorted; _resolveTieBreak needs nearest-first.
    const hits = _bvh.raycast(raycaster, []);
    hits.sort((a, b) => a.distance - b.distance);
    return _resolveTieBreak(hits);
  }

  // interpretHit(hit) — reduce a raw raycast hit to a target object of
  // the same shape held by hover / selection signals. Returns null for
  // hits that aren't selectable (e.g. street labels, which don't have
  // userData.type populated for picking).
  function interpretHit(hit: THREE.Intersection<THREE.Object3D> | null): PickTarget | null {
    if (!hit || !hit.object) return null;
    const ud = hit.object.userData;
    if (ud.type === NodeKind.Gem) {
      return { kind: NodeKind.Gem, mesh: hit.object };
    }
    if (
      hit.object instanceof THREE.InstancedMesh &&
      (ud.meshKind === 'tree-canopy' || ud.meshKind === 'tree-trunk')
    ) {
      const slot = hit.instanceId;
      if (slot == null) return null;
      if (TIMELINE_MODE.peek() && _treeScrubHidden(hit.object, slot)) return null;
      const trees = world.getTrees();
      const commit = trees?.commitForInstance(hit.object, slot);
      if (!commit) return null;
      return {
        kind: NodeKind.Commit,
        mesh: hit.object,
        instanceId: slot,
        commit,
      };
    }
    // InstancedMesh hit from a CellTile. detailMesh carries userData.cellId
    // and userData.meshKind === 'detail'. The Building is looked up via
    // BuildingIndex.byCellSlot("cellId:slotId").
    if (
      hit.object instanceof THREE.InstancedMesh &&
      ud.cellId != null &&
      ud.meshKind === 'detail'
    ) {
      const slot = hit.instanceId;
      if (slot == null) return null;
      if (TIMELINE_MODE.peek() && _buildingScrubHidden(hit.object, slot)) return null;
      const idx = world.getBuildingIndex();
      const building = idx?.byCellSlot(`${ud.cellId}:${slot}`);
      if (!building?.file) return null;
      return {
        kind: NodeKind.File,
        mesh: hit.object as THREE.Mesh,
        data: building,
        file: building.file,
        instanceId: slot,
        isRuin: TIMELINE_MODE.peek() && _buildingIsRuin(hit.object, slot),
      };
    }
    // Merged sidewalk: all streets share one mesh, so resolve the hit face to
    // its street via the faceIndex→street map baked onto userData.
    if (ud.type === NodeKind.Directory && ud.pickStreets) {
      if (TIMELINE_MODE.peek() && _streetScrubHidden(hit)) return null;
      const street = sidewalkStreetForFace(hit.object, hit.faceIndex ?? 0);
      // A future folder's road is only a pad — it doesn't exist at this scrub position, so it's not selectable.
      if (street?.dir && TIMELINE_MODE.peek() && FUTURE_STREET_DIRS.has(street.dir.path)) return null;
      if (street?.dir) {
        return {
          kind: NodeKind.Directory,
          sidewalk: hit.object as THREE.Mesh,
          street,
          dir: street.dir,
          isRuin: TIMELINE_MODE.peek() && RUINED_STREET_DIRS.has(street.dir.path),
        };
      }
      return null;
    }
    if (ud.street && ud.street.dir) {
      return {
        kind: NodeKind.Directory,
        sidewalk: hit.object as THREE.Mesh,
        street: ud.street,
        dir: ud.street.dir,
      };
    }
    return null;
  }

  function dispose() {
    _disposeCityRevEffect();
    _disposeDecorationRevEffect();
    _disposeScrubBvhEffect();
    _disposeSelectionEffect();
  }

  return {
    hover,
    selection,
    selectionKey: PICKER_SELECTION_KEY,
    setHover,
    setSelection,
    clearSelection,
    selectByPath,
    selectByCommit,
    hoverByPath,
    targetForPath,
    pickAt,
    interpretHit,
    dispose,
  };
}

export type Picker = ReturnType<typeof createPicker>;
