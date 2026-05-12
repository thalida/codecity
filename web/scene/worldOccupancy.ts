// worldOccupancy.ts — thin facade over rbush. Global occupancy structure
// for the Tier B packer. Owns insert + overlap query. Knows nothing about
// streets, sides, mirrors, or tree structure. All coordinates in world
// frame.

import RBush from 'rbush';
import type { Building, BuildingPath, Street } from '@/types';

// Touches at edges (zero-area overlap) are NOT reported as overlap.
// Same convention as the v3 packer's _rectsOverlap.
const OVERLAP_EPS = 1e-9;

export type WorldRectKind = 'building' | 'street' | 'path';

export interface WorldRect {
  // rbush requires these exact field names.
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // Payload — what kind of thing is this, what does it belong to.
  kind: WorldRectKind;
  ref: Building | Street | BuildingPath;
}

export class WorldOccupancy {
  private tree: RBush<WorldRect>;

  constructor() {
    this.tree = new RBush<WorldRect>();
  }

  insert(rect: WorldRect): void {
    this.tree.insert(rect);
  }

  insertBatch(rects: WorldRect[]): void {
    this.tree.load(rects);
  }

  // remove — strip rect by reference equality. Used by the backward-pack
  // post-pass: remove a child's rects, shift their positions, re-insert.
  // rbush.remove defaults to reference equality which is what we want.
  remove(rect: WorldRect): void {
    this.tree.remove(rect);
  }

  query(minX: number, minY: number, maxX: number, maxY: number): WorldRect[] {
    return this.tree.search({ minX, minY, maxX, maxY }).filter((r) =>
      // Strict overlap (touching edges return false).
      r.minX < maxX - OVERLAP_EPS &&
      r.maxX > minX + OVERLAP_EPS &&
      r.minY < maxY - OVERLAP_EPS &&
      r.maxY > minY + OVERLAP_EPS
    );
  }

  hasOverlap(minX: number, minY: number, maxX: number, maxY: number): boolean {
    return this.query(minX, minY, maxX, maxY).length > 0;
  }

  size(): number {
    return this.tree.all().length;
  }

  all(): WorldRect[] {
    return this.tree.all();
  }
}
