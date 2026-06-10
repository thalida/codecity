// Canonical Building test factory — replaces 4 variant factories that had
// begun to drift across:
//   - app/tests/city/cellAssembly.test.ts            (fakeBuilding, `as Building`)
//   - app/tests/city/cellMesh.test.ts (fakeBuilding, `as Building`)
//   - app/tests/city/buildingIndex.test.ts           (makeBuilding, `as unknown as Building`)
//   - app/tests/city/trees/treePlacement.test.ts     (makeBuilding, `as never`)
//
// The `as Building` / `as unknown as Building` / `as never` casts in the
// prior versions were not load-bearing — every variant actually produced a
// shape compatible with Building. The casts existed only because spreading
// `...overrides: Partial<Building>` defeats TS narrowing. This helper avoids
// that by not spreading — it merges overrides field-by-field via `??`.
// Task 9 migrates the call sites.

import { BuildingOrient, NodeKind } from '@/types';
import type { Building, FileNode } from '@/types';

const DEFAULT_FILE: FileNode = {
  name: 'file.ts',
  type: NodeKind.File,
  path: 'src/file.ts',
  fullPath: '/abs/src/file.ts',
  extension: '.ts',
  size: 100,
  lines: 10,
  binary: false,
  created: '',
  modified: '',
  git: { created: null, modified: null },
};

/**
 * Build a Building with sensible defaults. Override any field via the param.
 * Use this everywhere instead of inline fakeBuilding / makeBuilding /
 * makeFakeBuilding.
 *
 * Defaults satisfy every required field of Building (no cast needed). The
 * required-field set is small (x, y, w, d, h, color, file, orient); optional
 * fields (createdAge, modifiedAge, floors, cellId, slotId, dirNode) default
 * to undefined and only appear when overridden — matches the production
 * shape where layout produces buildings without ages/cellId/slotId and
 * later steps fill them in.
 */
export function building(overrides: Partial<Building> = {}): Building {
  return {
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 2,
    d: overrides.d ?? 2,
    h: overrides.h ?? 4,
    color: overrides.color ?? '#aabbcc',
    orient: overrides.orient ?? BuildingOrient.South,
    file: overrides.file ?? DEFAULT_FILE,
    ...(overrides.floors !== undefined && { floors: overrides.floors }),
    ...(overrides.cellId !== undefined && { cellId: overrides.cellId }),
    ...(overrides.slotId !== undefined && { slotId: overrides.slotId }),
    ...(overrides.createdAge !== undefined && { createdAge: overrides.createdAge }),
    ...(overrides.modifiedAge !== undefined && { modifiedAge: overrides.modifiedAge }),
    ...(overrides.dirNode !== undefined && { dirNode: overrides.dirNode }),
  };
}
