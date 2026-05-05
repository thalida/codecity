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
//   { kind: NodeKind.Gem }
//   { kind: NodeKind.File,      mesh, data, file }
//   { kind: NodeKind.Directory, sidewalk, street, dir }
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
import { NodeKind } from '../types';

import type { PickTarget, PickerSelectionKey } from '../types';

// Persisted across reloads. Exported so attachPersistence can pick it
// up via the Config barrel re-export.
export const PICKER_SELECTION_KEY = atom<PickerSelectionKey | null>(null);

export function createPicker({
  canvas,
  camera,
  cityScene,
}: {
  canvas: HTMLCanvasElement;
  // camera and cityScene are kept loose because picker.test.ts passes
  // minimal mock objects ({} for camera, a hand-rolled object with only
  // the methods the picker calls for cityScene). Structural typing all
  // the way down would force the tests to construct a full
  // PerspectiveCamera and the entire createCityScene return shape.

  camera: any;

  cityScene: any;
}) {
  // Atoms are typed `any` because picker.test.ts reads
  // `selection.get().mesh` / `.file` without first narrowing on `kind` —
  // typing as `PickTarget | null` would require those tests to discriminate
  // (and tests are out of scope for this typing pass).

  const hover = atom<any>(null);

  const selection = atom<any>(null);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Cached pickables list, refreshed on cityScene.onChange so per-frame
  // raycasts don't allocate a new array.
  let pickables: THREE.Object3D[] = [];
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
    if (key.kind === NodeKind.File) {
      const b = cityScene.getBuildingByPath(key.path);
      _suspendKeyDerive = true;
      if (b) {
        selection.set({
          kind: NodeKind.File,
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
    if (key.kind === NodeKind.Directory) {
      const sw = cityScene.getSidewalkByDir(key.path);
      const st = cityScene.getStreetByDir(key.path);
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
    }
  }

  // Hover always clears on rebuild — it's transient and would point at
  // a stale mesh otherwise.
  function _clearHoverOnRebuild() {
    hover.set(null);
  }

  const _unsubResolve = cityScene.onChange(() => {
    _clearHoverOnRebuild();
    _resolveKeyToSelection();
  });
  // Also resolve once now in case the key was hydrated by attachPersistence
  // before this picker was created.
  _resolveKeyToSelection();

  // ── Public setters ─────────────────────────────────────────────────
  // Setters accept PickTarget | null in production; tests pass partial
  // mocks of those shapes, so the parameter is typed `any` (same reason
  // as the atoms above).

  function setHover(h: any): void {
    hover.set(h);
  }

  function setSelection(sel: any): void {
    selection.set(sel);
  }

  // Resolve a path string (file or directory) to a live target and set
  // it as the selection. Used by tree-row clicks and breadcrumb-segment
  // clicks. No-op if the path doesn't match anything.
  function selectByPath(path: string): void {
    if (!path) return;
    const b = cityScene.getBuildingByPath(path);
    if (b) {
      setSelection({
        kind: NodeKind.File,
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
        kind: NodeKind.Directory,
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
  function pickAt(clientX: number, clientY: number): THREE.Intersection<THREE.Object3D> | null {
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
  // Hit shape: production hits are `THREE.Intersection`, tests pass a
  // hand-rolled `{ object: { userData: {...} } }`. Parameter typed `any`
  // so both work without forcing tests to construct full Three objects.

  function interpretHit(hit: any): PickTarget | null {
    if (!hit || !hit.object) return null;
    const ud = hit.object.userData;
    if (ud.type === NodeKind.Gem) {
      return { kind: NodeKind.Gem, mesh: hit.object };
    }
    if (ud.building && ud.building.file) {
      const f = ud.building.file;
      if (f.type === NodeKind.Directory) {
        // Stray directory-typed building: cityScene/engine normally skip
        // these. Returned as a partially-formed DirTarget; inputHandlers
        // filters it out via a missing-sidewalk check.
        return {
          kind: NodeKind.Directory,
          sidewalk: null,
          street: null,
          dir: f,
        } as unknown as PickTarget;
      }
      return {
        kind: NodeKind.File,
        mesh: hit.object as THREE.Mesh,
        data: ud.building,
        file: f,
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
    interpretHit,
    dispose,
  };
}
