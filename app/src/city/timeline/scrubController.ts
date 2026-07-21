// city/timeline/scrubController.ts — per-frame building driver for Timeline mode.
//
// Reads SCRUB_POS and writes each union building's height (instance matrix
// scaleY, tween.ts field) + presence opacity (iFade.x, fader.ts field) with no
// re-pack. It owns BOTH fields while in mode; the tween queue and fader are
// dormant (index.ts gates them on TIMELINE_MODE).

import * as THREE from 'three';

import { SCRUB_POS } from '@/state/stores/timeline';
import { buildingHeightForLines } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import type { Building, Street } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import { parentDirPath } from '@/city/utils/path';
import { isPresent, linesAt, presenceAt } from './replay';
import type { PathTimeline } from './replay';

// v1: deleted things fully vanish. A future "ghost ruins" toggle flips this to a
// small floor so removed buildings persist faintly.
export const RUIN_FLOOR = 0;

export interface ScrubControllerDeps {
  getBuildingIndex(): BuildingIndex | null;
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  timelines: Map<string, PathTimeline>;
  heightCtx: HeightContext;
  streets: { setStreetOpacity(street: Street, opacity: number): void };
  // { street dir.path → Street } from the union layout, for resolving a building's street.
  streetsByDir: Record<string, Street>;
}

export function createScrubController(deps: ScrubControllerDeps) {
  // Pair each union building with its replay timeline + street once; buildings
  // without a timeline (never touched in the window) are left at their baseline.
  const entries: { b: Building; pt: PathTimeline; street: Street | undefined }[] = [];
  const allStreets: Street[] = [];
  const index = deps.getBuildingIndex();
  if (index) {
    for (const b of index.byPath.values()) {
      const path = b.file?.path;
      if (!path) continue;
      const pt = deps.timelines.get(path);
      if (!pt) continue;
      const dir = parentDirPath(path);
      const street = dir != null ? deps.streetsByDir[dir] : undefined;
      entries.push({ b, pt, street });
    }
  }
  for (const street of Object.values(deps.streetsByDir)) allStreets.push(street);

  const _m = new THREE.Matrix4();

  function update(): void {
    const pos = SCRUB_POS.peek();
    const dirtyMeshes = new Set<THREE.InstancedMesh>();
    const dirtyFades = new Set<THREE.BufferAttribute>();
    // A street's opacity is the max of its buildings', so the whole block fades together.
    const maxOp = new Map<Street, number>();

    for (const { b, pt, street } of entries) {
      const resolved = deps.getMeshForBuilding(b);
      if (!resolved) continue;
      const { mesh, slot } = resolved;

      const lines = linesAt(pt, pos);
      // Gate on presence (intervals), not line count: media/empty files are present with 0 lines.
      const f = isPresent(pt, pos) && b.h > 0 ? buildingHeightForLines(b.file, lines, deps.heightCtx) / b.h : 0;
      const sy = b.h * f;
      _m.makeScale(b.w, sy, b.d);
      _m.setPosition(b.x, sy / 2, b.y);
      mesh.setMatrixAt(slot, _m);
      dirtyMeshes.add(mesh);

      const op = presenceAt(pt, pos, RUIN_FLOOR);
      if (street) maxOp.set(street, Math.max(maxOp.get(street) ?? 0, op));

      const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
      if (iFade) {
        iFade.setXYZ(slot, op, iFade.getY(slot), iFade.getZ(slot));
        dirtyFades.add(iFade);
      }
    }

    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (const iFade of dirtyFades) iFade.needsUpdate = true;
    // Every street gets written each frame (defaulting to 0) so an orphaned street can't stick at a stale opacity.
    for (const street of allStreets) deps.streets.setStreetOpacity(street, maxOp.get(street) ?? 0);
  }

  function dispose(): void {
    entries.length = 0;
  }

  return { update, dispose };
}
