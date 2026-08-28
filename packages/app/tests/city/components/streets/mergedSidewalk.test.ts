// All sidewalks are ONE merged mesh, down from ~8k draw calls, so picking has to
// resolve a raycast hit through a baked faceIndex-to-street map. This guards
// that map and the per-street vertex spans the hover tint uses.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMergedSidewalkMesh, sidewalkStreetForFace } from '@/city/components/streets/streets';
import { STREETS } from '@/state/settings/fields/streets';
import { NodeKind } from '@/city/types/manifest';
import { Street, StreetAxis } from '@/city/types/street';
import { settingsStore } from '../../../_helpers/citySettings';

const SETTINGS = settingsStore();

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
    expect(createMergedSidewalkMesh([], 0, SETTINGS)).toBeNull();
  });

  it('merges all streets into one mesh with contiguous per-street ranges', () => {
    const streets = [
      mkStreet('a', { x: 0, isRoot: true }),
      mkStreet('b', { x: 500, orientation: StreetAxis.Y }),
      mkStreet('c', { x: -500, length: 800 }),
    ];
    const out = createMergedSidewalkMesh(streets, 0, SETTINGS)!;
    expect(out).not.toBeNull();
    expect(out.ranges).toHaveLength(3);

    // Contiguous and in build order, so faceStarts strictly ascend; the exact
    // mapping is the picking test's job.
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
    const out = createMergedSidewalkMesh(streets, 0, SETTINGS)!;
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
    const out = createMergedSidewalkMesh(streets, 0, SETTINGS)!;
    delete out.mesh.userData.pickStreets;
    expect(sidewalkStreetForFace(out.mesh, 0)).toBeNull();
  });
});
