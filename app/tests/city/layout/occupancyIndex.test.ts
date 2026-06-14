import { describe, expect, it } from 'vitest';
import { WorldRectKind } from '@/city/layout/occupancyIndex';
import { WorldOccupancy, type WorldRect } from '@/city/layout/occupancyIndex';

// Helper to build a WorldRect from {x, y, w, d} for terse tests.
function mkRect(x: number, y: number, w: number, d: number): WorldRect {
  return {
    minX: x - w / 2,
    minY: y - d / 2,
    maxX: x + w / 2,
    maxY: y + d / 2,
    kind: WorldRectKind.Building,
    // We don't care about ref for these tests; cast a stub.
    ref: { x, y, w, d } as unknown as WorldRect['ref'],
  };
}

describe('WorldOccupancy.insert + query', () => {
  it('inserting a single rect makes it queryable in its own bbox', () => {
    const occ = new WorldOccupancy();
    const r = mkRect(10, 10, 4, 4); // covers [8, 8] – [12, 12]
    occ.insert(r);
    const hits = occ.query(0, 0, 20, 20);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(r);
  });

  it('querying a disjoint region returns empty', () => {
    const occ = new WorldOccupancy();
    occ.insert(mkRect(10, 10, 4, 4));
    expect(occ.query(100, 100, 110, 110)).toHaveLength(0);
  });

  it('multiple inserts: query returns the overlapping subset', () => {
    const occ = new WorldOccupancy();
    const a = mkRect(10, 10, 4, 4); // [8,8]–[12,12]
    const b = mkRect(50, 50, 4, 4); // [48,48]–[52,52]
    const c = mkRect(10, 50, 4, 4); // [8,48]–[12,52]
    occ.insert(a);
    occ.insert(b);
    occ.insert(c);
    const hits = occ.query(0, 0, 20, 20);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(a);
  });

  it('size() reflects insert count', () => {
    const occ = new WorldOccupancy();
    expect(occ.size()).toBe(0);
    occ.insert(mkRect(10, 10, 4, 4));
    expect(occ.size()).toBe(1);
    occ.insert(mkRect(50, 50, 4, 4));
    expect(occ.size()).toBe(2);
  });

  it('hasOverlap returns true when query region overlaps any rect', () => {
    const occ = new WorldOccupancy();
    occ.insert(mkRect(10, 10, 4, 4));
    expect(occ.hasOverlap(0, 0, 20, 20)).toBe(true);
  });

  it('hasOverlap returns false when query region is disjoint', () => {
    const occ = new WorldOccupancy();
    occ.insert(mkRect(10, 10, 4, 4));
    expect(occ.hasOverlap(100, 100, 110, 110)).toBe(false);
  });

  it('touching-edge rects are NOT reported as overlap (strict)', () => {
    const occ = new WorldOccupancy();
    occ.insert(mkRect(0, 0, 10, 10)); // [-5,-5]–[5,5]
    // Query region touches the inserted rect at x=5 (shared edge).
    expect(occ.hasOverlap(5, -5, 15, 5)).toBe(false);
    // Slight overlap (beyond OVERLAP_EPS=1e-9) is reported.
    expect(occ.hasOverlap(5 - 1e-6, -5, 15, 5)).toBe(true);
  });

  it('all() returns every inserted rect', () => {
    const occ = new WorldOccupancy();
    const a = mkRect(10, 10, 4, 4);
    const b = mkRect(50, 50, 4, 4);
    occ.insert(a);
    occ.insert(b);
    const all = occ.all();
    expect(all).toHaveLength(2);
    expect(all).toContain(a);
    expect(all).toContain(b);
  });

  it('insertBatch produces same query results as N inserts', () => {
    const rects = [
      mkRect(10, 10, 4, 4),
      mkRect(50, 50, 4, 4),
      mkRect(10, 50, 4, 4),
      mkRect(50, 10, 4, 4),
      mkRect(30, 30, 4, 4),
    ];
    const occBatch = new WorldOccupancy();
    occBatch.insertBatch(rects);
    const occSequential = new WorldOccupancy();
    for (const r of rects) occSequential.insert(r);

    expect(occBatch.size()).toBe(rects.length);
    expect(occSequential.size()).toBe(rects.length);

    // Same hits for the same query region.
    const batchHits = occBatch.query(0, 0, 20, 20);
    const seqHits = occSequential.query(0, 0, 20, 20);
    expect(batchHits.length).toBe(seqHits.length);
    expect(new Set(batchHits)).toEqual(new Set(seqHits));
  });
});
