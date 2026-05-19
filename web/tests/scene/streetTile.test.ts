import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '@/scene/spatialGrid.js';
import { buildCellStreetMesh, type SidewalkRect } from '@/scene/instanced/streetTile.js';

describe('streetTile', () => {
  it('merges rects whose centroid is inside the cell', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 24, minZ: 0, maxZ: 24 });
    // Cell 0 covers [0,12) × [0,12)
    const rects: SidewalkRect[] = [
      { x: 2, z: 2, w: 4, d: 4, color: '#888' },   // centroid (4,4) — in cell 0
      { x: 16, z: 4, w: 4, d: 4, color: '#888' },  // centroid (18,6) — in cell 1
    ];

    const mesh0 = buildCellStreetMesh(grid, 0, rects);
    expect(mesh0).not.toBeNull();
    // Cell 0 should have 1 quad (4 verts) merged
    expect(mesh0!.geometry.getAttribute('position').count).toBe(4);

    const mesh1 = buildCellStreetMesh(grid, 1, rects);
    expect(mesh1!.geometry.getAttribute('position').count).toBe(4);
  });

  it('returns null for cells with no sidewalks', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 24, minZ: 0, maxZ: 24 });
    expect(buildCellStreetMesh(grid, 2, [])).toBeNull();
  });
});
