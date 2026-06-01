// scene/components/buildings/buildingIndex.ts — Lookup adapter that decouples consumers
// (picker, fader, outline, animator, manifest-diff) from the
// CellTile rendering layout. Three indexes:
//   - byPath:      path → Building            (manifest diff, hover-by-path)
//   - byCellSlot:  "cellId:slotId" → Building (raycaster hits)
//   - byDir:       DirNode → Building[]       (dir walk)
//
// Building objects carry their own (cellId, slotId) back-pointers
// so reverse lookups are O(1). Inserts/removes update all three
// maps atomically.

import type { Building } from '@/types/index';
import type { DirNode } from '@/types/manifest';

export class BuildingIndex {
  readonly byPath = new Map<string, Building>();
  private readonly _byCellSlot = new Map<string, Building>();
  private readonly _byDir = new Map<DirNode, Building[]>();

  insert(b: Building): void {
    const path = b.file?.path;
    if (!path) return;
    this.byPath.set(path, b);
    this._byCellSlot.set(`${b.cellId}:${b.slotId}`, b);
    if (b.dirNode) {
      let list = this._byDir.get(b.dirNode);
      if (!list) {
        list = [];
        this._byDir.set(b.dirNode, list);
      }
      list.push(b);
    }
  }

  remove(b: Building): void {
    const path = b.file?.path;
    if (path) this.byPath.delete(path);
    this._byCellSlot.delete(`${b.cellId}:${b.slotId}`);
    if (b.dirNode) {
      const list = this._byDir.get(b.dirNode);
      if (list) {
        const i = list.indexOf(b);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this._byDir.delete(b.dirNode);
      }
    }
  }

  byCellSlot(key: string): Building | undefined {
    return this._byCellSlot.get(key);
  }

  forEachInDir(dir: DirNode): readonly Building[] {
    return this._byDir.get(dir) ?? [];
  }

  clear(): void {
    this.byPath.clear();
    this._byCellSlot.clear();
    this._byDir.clear();
  }

  get size(): number {
    return this.byPath.size;
  }
}
