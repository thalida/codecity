import { describe, expect, it } from 'vitest';
import { WorldOccupancy, type WorldRect } from '@/scene/worldOccupancy';

// Helper to build a WorldRect from {x, y, w, d} for terse tests.
function mkRect(x: number, y: number, w: number, d: number): WorldRect {
  return {
    minX: x - w / 2,
    minY: y - d / 2,
    maxX: x + w / 2,
    maxY: y + d / 2,
    kind: 'building',
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
});
