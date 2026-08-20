// Overrides are merged field by field rather than spread: spreading a
// Partial<Building> defeats TS narrowing and forces a cast at every call site.

import { BuildingOrient, NodeKind } from '@/types';
import type { Building, FileNode } from '@/types';

const DEFAULT_FILE: FileNode = {
  name: 'file.ts',
  type: NodeKind.File,
  path: 'src/file.ts',
  extension: '.ts',
  size: 100,
  lines: 10,
  binary: false,
  dirty: false,
  created: '',
  modified: '',
};

/**
 * Build a Building with sensible defaults. Override any field via the param.
 * Use this everywhere instead of inline fakeBuilding / makeBuilding /
 * makeFakeBuilding.
 *
 * Defaults satisfy every required field of Building (no cast needed). The
 * required-field set is small (x, y, w, d, h, color, file, orient); optional
 * fields (createdAge, modifiedAge, floors, cellId, slotId) default
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
  };
}
