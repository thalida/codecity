// slimManifest.test.ts — the layout worker is sent only { tree, stats }, not the
// full Manifest, because the commits array (up to ~1M entries) would otherwise
// structured-clone across postMessage on the main thread every apply for
// nothing (layoutCity reads only tree + stats). This guards that the slim slice
// produces a byte-identical layout to the full manifest — i.e. dropping commits
// (and the rest of the envelope) can't change the city.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm';
import { makeRng, genWeightedTree, genCommits } from '../../_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from '../../_helpers/statsFixtures';

// Geometry-only projection (buildings + streets), safe to JSON-compare: avoids
// the file/dir refs (dir.children is cyclic) while capturing everything the
// layout output actually determines.
function geometryDigest(layout: ReturnType<typeof layoutCity>): string {
  return JSON.stringify({
    buildings: layout.buildings.map((b) => [b.x, b.y, b.w, b.d, b.h, b.floors, b.file?.path]),
    streets: layout.streets.map((s) => [
      s.x,
      s.y,
      s.length,
      s.width,
      s.orientation,
      s.isRoot,
      s.dir?.path,
    ]),
    lineStats: layout.lineStats,
    byteStats: layout.byteStats,
  });
}

describe('layout worker payload slimming', () => {
  it('layoutCity({tree, stats}) matches layoutCity(fullManifest)', () => {
    const tree = genWeightedTree('root', 'root', 4000, 0, makeRng(0xc0ffee));
    const commits = genCommits(20_000, makeRng(7));
    const stats = { ...commitStats(commits), ...fileStats(tree) };

    // What applyManifest holds vs what compute() now posts to the worker.
    const fullManifest = {
      tree,
      stats,
      commits,
      dateRanges: {},
      tree_signature: 'sig',
      layout_signature: 'sig',
      busyness: { avg: 1, busy: 1 },
    };
    const slice = { tree, stats };

    const full = layoutCity(fullManifest as unknown as Parameters<typeof layoutCity>[0]);
    const slim = layoutCity(slice as unknown as Parameters<typeof layoutCity>[0]);

    expect(slim.buildings.length).toBe(full.buildings.length);
    expect(slim.streets.length).toBe(full.streets.length);
    expect(geometryDigest(slim)).toBe(geometryDigest(full));
  });
});
