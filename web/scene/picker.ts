// scene/picker.ts — owns the raycaster + the hover and selection
// state machine. State rides on nanostores atoms so consumers
// (outlineRenderer, pathLineRenderer, buildingFader, coordinator)
// use the same `subscribe` / `get` idiom they already use for every
// config store.
//
// Public contract:
//
//   const picker = createPicker({ canvas, camera, cityScene });
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
//   { kind: NODE_KIND.GEM }
//   { kind: NODE_KIND.FILE,      mesh, data, file }
//   { kind: NODE_KIND.DIRECTORY, sidewalk, street, dir }
//
// Selection persistence
// ---------------------
// PICKER_SELECTION_KEY (exported, atom) holds the persistable form
// `{ kind: 'file' | 'directory', path: string } | null`. It's hooked
// into the existing attachPersistence system as `cc.PICKER_SELECTION_KEY`.
// One-way derivation: selection is the source of truth; whenever it
// changes, picker writes the matching key. On cityScene.onChange, the
// key is re-resolved to a live selection (or cleared if the path is
// gone), so a rebuild that loses a node clears it from selection too.

import * as THREE from 'three';
import { atom } from 'nanostores';
import { NODE_KIND } from '../constants.js';

import type { PickerSelectionKey } from '../types';

// Persisted across reloads. Exported so attachPersistence can pick it
// up via the Config barrel re-export.
export const PICKER_SELECTION_KEY = atom<PickerSelectionKey | null>(null);

export function createPicker({
  canvas,
  camera,
  cityScene,
}: {
  canvas: HTMLCanvasElement;
  camera: any;
  cityScene: any;
}) {
  const hover = atom<any>(null);
  const selection = atom<any>(null);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Cached pickables list, refreshed on cityScene.onChange so per-frame
  // raycasts don't allocate a new array.
  let pickables = [];
  function _refreshPickables() {
    pickables = cityScene.getBuildings().concat(cityScene.getStreetPickables());
    const gem = cityScene.getRootGem();
    if (gem) {
      const gemBody = gem.children && gem.children[0];
      if (gemBody) pickables.push(gemBody);
    }
  }

  // ── Selection → key derivation ────────────────────────────────────
  // selection is the source of truth. Any time it changes, we recompute
  // PICKER_SELECTION_KEY so the persistence layer sees the new key.
  // No code path writes to both atoms simultaneously.
  let _suspendKeyDerive = false;
  selection.subscribe(function (sel) {
    if (_suspendKeyDerive) return;
    if (!sel) {
      PICKER_SELECTION_KEY.set(null);
      return;
    }
    if (sel.kind === NODE_KIND.FILE && sel.file && sel.file.path != null) {
      PICKER_SELECTION_KEY.set({ kind: 'file', path: sel.file.path });
      return;
    }
    if (sel.kind === NODE_KIND.DIRECTORY && sel.dir && sel.dir.path != null) {
      PICKER_SELECTION_KEY.set({ kind: 'directory', path: sel.dir.path });
      return;
    }
  });

  // ── Key → selection re-resolution on cityScene rebuild ────────────
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
    if (key.kind === 'file') {
      const b = cityScene.getBuildingByPath(key.path);
      _suspendKeyDerive = true;
      if (b) {
        selection.set({
          kind: NODE_KIND.FILE,
          mesh: b.mesh,
          data: b.building,
          file: b.building.file,
        });
      } else {
        selection.set(null);
        PICKER_SELECTION_KEY.set(null);
      }
      _suspendKeyDerive = false;
      return;
    }
    if (key.kind === 'directory') {
      const sw = cityScene.getSidewalkByDir(key.path);
      const st = cityScene.getStreetByDir(key.path);
      _suspendKeyDerive = true;
      if (sw && st && st.dir) {
        selection.set({
          kind: NODE_KIND.DIRECTORY,
          sidewalk: sw,
          street: st,
          dir: st.dir,
        });
      } else {
        selection.set(null);
        PICKER_SELECTION_KEY.set(null);
      }
      _suspendKeyDerive = false;
    }
  }

  // Hover always clears on rebuild — it's transient and would point at
  // a stale mesh otherwise.
  function _clearHoverOnRebuild() {
    hover.set(null);
  }

  const _unsubResolve = cityScene.onChange(function () {
    _clearHoverOnRebuild();
    _resolveKeyToSelection();
  });
  // Also resolve once now in case the key was hydrated by attachPersistence
  // before this picker was created.
  _resolveKeyToSelection();

  // ── Public setters ─────────────────────────────────────────────────
  function setHover(h) {
    hover.set(h);
  }
  function setSelection(sel) {
    selection.set(sel);
  }

  // Resolve a path string (file or directory) to a live target and set
  // it as the selection. Used by tree-row clicks and breadcrumb-segment
  // clicks. No-op if the path doesn't match anything.
  function selectByPath(path) {
    if (!path) return;
    const b = cityScene.getBuildingByPath(path);
    if (b) {
      setSelection({
        kind: NODE_KIND.FILE,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file,
      });
      return;
    }
    const sw = cityScene.getSidewalkByDir(path);
    const st = cityScene.getStreetByDir(path);
    if (sw && st && st.dir) {
      setSelection({
        kind: NODE_KIND.DIRECTORY,
        sidewalk: sw,
        street: st,
        dir: st.dir,
      });
    }
  }

  // ── Raycasting ────────────────────────────────────────────────────
  // pickAt(x, y) — raycast at canvas-relative client coords; returns
  // the first hit or null. Pickables list is cached and refreshed on
  // cityScene rebuild.
  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length > 0 ? hits[0] : null;
  }

  // interpretHit(hit) — reduce a raw raycast hit to a target object of
  // the same shape held by hover / selection atoms. Returns null for
  // hits that aren't selectable (e.g. street labels, which don't have
  // userData.type populated for picking).
  function interpretHit(hit) {
    if (!hit || !hit.object) return null;
    const ud = hit.object.userData;
    if (ud.type === NODE_KIND.GEM) {
      return { kind: NODE_KIND.GEM };
    }
    if (ud.building && ud.building.file) {
      const f = ud.building.file;
      if (f.type === NODE_KIND.DIRECTORY) {
        return { kind: NODE_KIND.DIRECTORY, sidewalk: null, street: null, dir: f };
      }
      return { kind: NODE_KIND.FILE, mesh: hit.object, data: ud.building, file: f };
    }
    if (ud.street && ud.street.dir) {
      return {
        kind: NODE_KIND.DIRECTORY,
        sidewalk: hit.object,
        street: ud.street,
        dir: ud.street.dir,
      };
    }
    return null;
  }

  function dispose() {
    if (typeof _unsubResolve === 'function') _unsubResolve();
  }

  return {
    hover: hover,
    selection: selection,
    selectionKey: PICKER_SELECTION_KEY,
    setHover: setHover,
    setSelection: setSelection,
    selectByPath: selectByPath,
    pickAt: pickAt,
    interpretHit: interpretHit,
    dispose: dispose,
  };
}
