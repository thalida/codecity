// city/layout/occupancyIndex.ts — thin facade over rbush. Global occupancy structure
// for the Tier B packer. Owns insert + overlap query. Knows nothing about
// streets, sides, mirrors, or tree structure. All coordinates in world
// frame.

import RBush from 'rbush';
import type { Building, Street } from '@codecity/city';

// Touches at edges (zero-area overlap) are NOT reported as overlap.
const OVERLAP_EPS = 1e-9;

// String enum so callers reference WorldRectKind.Street instead of the
// raw 'street' literal. Mirrors the MediaKind / NodeKind convention.
export enum WorldRectKind {
  Building = 'building',
  Street = 'street',
}

export interface WorldRect {
  // rbush requires these exact field names.
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // Payload — what kind of thing is this, what does it belong to.
  kind: WorldRectKind;
  ref: Building | Street;
  // True only for the phantom strip seeded to clear a child off its PARENT
  // street body. It's a Street rect but NOT a sibling, so the sibling-gap
  // logic (findSmallestValidStem) must not apply the street gap to it — the
  // join clearance is PARENT_JOIN_PAD's job, not the sibling gap's.
  parentBody?: boolean;
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

  query(minX: number, minY: number, maxX: number, maxY: number): WorldRect[] {
    // Compact in place: rbush allocated this array, and ~3M queries over ~32M
    // results make a second array + pass per query not free.
    const found = this.tree.search({ minX, minY, maxX, maxY });
    let kept = 0;
    for (let i = 0; i < found.length; i++) {
      const r = found[i];
      // Strict overlap (touching edges return false).
      if (
        r.minX < maxX - OVERLAP_EPS &&
        r.maxX > minX + OVERLAP_EPS &&
        r.minY < maxY - OVERLAP_EPS &&
        r.maxY > minY + OVERLAP_EPS
      ) {
        found[kept++] = r;
      }
    }
    found.length = kept;
    return found;
  }

  hasOverlap(minX: number, minY: number, maxX: number, maxY: number): boolean {
    // Stops at the first hit instead of compacting the whole result just to
    // read `.length > 0`.
    for (const r of this.tree.search({ minX, minY, maxX, maxY })) {
      if (
        r.minX < maxX - OVERLAP_EPS &&
        r.maxX > minX + OVERLAP_EPS &&
        r.minY < maxY - OVERLAP_EPS &&
        r.maxY > minY + OVERLAP_EPS
      ) {
        return true;
      }
    }
    return false;
  }

  size(): number {
    return this.tree.all().length;
  }

  all(): WorldRect[] {
    return this.tree.all();
  }
}
