// city/interaction/picker.ts — owns the raycaster + the hover/selection state
// machine on @preact/signals. selection is the source of truth; the in-memory
// PICKER_SELECTION_KEY (path/sha) is derived from it and re-resolved to a live
// target on world rebuilds, so selections survive mesh swaps. Not persisted.
import * as THREE from 'three';
import { ObjectBVH } from 'three-mesh-bvh';
import { signal, effect, untracked } from '@preact/signals';
import { sidewalkStreetForFace } from '@/city/components/streets/streets';
import { BuildingKind } from '@/city/components/buildings/buildingKind';
import { RUINED_STREET_DIRS } from '@/city/components/streets/scrubState';

import type { CityState } from '@/city/state';
import type { CityEmitter } from '../events';
import { CommitEntry, NodeKind } from '@/city/types/manifest';
import { PickTarget, PickerSelectionKey, PickerWorld } from '@/city/types/picker';
import type { TimelineState } from '@/city/timeline/state';

// In-memory selection key. Reset to null on a fresh load; survives in-session
// world rebuilds via the re-resolution below. Never written to localStorage.
export const PICKER_SELECTION_KEY = signal<PickerSelectionKey | null>(null);

export function createPicker({
  canvas,
  camera,
  world,
  cityState,
  events,
  timeline,
}: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  world: PickerWorld;
  cityState: CityState;
  events: CityEmitter;
  timeline: TimelineState;
}) {
  const hover = signal<PickTarget | null>(null);
  const selection = signal<PickTarget | null>(null);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Cached pickables list. Refreshed on the revision effects below, so per-frame
  // raycasts don't allocate a new array.
  let pickables: THREE.Object3D[] = [];
  // ObjectBVH: ~34ms casts (80k instances) → ~0.07ms. Built lazily on first
  // pickAt: off the apply path, and world matrices are fresh by then.
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
        if (child.userData?.meshKind === 'trees') pickables.push(child);
      }
    }
    // Invalidate the spatial index; rebuilt lazily on the next pickAt.
    _bvh = null;
    _bvhDirty = true;
  }

  // Selection → key derivation. _suspendKeyDerive guards feedback: raised
  // while _resolveKeyToSelection writes selection.value.
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

  // Key → selection re-resolution on rebuild: a manifest swap stales every
  // live mesh ref; the key keeps the selected node alive.
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
      const resolved = world.getBuildingByPath(key.path);
      _suspendKeyDerive = true;
      if (resolved) {
        selection.value = {
          kind: NodeKind.File,
          mesh: resolved.mesh,
          data: resolved.building,
          file: resolved.building.file,
          instanceId: resolved.instanceId,
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
    // A rebuild that moved the tree re-snaps; one that dropped it keeps the
    // commit, which outlives any mesh. Only an unknown sha collapses.
    if (key.kind === NodeKind.Commit) {
      const target = _commitTarget(key.sha);
      _suspendKeyDerive = true;
      if (target) {
        selection.value = target;
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

  // Rebuild reaction: untracked() keeps this subscribed ONLY to
  // cityRevision — the body reads/writes signals that would re-fire it.
  const _disposeCityRevEffect = effect(() => {
    void cityState.cityRevision.value;
    untracked(() => {
      _clearHoverOnRebuild();
      _resolveKeyToSelection();
    });
  });
  // cityRevision bumps after the apply's batch flushed, so the meshes collected
  // here are the ones the components just built. Fires once at construction too.

  // The scrub rewrites building matrices per frame but the BVH caches bounds
  // at build time — invalidate on SCRUB_POS or hitboxes freeze mid-scrub.
  const _disposeScrubBvhEffect = effect(() => {
    void timeline.pos.value;
    if (!timeline.mode.peek()) return;
    _bvh = null;
    _bvhDirty = true;
  });

  // ── Public setters ─────────────────────────────────────────────────
  function setHover(h: PickTarget | null): void {
    hover.value = h;
  }

  /** Every path to a selection runs through here — a pointer, a tree row, a
   *  deep link — so this is where a subscriber hears about all of them. Only on
   *  a real change: re-picking what is already picked is not a new selection. */
  function setSelection(sel: PickTarget | null): void {
    if (selection.peek() === sel) return;
    selection.value = sel;
    events.emit('select', { target: sel });
  }

  /** setSelection(null) with a self-documenting verb for view code. */
  function clearSelection(): void {
    setSelection(null);
  }

  // The ONE place a path maps to scene internals, so view code never
  // switches on node kind or constructs PickTargets itself. Pure.
  function targetForPath(path: string): PickTarget | null {
    if (!path) return null;
    const resolved = world.getBuildingByPath(path);
    if (resolved) {
      return {
        kind: NodeKind.File,
        mesh: resolved.mesh,
        data: resolved.building,
        file: resolved.building.file,
        instanceId: resolved.instanceId,
      };
    }
    const sidewalk = world.getSidewalkByDir(path);
    const street = world.getStreetByDir(path);
    if (sidewalk && street && street.dir) {
      return { kind: NodeKind.Directory, sidewalk, street, dir: street.dir };
    }
    return null;
  }

  // No-op if the path doesn't match anything. Returns what it resolved, so a
  // caller that also aims the camera reuses this resolve instead of its own.
  function selectByPath(path: string): PickTarget | null {
    const target = targetForPath(path);
    if (target) setSelection(target);
    return target;
  }

  // Resolve a commit sha to its live tree target and select it. No-op if
  // trees aren't attached yet or the sha isn't found.
  /** The commit itself, for one the city drew no tree for. Timeline's list is
   *  the one the scrubber names; Live's comes off the manifest. */
  function _commitBySha(sha: string): CommitEntry | null {
    const commits = timeline.bundle.peek()?.commits ?? cityState.manifest.peek()?.commits ?? [];
    return commits.find((c) => c.sha === sha) ?? null;
  }

  /** The target for a sha: its tree when one was placed, the bare commit when
   *  not, null when the sha isn't in this repo at all. */
  function _commitTarget(sha: string): PickTarget | null {
    const hit = world.getTrees()?.findTreeBySha(sha) ?? null;
    if (hit) {
      return {
        kind: NodeKind.Commit,
        mesh: hit.mesh,
        instanceId: hit.instanceId,
        commit: hit.commit,
      };
    }
    const commit = _commitBySha(sha);
    return commit ? { kind: NodeKind.Commit, commit } : null;
  }

  /** selectByPath for a sha, returning the target the same way. */
  function selectByCommit(sha: string): PickTarget | null {
    const target = _commitTarget(sha);
    if (target) setSelection(target);
    return target;
  }

  // Resolve a path and set it as the hover target (tree-row hover → city
  // highlight). No-op if the path doesn't match anything.
  function hoverByPath(path: string): void {
    const target = targetForPath(path);
    if (target) setHover(target);
  }

  // Scrub-hidden guard: scrubbed-away meshes stay in the scene, so reject
  // resolved hits on them (Timeline mode only).
  const SCRUB_HIDE_EPS = 0.02;
  const _scrubMatrix = new THREE.Matrix4();

  // Scrubbed away is invisible, and invisible is unpickable. Ruins and data
  // buildings stay selectable, because they are drawn.
  function _buildingScrubHidden(mesh: THREE.InstancedMesh, slot: number): boolean {
    const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
    return !!iFade && iFade.getX(slot) < SCRUB_HIDE_EPS;
  }

  // A visible ghost-ruin building (for the hover tooltip's "ruin" note).
  function _buildingIsRuin(mesh: THREE.InstancedMesh, slot: number): boolean {
    const iKind = mesh.geometry.getAttribute('iKind') as THREE.BufferAttribute | undefined;
    return !!iKind && Math.round(iKind.getX(slot)) === BuildingKind.Ruin;
  }

  // Read a face vertex's aOpacity directly so this can't drift from what
  // the shader draws; bare mesh+vertex args allow raycast-free rechecks.
  function _streetScrubHidden(mesh: THREE.Mesh, vi: number | null | undefined): boolean {
    const aOpacity = mesh.geometry?.getAttribute('aOpacity') as THREE.BufferAttribute | undefined;
    if (!aOpacity || vi == null) return false;
    return aOpacity.getX(vi) < SCRUB_HIDE_EPS;
  }

  // Has the scrub removed the current selection? A ruin stub stays selected
  // — it's still visible.
  function _selectionScrubHidden(sel: PickTarget): boolean {
    if (sel.kind === NodeKind.File) {
      return (
        sel.instanceId != null &&
        _buildingScrubHidden(sel.mesh as THREE.InstancedMesh, sel.instanceId)
      );
    }
    if (sel.kind === NodeKind.Commit) {
      // The tree renderer owns the scrub threshold; ask it directly. A commit
      // with no tree has nothing to hide, and nothing dangling to prune.
      if (sel.instanceId == null) return false;
      return world.getTrees()?.isScrubHidden(sel.instanceId) ?? false;
    }
    if (sel.kind === NodeKind.Directory) {
      return _streetScrubHidden(sel.sidewalk, sel.vertexHint);
    }
    return false;
  }

  // Per-frame in Timeline: drop a selection the scrub just removed so its
  // outline can't dangle over empty space.
  function pruneScrubHiddenSelection(): void {
    const sel = selection.peek();
    if (sel && _selectionScrubHidden(sel)) selection.value = null;
  }

  // ── Raycasting ────────────────────────────────────────────────────

  // Same-distance ties otherwise swing on JS sort stability; prefer the
  // building over the sidewalk when the cursor is plainly over a building.
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

  // Raycast at canvas-relative coords → first hit or null. The BVH is
  // (re)built here on first use, after the frame loop freshened matrices.
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

  // Reduce a raw hit to a hover/selection-shaped target; null for
  // non-selectable hits (e.g. street labels).
  /** A tree carries the commit that grew it. The renderer maps the hit face
   *  back to its placement (and filters scrub-hidden trees itself). */
  function commitTargetFor(
    mesh: THREE.Mesh,
    faceIndex: number | null | undefined
  ): PickTarget | null {
    const hit = world.getTrees()?.commitForFace(mesh, faceIndex);
    if (!hit) return null;
    return { kind: NodeKind.Commit, mesh, instanceId: hit.placementIndex, commit: hit.commit };
  }

  /** A CellTile detail mesh: the Building comes from BuildingIndex by
   *  "cellId:slotId", since one mesh carries many buildings. */
  function buildingTargetFor(
    mesh: THREE.InstancedMesh,
    cellId: unknown,
    slot: number | undefined
  ): PickTarget | null {
    if (slot == null) return null;
    if (timeline.mode.peek() && _buildingScrubHidden(mesh, slot)) return null;
    const building = world.getBuildingIndex()?.byCellSlot(`${cellId}:${slot}`);
    if (!building?.file) return null;
    return {
      kind: NodeKind.File,
      mesh: mesh as THREE.Mesh,
      data: building,
      file: building.file,
      instanceId: slot,
      isRuin: timeline.mode.peek() && _buildingIsRuin(mesh, slot),
    };
  }

  /** Merged sidewalk: every street shares one mesh, so the hit face resolves to
   *  its street through the faceIndex map baked onto userData. */
  function sidewalkTargetFor(hit: THREE.Intersection<THREE.Object3D>): PickTarget | null {
    const mesh = hit.object as THREE.Mesh;
    if (timeline.mode.peek() && _streetScrubHidden(mesh, hit.face?.a)) return null;
    const street = sidewalkStreetForFace(hit.object, hit.faceIndex ?? 0);
    if (!street?.dir) return null;
    return {
      kind: NodeKind.Directory,
      sidewalk: mesh,
      street,
      dir: street.dir,
      isRuin: timeline.mode.peek() && RUINED_STREET_DIRS.has(street.dir.path),
      vertexHint: hit.face?.a,
    };
  }

  function interpretHit(hit: THREE.Intersection<THREE.Object3D> | null): PickTarget | null {
    if (!hit || !hit.object) return null;
    const ud = hit.object.userData;

    // Each branch owns its kind outright: a null from inside one means "this is
    // that kind, but nothing selectable here", never "try the next one".
    if (ud.type === NodeKind.Gem) return { kind: NodeKind.Gem, mesh: hit.object };

    if (ud.meshKind === 'trees') {
      return commitTargetFor(hit.object as THREE.Mesh, hit.faceIndex);
    }

    if (hit.object instanceof THREE.InstancedMesh) {
      if (ud.cellId != null && ud.meshKind === 'detail') {
        return buildingTargetFor(hit.object, ud.cellId, hit.instanceId);
      }
    }

    if (ud.type === NodeKind.Directory && ud.pickStreets) return sidewalkTargetFor(hit);

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
    pruneScrubHiddenSelection,
    dispose,
  };
}

export type Picker = ReturnType<typeof createPicker>;
