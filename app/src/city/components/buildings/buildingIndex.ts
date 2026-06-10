// city/components/buildings/buildingIndex.ts — Lookup adapter that decouples consumers
// (picker, fader, outline, animator, manifest-diff) from the
// CellTile rendering layout. Two indexes:
//   - byPath:      path → Building            (manifest diff, hover-by-path)
//   - byCellSlot:  "cellId:slotId" → Building (raycaster hits)
//
// Building objects carry their own (cellId, slotId) back-pointers
// so reverse lookups are O(1). A fresh index is built per rebuild
// (cellAssembly), so there is no removal/clearing API.

import type { Building } from '@/types/index';

export class BuildingIndex {
  readonly byPath = new Map<string, Building>();
  private readonly _byCellSlot = new Map<string, Building>();

  insert(b: Building): void {
    const path = b.file?.path;
    if (!path) return;
    this.byPath.set(path, b);
    this._byCellSlot.set(`${b.cellId}:${b.slotId}`, b);
  }

  byCellSlot(key: string): Building | undefined {
    return this._byCellSlot.get(key);
  }
}
