import { Building, BuildingOrient, FileNode, NodeKind } from '@codecity/city';
// Overrides are merged field by field rather than spread: spreading a
// Partial<Building> defeats TS narrowing and forces a cast at every call site.

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

/** A Building with every required field defaulted, so no call site needs a cast.
 *  Optional fields stay undefined until overridden, as layout leaves them. */
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
