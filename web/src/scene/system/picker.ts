// scene/picker.ts — owns the raycaster + the hover and selection
// state machine. State rides on nanostores atoms so consumers
// (outlineRenderer, pathLineRenderer, buildingFader, coordinator)
// use the same `subscribe` / `get` idiom they already use for every
// config store.
//
// Public contract:
//
//   const picker = createPicker({ canvas, camera, world });
//
//   picker.hover                  // atom: null | hover target
//   picker.selection              // atom: null | selection target
//   picker.setHover(target)       // updates hover atom
//   picker.setSelection(target)   // updates selection + derived selectionKey atoms
//   picker.selectByPath(path)     // tree clicks, breadcrumb segment clicks
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
// Selection persistence
// ---------------------
// PICKER_SELECTION_KEY (exported, atom) holds the persistable form, a
// tagged union over the same three discriminators carried by selection:
//   { kind: NodeKind.File,      path: string }
//   { kind: NodeKind.Directory, path: string }
//   { kind: NodeKind.Commit,    sha: string }
// It's hooked
// into the existing attachPersistence system as `cc.PICKER_SELECTION_KEY`.
// One-way derivation: selection is the source of truth; whenever it
// changes, picker writes the matching key. On world.onChange, the
// key is re-resolved to a live selection (or cleared if the path is
// gone), so a rebuild that loses a node clears it from selection too.

import * as THREE from 'three';
import { atom } from 'nanostores';
import { NodeKind } from '@/types';

import type { PickTarget, PickerWorld, PickerSelectionKey } from '@/types';

// Persisted across reloads. Exported so attachPersistence can pick it
// up via the Config barrel re-export.
export const PICKER_SELECTION_KEY = atom<PickerSelectionKey | null>(null);

export function createPicker({
  canvas,
  camera,
  world,
}: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  world: PickerWorld;
}) {
  const hover = atom<PickTarget | null>(null);
  const selection = atom<PickTarget | null>(null);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Cached pickables list, refreshed on world.onChange so per-frame
  // raycasts don't allocate a new array.
  let pickables: THREE.Object3D[] = [];
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
  }

  // ── Selection → key derivation ────────────────────────────────────
  // selection is the source of truth. Any time it changes, we recompute
  // PICKER_SELECTION_KEY so the persistence layer sees the new key.
  // No code path writes to both atoms simultaneously.
  //
  // NOTE: nanostores subscribe() fires immediately with the current value.
  // We suppress the initial fire so we don't clobber a key that was
  // hydrated by attachPersistence before this picker was created.
  let _suspendKeyDerive = true;
  selection.subscribe((sel) => {
    if (_suspendKeyDerive) return;
    if (!sel) {
      PICKER_SELECTION_KEY.set(null);
      return;
    }
    if (sel.kind === NodeKind.File && sel.file?.path != null) {
      PICKER_SELECTION_KEY.set({ kind: NodeKind.File, path: sel.file.path });
      return;
    }
    if (sel.kind === NodeKind.Directory && sel.dir?.path != null) {
      PICKER_SELECTION_KEY.set({ kind: NodeKind.Directory, path: sel.dir.path });
      return;
    }
    if (sel.kind === NodeKind.Commit && sel.commit?.sha) {
      PICKER_SELECTION_KEY.set({ kind: NodeKind.Commit, sha: sel.commit.sha });
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
    const key = PICKER_SELECTION_KEY.get();
    _refreshPickables(); // also refresh pickables on every rebuild

    if (!key) {
      // Drop selection in case it referred to disposed meshes.
      _suspendKeyDerive = true;
      selection.set(null);
      _suspendKeyDerive = false;
      return;
    }
    if (key.kind === NodeKind.File) {
      const b = world.getBuildingByPath(key.path);
      _suspendKeyDerive = true;
      if (b) {
        selection.set({
          kind: NodeKind.File,
          mesh: b.mesh,
          data: b.building,
          file: b.building.file,
          instanceId: b.instanceId,
        });
      } else {
        selection.set(null);
        PICKER_SELECTION_KEY.set(null);
      }
      _suspendKeyDerive = false;
      return;
    }
    if (key.kind === NodeKind.Directory) {
      const sw = world.getSidewalkByDir(key.path);
      const st = world.getStreetByDir(key.path);
      _suspendKeyDerive = true;
      if (sw && st && st.dir) {
        selection.set({
          kind: NodeKind.Directory,
          sidewalk: sw,
          street: st,
          dir: st.dir,
        });
      } else {
        selection.set(null);
        PICKER_SELECTION_KEY.set(null);
      }
      _suspendKeyDerive = false;
      return;
    }
    // trees is null when the manifest hasn't applied yet or TREES_ENABLED
    // is off. Either way, the SHA can't be located, so we clear — same
    // collapse rule the File / Directory branches use when their
    // path lookup misses.
    if (key.kind === NodeKind.Commit) {
      const trees = world.getTrees();
      const hit = trees?.findTreeBySha(key.sha) ?? null;
      _suspendKeyDerive = true;
      if (hit) {
        selection.set({
          kind: NodeKind.Commit,
          mesh: hit.mesh,
          instanceId: hit.instanceId,
          commit: hit.commit,
        });
      } else {
        selection.set(null);
        PICKER_SELECTION_KEY.set(null);
      }
      _suspendKeyDerive = false;
      return;
    }
  }

  // Hover always clears on rebuild — it's transient and would point at
  // a stale mesh otherwise.
  function _clearHoverOnRebuild() {
    hover.set(null);
  }

  const _unsubResolve = world.onChange(() => {
    _clearHoverOnRebuild();
    _resolveKeyToSelection();
  });
  // Also resolve once now in case the key was hydrated by attachPersistence
  // before this picker was created.
  _resolveKeyToSelection();

  // ── Public setters ─────────────────────────────────────────────────
  function setHover(h: PickTarget | null): void {
    hover.set(h);
  }

  function setSelection(sel: PickTarget | null): void {
    selection.set(sel);
  }

  // Resolve a path string (file or directory) to a live target and set
  // it as the selection. Used by tree-row clicks and breadcrumb-segment
  // clicks. No-op if the path doesn't match anything.
  function selectByPath(path: string): void {
    if (!path) return;
    const b = world.getBuildingByPath(path);
    if (b) {
      setSelection({
        kind: NodeKind.File,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file,
        instanceId: b.instanceId,
      });
      return;
    }
    const sw = world.getSidewalkByDir(path);
    const st = world.getStreetByDir(path);
    if (sw && st && st.dir) {
      setSelection({
        kind: NodeKind.Directory,
        sidewalk: sw,
        street: st,
        dir: st.dir,
      });
    }
  }

  // ── Raycasting ────────────────────────────────────────────────────

  // Tie-break: when an InstancedMesh (cell detail) hit lies within
  // ~0.1% of the closest hit's distance, prefer it over any sidewalk at the
  // same distance — same-distance ties otherwise swing arbitrarily by JS
  // sort stability and the user gets a directory tooltip when their cursor
  // is plainly over a building.
  function _resolveTieBreak(
    hits: THREE.Intersection<THREE.Object3D>[],
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
  // the first hit or null. Pickables list is cached and refreshed on
  // world rebuild.
  function pickAt(clientX: number, clientY: number): THREE.Intersection<THREE.Object3D> | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return _resolveTieBreak(hits);
  }

  // interpretHit(hit) — reduce a raw raycast hit to a target object of
  // the same shape held by hover / selection atoms. Returns null for
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
      const idx = world.getBuildingIndex();
      const building = idx?.byCellSlot(`${ud.cellId}:${slot}`);
      if (!building?.file) return null;
      return {
        kind: NodeKind.File,
        mesh: hit.object as THREE.Mesh,
        data: building,
        file: building.file,
        instanceId: slot,
      };
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

  // pickAtCenter() — raycast straight forward from the camera at screen
  // center. Used by fly mode where the pointer is locked and the
  // implicit target is the camera's forward direction. Same pickables
  // list as pickAt(); same tie-break logic.
  function pickAtCenter(): THREE.Intersection<THREE.Object3D> | null {
    // Pointer at NDC (0, 0) = screen center.
    pointer.x = 0;
    pointer.y = 0;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return _resolveTieBreak(hits);
  }

  function dispose() {
    if (typeof _unsubResolve === 'function') _unsubResolve();
  }

  return {
    hover,
    selection,
    selectionKey: PICKER_SELECTION_KEY,
    setHover,
    setSelection,
    selectByPath,
    pickAt,
    pickAtCenter,
    interpretHit,
    dispose,
  };
}
