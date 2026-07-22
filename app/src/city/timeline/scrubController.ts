// city/timeline/scrubController.ts — per-frame building driver for Timeline mode.
//
// Reads SCRUB_POS and writes every scrub-varying per-instance attribute so a
// building renders as a real scan at that commit would: instance matrix
// (scaleY + floor count), presence opacity (iFade.x), weathered color
// (instanceColor), lit-window recency (iModifiedAge), and grime/tilt age
// (iIconUV.w) — all with no re-pack. It owns these fields while in mode; the
// tween queue and fader are dormant (index.ts gates them on TIMELINE_MODE).
// iCols/iDoorWidth/iOrient/iIconUV.xyz don't vary with scrub (driven by
// bytes/ext/path, which the delta replay never changes) so they stay untouched.

import * as THREE from 'three';

import { SCRUB_POS, TIMELINE_BUNDLE, RUINS_ENABLED } from '@/state/stores/timeline';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import type { Building, Street } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import { getBuildingColorForRecency } from '@/city/components/buildings/color';
import { parentDirPath } from '@/city/utils/path';
import { streetChainForDirPath } from '@/city/layout/streetPath';
import { lastModifiedIndexAt, linesAt, presenceAt, ruinStateAt } from './replay';
import type { PathTimeline } from './replay';

// Ghost-ruin look for a deleted building (RUINS_ENABLED): a uniform low stub
// (fraction of one floor, independent of its last size), semi-transparent, with
// a blank facade (0 window rows) and its own hue pulled most of the way to gray.
const RUIN_HEIGHT_FLOORS = 0.35;
const RUIN_OPACITY = 0.5;
const RUIN_GRAY_MIX = 0.7;
const RUIN_BASE_RECENCY = 0.5; // sample the building's hue at mid-recency before graying
const _RUIN_GRAY = new THREE.Color(0.3, 0.31, 0.34);

export interface ScrubControllerDeps {
  getBuildingIndex(): BuildingIndex | null;
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  getAdPanels(): InstancedAdPanels | null;
  timelines: Map<string, PathTimeline>;
  heightCtx: HeightContext;
  streets: {
    setStreetOpacity(street: Street, opacity: number): void;
    setStreetLabelOpacity(street: Street, opacity: number): void;
  };
  // { street dir.path → Street } from the union layout, for resolving a building's street.
  streetsByDir: Record<string, Street>;
  footprints: {
    setBuildingFootprintOpacity(path: string, opacity: number): void;
    setStreetFootprintOpacity(dirPath: string, opacity: number): void;
  };
  trees: {
    setScrubCommit(maxCommitIndex: number | null): void;
  };
  fireflies: {
    setScrubCommit(maxCommitIndex: number | null): void;
  };
}

export function createScrubController(deps: ScrubControllerDeps) {
  // Pair each union building with its replay timeline + the full ancestor street
  // chain (its own street PLUS every containing directory up to root) once; a
  // container street (e.g. `src/` with only subdirs) must stay visible as long as
  // ANY descendant file is live, not just direct children.
  const entries: { b: Building; pt: PathTimeline; streets: Street[]; createdIdx: number }[] = [];
  const allStreets: Street[] = [];
  const index = deps.getBuildingIndex();
  if (index) {
    for (const b of index.byPath.values()) {
      const path = b.file?.path;
      if (!path) continue;
      const pt = deps.timelines.get(path);
      if (!pt) continue;
      const dir = parentDirPath(path);
      const streets = streetChainForDirPath(dir, deps.streetsByDir);
      // First interval's start is the commit index the path was created at (genesis, not resurrection).
      const createdIdx = pt.intervals.length ? pt.intervals[0].start : 0;
      entries.push({ b, pt, streets, createdIdx });
    }
  }
  for (const street of Object.values(deps.streetsByDir)) allStreets.push(street);

  const _m = new THREE.Matrix4();
  const _color = new THREE.Color();

  function update(): void {
    const pos = SCRUB_POS.peek();
    deps.trees.setScrubCommit(Math.floor(pos));
    deps.fireflies.setScrubCommit(Math.floor(pos));
    const dirtyMeshes = new Set<THREE.InstancedMesh>();
    const dirtyFades = new Set<THREE.BufferAttribute>();
    const dirtyColors = new Set<THREE.InstancedMesh>();
    const dirtyFloors = new Set<THREE.BufferAttribute>();
    const dirtyModifiedAges = new Set<THREE.BufferAttribute>();
    const dirtyIconUVs = new Set<THREE.BufferAttribute>();
    // A street's opacity is the max of its buildings', so the whole block fades together.
    const maxOp = new Map<Street, number>();
    // Keyed by path so ad panels fade in lockstep with their building body.
    const opByPath = new Map<string, number>();

    // Recency denominator: how far back "fully weathered" sits, in commit indices.
    const historySpan = Math.max(1, (TIMELINE_BUNDLE.peek()?.commits.length ?? 1) - 1);
    const ruinsOn = RUINS_ENABLED.peek();
    const ruinHeight = RUIN_HEIGHT_FLOORS * BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT;

    for (const { b, pt, streets, createdIdx } of entries) {
      const state = ruinStateAt(pt, pos);
      const present = state === 'present';
      const ruin = state === 'ruin' && ruinsOn;
      // present → genesis grow-in ramp; ruin → faint stub; before-genesis or ruins-off deletion → gone.
      const op = present ? presenceAt(pt, pos, 0) : ruin ? RUIN_OPACITY : 0;

      // Footprint + street opacity are driven for EVERY union building, even one
      // in an LOD cell with no detail mesh (getMeshForBuilding → null on a large
      // repo). Skipping them below would strand the footprint at its opaque
      // default and under-count the street's max-opacity.
      for (const street of streets) maxOp.set(street, Math.max(maxOp.get(street) ?? 0, op));
      opByPath.set(b.file.path, op);
      deps.footprints.setBuildingFootprintOpacity(b.file.path, op);

      const resolved = deps.getMeshForBuilding(b);
      if (!resolved) continue;
      const { mesh, slot } = resolved;

      const iFloorsAttr = mesh.geometry.getAttribute('iFloors') as
        | THREE.BufferAttribute
        | undefined;
      if (present) {
        // Gate height on presence (intervals), not line count: media/empty files are present with 0 lines.
        const dims = getBuildingDimensions(
          { ...b.file, lines: linesAt(pt, pos) },
          deps.heightCtx.lineStats,
          deps.heightCtx.byteStats
        );
        if (iFloorsAttr) {
          iFloorsAttr.setX(slot, dims.floors);
          dirtyFloors.add(iFloorsAttr);
        }
        _m.makeScale(b.w, dims.h, b.d);
        _m.setPosition(b.x, dims.h / 2, b.y);
      } else if (ruin) {
        // A deleted building: uniform low stub, blank facade (0 window rows) — reads as rubble.
        if (iFloorsAttr) {
          iFloorsAttr.setX(slot, 0);
          dirtyFloors.add(iFloorsAttr);
        }
        _m.makeScale(b.w, ruinHeight, b.d);
        _m.setPosition(b.x, ruinHeight / 2, b.y);
      } else {
        // Absent → fully zero-scaled, not a flat (w, 0, d) quad that would still
        // write depth and outline as a cutout on the road.
        _m.makeScale(0, 0, 0);
      }
      mesh.setMatrixAt(slot, _m);
      dirtyMeshes.add(mesh);

      const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
      if (iFade) {
        // Outline (.z) only while present, so a leftover Live-mode outline can't linger on a ruin/absent building.
        iFade.setXYZ(slot, op, iFade.getY(slot), present ? iFade.getZ(slot) : 0);
        dirtyFades.add(iFade);
      }

      // Weather: color/lit-windows/grime-age re-evaluated from recency relative to the
      // scrub position, not a fixed date. Absent buildings are already scaled/faded to
      // 0, so skip them.
      if (present) {
        const lastModifiedIndex = lastModifiedIndexAt(pt, pos);
        // 0=just modified, 1=historySpan-ago-or-more — matches getModifiedAge's polarity
        // (iModifiedAge/vModifiedAge: 0=most recent, 1=longest-untouched) directly.
        const modifiedAgeAtScrub = Math.max(
          0,
          Math.min(1, (pos - lastModifiedIndex) / historySpan)
        );
        const recency = 1 - modifiedAgeAtScrub;
        _color.set(
          getBuildingColorForRecency(
            b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
            recency
          )
        );
        mesh.setColorAt(slot, _color);
        dirtyColors.add(mesh);

        const iModifiedAgeAttr = mesh.geometry.getAttribute('iModifiedAge') as
          | THREE.BufferAttribute
          | undefined;
        if (iModifiedAgeAttr) {
          iModifiedAgeAttr.setX(slot, modifiedAgeAtScrub);
          dirtyModifiedAges.add(iModifiedAgeAttr);
        }

        // Same 0=new/1=old polarity as getCreatedAge, on the creation-date axis instead.
        const createdAgeAtScrub = Math.max(0, Math.min(1, (pos - createdIdx) / historySpan));
        const iIconUVAttr = mesh.geometry.getAttribute('iIconUV') as
          | THREE.BufferAttribute
          | undefined;
        if (iIconUVAttr) {
          iIconUVAttr.setW(slot, createdAgeAtScrub);
          dirtyIconUVs.add(iIconUVAttr);
        }
      } else if (ruin) {
        // A ghost ruin keeps a muted memory of its file's hue, pulled toward gray.
        _color
          .set(
            getBuildingColorForRecency(
              b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
              RUIN_BASE_RECENCY
            )
          )
          .lerp(_RUIN_GRAY, RUIN_GRAY_MIX);
        mesh.setColorAt(slot, _color);
        dirtyColors.add(mesh);
      }
    }

    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (const iFade of dirtyFades) iFade.needsUpdate = true;
    for (const mesh of dirtyColors) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const attr of dirtyFloors) attr.needsUpdate = true;
    for (const attr of dirtyModifiedAges) attr.needsUpdate = true;
    for (const attr of dirtyIconUVs) attr.needsUpdate = true;
    deps.getAdPanels()?.applyBuildingFades((p) => opByPath.get(p) ?? null);
    // Every street gets written each frame (defaulting to 0) so an orphaned street can't stick at a stale opacity.
    // ROOT is forced to 1: the repo root directory always exists, even when scrubbed back to an empty tree.
    for (const street of allStreets) {
      const op = street.isRoot ? 1 : (maxOp.get(street) ?? 0);
      deps.streets.setStreetOpacity(street, op);
      deps.streets.setStreetLabelOpacity(street, op);
      if (street.dir?.path != null) deps.footprints.setStreetFootprintOpacity(street.dir.path, op);
    }
  }

  function dispose(): void {
    entries.length = 0;
  }

  return { update, dispose };
}
