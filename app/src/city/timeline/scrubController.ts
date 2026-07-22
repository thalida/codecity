// city/timeline/scrubController.ts — per-frame building driver for Timeline mode.
//
// Reads SCRUB_POS and writes each union building's height (instance matrix
// scaleY, tween.ts field) + presence opacity (iFade.x, fader.ts field) + weathered
// color (instanceColor) with no re-pack. It owns these fields while in mode; the
// tween queue and fader are dormant (index.ts gates them on TIMELINE_MODE).

import * as THREE from 'three';

import { SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { buildingHeightForLines } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import type { Building, Street } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import { getBuildingColorForRecency } from '@/city/components/buildings/color';
import { parentDirPath } from '@/city/utils/path';
import { streetChainForDirPath } from '@/city/layout/streetPath';
import { isPresent, lastModifiedIndexAt, linesAt, presenceAt } from './replay';
import type { PathTimeline } from './replay';

// v1: deleted things fully vanish. A future "ghost ruins" toggle flips this to a
// small floor so removed buildings persist faintly.
export const RUIN_FLOOR = 0;

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
  const entries: { b: Building; pt: PathTimeline; streets: Street[] }[] = [];
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
      entries.push({ b, pt, streets });
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
    // A street's opacity is the max of its buildings', so the whole block fades together.
    const maxOp = new Map<Street, number>();
    // Keyed by path so ad panels fade in lockstep with their building body.
    const opByPath = new Map<string, number>();

    // Recency denominator: how far back "fully weathered" sits, in commit indices.
    const historySpan = Math.max(1, (TIMELINE_BUNDLE.peek()?.commits.length ?? 1) - 1);

    for (const { b, pt, streets } of entries) {
      const resolved = deps.getMeshForBuilding(b);
      if (!resolved) continue;
      const { mesh, slot } = resolved;

      const present = isPresent(pt, pos);
      const lines = linesAt(pt, pos);
      // Gate on presence (intervals), not line count: media/empty files are present with 0 lines.
      const f =
        present && b.h > 0 ? buildingHeightForLines(b.file, lines, deps.heightCtx) / b.h : 0;
      const sy = b.h * f;
      _m.makeScale(b.w, sy, b.d);
      _m.setPosition(b.x, sy / 2, b.y);
      mesh.setMatrixAt(slot, _m);
      dirtyMeshes.add(mesh);

      const op = presenceAt(pt, pos, RUIN_FLOOR);
      for (const street of streets) maxOp.set(street, Math.max(maxOp.get(street) ?? 0, op));
      opByPath.set(b.file.path, op);
      deps.footprints.setBuildingFootprintOpacity(b.file.path, op);

      const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
      if (iFade) {
        iFade.setXYZ(slot, op, iFade.getY(slot), iFade.getZ(slot));
        dirtyFades.add(iFade);
      }

      // Weather: color re-evaluated from recency relative to the scrub position, not a fixed date.
      // Absent buildings are already scaled/faded to 0, so skip coloring them.
      if (present) {
        const lastModifiedIndex = lastModifiedIndexAt(pt, pos);
        const recency = 1 - Math.max(0, Math.min(1, (pos - lastModifiedIndex) / historySpan));
        _color.set(
          getBuildingColorForRecency(
            b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
            recency
          )
        );
        mesh.setColorAt(slot, _color);
        dirtyColors.add(mesh);
      }
    }

    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (const iFade of dirtyFades) iFade.needsUpdate = true;
    for (const mesh of dirtyColors) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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
