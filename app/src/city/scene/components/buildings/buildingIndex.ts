// city/scene/components/buildings/buildingIndex.ts — the two lookups everything
// downstream uses instead of knowing the cell layout: path → Building, and
// "cellId:slotId" → Building for a raycast hit. Each Building carries those
// back-pointers, and a rebuild makes a fresh index, so nothing removes.

import type { Building } from '@/city/scene/types';

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
