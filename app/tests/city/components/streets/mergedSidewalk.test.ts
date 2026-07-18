// mergedSidewalk.test.ts — all sidewalks render as ONE merged mesh (was ~8k draw
// calls). Picking must still resolve a raycast hit to its street, so the mesh
// bakes a faceIndex→street map. This guards that every street's face range maps
// back to that street (the directory-picking path) and that the per-street vertex
// spans line up (the hover/selection tint path).

import { describe, it, expect, beforeEach } from 'vitest';
import { createMergedSidewalkMesh, sidewalkStreetForFace } from '@/city/components/streets/streets';
import { STREETS } from '@/state/stores/settings/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

const DEFAULTS = {
  ASPHALT_COLOR: '#313544',
  SIDEWALK_DEFAULT: '#4b5163',
  SIDEWALK_HOVER: '#6d6e74',
  SIDEWALK_SELECTED: '#ffffff',
  LABEL_FILL: '#ffffff',
  LABEL_STROKE: 'rgba(8, 9, 14, 0.95)',
  LABEL_STROKE_WIDTH_FRAC: 0.2,
  LABEL_HEIGHT_FRAC: 0.5,
  PATH_LINEWIDTH_PCT: 15,
  PATH_OPACITY: 0.95,
  HOVER_PATH_COLOR: '#ffffff',
  HOVER_PATH_OPACITY: 0.25,
};

function mkStreet(path: string, over: Partial<Street> = {}): Street {
  return {
    x: 0,
    y: 0,
    width: 24,
    length: 400,
    label: path,
    orientation: StreetAxis.X,
    isRoot: false,
    dir: { name: path, path, type: NodeKind.Directory },
    ...over,
  } as unknown as Street;
}

describe('merged sidewalk mesh', () => {
  beforeEach(() => {
    STREETS.value = { ...DEFAULTS } as unknown as typeof STREETS.value;
  });

  it('returns null for an empty street list', () => {
    expect(createMergedSidewalkMesh([], 0)).toBeNull();
  });

  it('merges all streets into one mesh with contiguous per-street ranges', () => {
    const streets = [
      mkStreet('a', { x: 0, isRoot: true }),
      mkStreet('b', { x: 500, orientation: StreetAxis.Y }),
      mkStreet('c', { x: -500, length: 800 }),
    ];
    const out = createMergedSidewalkMesh(streets, 0)!;
    expect(out).not.toBeNull();
    expect(out.ranges).toHaveLength(3);

    // Vertex ranges are contiguous + in build order; faceStarts strictly ascend
    // (each street occupies a nonempty face range) — the picking test checks the
    // exact face→street mapping.
    let v = 0;
    for (let i = 0; i < 3; i++) {
      expect(out.ranges[i].vStart).toBe(v);
      expect(out.ranges[i].path).toBe(streets[i].dir!.path);
      if (i > 0) expect(out.ranges[i].faceStart).toBeGreaterThan(out.ranges[i - 1].faceStart);
      v += out.ranges[i].vCount;
    }
    // The color attribute covers every vertex.
    const color = out.mesh.geometry.getAttribute('color');
    expect(color.count).toBe(out.mesh.geometry.getAttribute('position').count);
  });

  it('resolves any face of a street back to that street (picking)', () => {
    const streets = [mkStreet('a'), mkStreet('b', { x: 500 }), mkStreet('c', { x: -500 })];
    const out = createMergedSidewalkMesh(streets, 0)!;
    const totalFaces = out.mesh.geometry.index!.count / 3;

    for (let i = 0; i < out.ranges.length; i++) {
      const r = out.ranges[i];
      const nextStart = i + 1 < out.ranges.length ? out.ranges[i + 1].faceStart : totalFaces;
      // First, middle, and last face of this street all resolve to it.
      for (const fi of [r.faceStart, (r.faceStart + nextStart - 1) >> 1, nextStart - 1]) {
        expect(sidewalkStreetForFace(out.mesh, fi)).toBe(streets[i]);
      }
    }
  });

  it('sidewalkStreetForFace returns null when the mesh has no map', () => {
    const streets = [mkStreet('a')];
    const out = createMergedSidewalkMesh(streets, 0)!;
    delete out.mesh.userData.pickStreets;
    expect(sidewalkStreetForFace(out.mesh, 0)).toBeNull();
  });
});
