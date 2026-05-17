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
// `{ kind: NodeKind.File | NodeKind.Directory, path: string } | null`. It's hooked
// into the existing attachPersistence system as `cc.PICKER_SELECTION_KEY`.
// One-way derivation: selection is the source of truth; whenever it
// changes, picker writes the matching key. On cityScene.onChange, the
// key is re-resolved to a live selection (or cleared if the path is
// gone), so a rebuild that loses a node clears it from selection too.

import * as THREE from 'three';
import { atom } from 'nanostores';
import { NodeKind } from '@/types';

import type { PickTarget, PickerCityScene, PickerSelectionKey } from '@/types';
import type { SceneBlock } from './blocks.js';

// Persisted across reloads. Exported so attachPersistence can pick it
// up via the Config barrel re-export.
export const PICKER_SELECTION_KEY = atom<PickerSelectionKey | null>(null);

export function createPicker({
  canvas,
  camera,
  cityScene,
}: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  cityScene: PickerCityScene;
}) {
  const hover = atom<PickTarget | null>(null);
  const selection = atom<PickTarget | null>(null);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Cached pickables list, refreshed on cityScene.onChange so per-frame
  // raycasts don't allocate a new array.
  let pickables: THREE.Object3D[] = [];
  function _refreshPickables() {
    pickables = cityScene.getStreetPickables().slice();
    for (const block of cityScene.getBlocks()) {
      if (block.detailMesh) pickables.push(block.detailMesh);
      // Ad panels (image / video files) — each is a single textured
      // plane mesh mounted on the front face of its building. Pushed
      // directly into pickables so the non-recursive raycast catches
      // clicks on the ad face; each carries userData.building so
      // interpretHit resolves to the file selection.
      if (block.adPanels) {
        for (const mesh of block.adPanels) {
          pickables.push(mesh);
        }
      }
    }
    const gem = cityScene.getRootGem();
    if (gem) {
      // Body lives at gem.userData.body — don't index children, since
      // the glow sprites are also children and the order shifts.
      const gemBody = gem.userData.body as THREE.Object3D | undefined;
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
          instanceId: b.instanceId,
          block: b.block,
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
    const b = cityScene.getBuildingByPath(path);
    if (b) {
      setSelection({
        kind: NodeKind.File,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file,
        instanceId: b.instanceId,
        block: b.block,
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
    if (hits.length === 0) return null;

    // Tie-break: when an InstancedMesh (building) hit lies within ~0.1% of
    // the closest hit's distance, prefer it over any placeholder or
    // sidewalk at the same distance. The placeholder cuboid covers the
    // entire bbox of its block, so its outer face often coincides with
    // edge-buildings of neighboring blocks; same-distance ties otherwise
    // swing arbitrarily by JS sort stability and the user gets a
    // directory tooltip when their cursor is plainly over a building.
    const closest = hits[0];
    const tieThreshold = closest.distance * 1.001;
    for (const h of hits) {
      if (h.distance > tieThreshold) break;
      if (
        h.object instanceof THREE.InstancedMesh &&
        h.object.userData.kind === 'buildings'
      ) {
        return h;
      }
    }
    return closest;
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
    // New (Task 8+): InstancedMesh hit — one mesh per block, instanceId
    // identifies the individual building within the block.
    if (
      hit.object instanceof THREE.InstancedMesh &&
      ud.kind === 'buildings'
    ) {
      const i = hit.instanceId;
      if (i == null) return null;
      const block = ud.block as SceneBlock | undefined;
      if (!block) return null;
      const building = block.buildings[i];
      if (!building?.file) return null;
      return {
        kind: NodeKind.File,
        mesh: hit.object as THREE.Mesh,
        data: building,
        file: building.file,
        instanceId: i,
        block,
      };
    }
    // Legacy: per-building mesh with userData.building (pre-Task 8 scenes).
    if (ud.building && ud.building.file) {
      return {
        kind: NodeKind.File,
        mesh: hit.object as THREE.Mesh,
        data: ud.building,
        file: ud.building.file,
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
