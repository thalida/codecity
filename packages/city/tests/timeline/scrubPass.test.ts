// The pass over a whole city: pairing buildings with their timelines and
// ancestor streets, then rolling their states up into street states. The
// per-building and per-street decisions are tested beside their components;
// only the rollup is new here.

import { describe, it, expect } from 'vitest';

import { createScrubPass } from '@/city/timeline/scrubPass';
import { StreetTint } from '@/city/components/streets/scrubState';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import { buildPathTimelines } from '@/city/timeline/replay';
import { makeBuilding, makeBundle, makeFile, makeScrubFrame } from '../_helpers/scrub';
import type { Street } from '@/city/types/street';
import type { TimelineBundle } from '@/city/types/timeline';

const street = (path: string, over: Partial<Street> = {}): Street =>
  ({ dir: { path }, ...over }) as unknown as Street;

/** d/ holds two files deleted together at commit 3; e/ holds one that survives.
 *  Everything is created at commit 1. */
const CITY_BUNDLE: TimelineBundle = makeBundle({
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
  deltas: [
    { sha: 'a', changes: [] },
    {
      sha: 'b',
      changes: [
        { path: 'd/f1.txt', sha: 's1' },
        { path: 'd/f2.txt', sha: 's1' },
        { path: 'e/f3.txt', sha: 's1' },
      ],
    },
    { sha: 'c', changes: [] },
    {
      sha: 'd',
      changes: [
        { path: 'd/f1.txt', sha: null },
        { path: 'd/f2.txt', sha: null },
      ],
    },
  ],
  blobLines: { s1: 6 },
} as never);

function makeCity(paths: string[], streetsByDir: Record<string, Street>, bundle = CITY_BUNDLE) {
  const index = new BuildingIndex();
  for (const path of paths) index.insert(makeBuilding(makeFile({ path })));
  return createScrubPass({
    buildingIndex: index,
    timelines: buildPathTimelines(bundle),
    streetsByDir,
    commitMs: [],
  });
}

const D = street('d');
const E = street('e');
const BY_DIR = { d: D, e: E };
const PATHS = ['d/f1.txt', 'd/f2.txt', 'e/f3.txt'];

describe('the street rollup', () => {
  it('couples a street to the max opacity of its buildings, not the last one written', () => {
    // d/ is entirely deleted at 3 while e/ survives, so the two roads must part.
    const states = makeCity(PATHS, BY_DIR).run(makeScrubFrame({ pos: 3 }));
    expect(states.streets.get(D)!.opacity).toBe(0);
    expect(states.streets.get(E)!.opacity).toBeCloseTo(1, 5);
  });

  it('keeps a road lit when one child is deleted and another survives', () => {
    // The deleted child lands in the ruin set, where it can't pull the road
    // down. Every present building sits at 1, so the pass can't vary them.
    const halfDead = makeBundle({
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
      deltas: [
        { sha: 'a', changes: [] },
        {
          sha: 'b',
          changes: [
            { path: 'd/f1.txt', sha: 's1' },
            { path: 'd/f2.txt', sha: 's1' },
          ],
        },
        { sha: 'c', changes: [{ path: 'd/f1.txt', sha: null }] },
      ],
      blobLines: { s1: 6 },
    } as never);
    const pass = makeCity(['d/f1.txt', 'd/f2.txt'], { d: D }, halfDead);
    expect(pass.run(makeScrubFrame({ pos: 2 })).streets.get(D)!.opacity).toBeCloseTo(1, 5);
  });

  it('rolls up the whole ancestor chain, so a container street inherits its children', () => {
    // src/ holds no files of its own; it must still light up for src/lib/a.txt.
    const nested = makeBundle({
      commits: [{ sha: 'a' }, { sha: 'b' }],
      deltas: [
        { sha: 'a', changes: [] },
        { sha: 'b', changes: [{ path: 'src/lib/a.txt', sha: 's1' }] },
      ],
      blobLines: { s1: 6 },
    } as never);
    const src = street('src');
    const lib = street('src/lib');
    const pass = makeCity(['src/lib/a.txt'], { src, 'src/lib': lib }, nested);

    const states = pass.run(makeScrubFrame({ pos: 1 }));
    expect(states.streets.get(lib)!.opacity).toBeCloseTo(1, 5);
    expect(states.streets.get(src)!.opacity).toBeCloseTo(1, 5);
  });

  it('marks a street whose buildings are all ruins, and keeps a live sibling clean', () => {
    const states = makeCity(PATHS, BY_DIR).run(makeScrubFrame({ pos: 3, ruinsOn: true }));
    expect(states.streets.get(D)!.tint).toBe(StreetTint.Ruin);
    expect(states.streets.get(E)!.tint).toBe(StreetTint.None);
  });

  it('resolves every street each frame, so an orphan cannot stick at a stale opacity', () => {
    // orphan/ has no buildings at all; it still gets a state.
    const orphan = street('orphan');
    const states = makeCity(PATHS, { ...BY_DIR, orphan }).run(makeScrubFrame({ pos: 3 }));
    expect(states.streets.get(orphan)!.opacity).toBe(0);
  });

  it('rolls up buildings with no detail mesh too: the pass never sees meshes', () => {
    // An impostor-LOD cell still holds its road up, and there is nothing to
    // stub to arrange that.
    const states = makeCity(PATHS, BY_DIR).run(makeScrubFrame({ pos: 2 }));
    expect(states.streets.get(D)!.opacity).toBeCloseTo(1, 5);
  });
});

describe('the building states', () => {
  it('keys by file path and covers every union building', () => {
    const states = makeCity(PATHS, BY_DIR).run(makeScrubFrame({ pos: 2 }));
    expect([...states.buildings.keys()].sort()).toEqual(PATHS);
  });

  it('skips a building with no timeline rather than inventing one', () => {
    const pass = makeCity([...PATHS, 'ghost.txt'], BY_DIR);
    expect(pass.run(makeScrubFrame({ pos: 2 })).buildings.has('ghost.txt')).toBe(false);
  });

  it('reuses one state object per building across frames', () => {
    const pass = makeCity(PATHS, BY_DIR);
    const first = pass.run(makeScrubFrame({ pos: 2 })).buildings.get('d/f1.txt');
    const second = pass.run(makeScrubFrame({ pos: 1 })).buildings.get('d/f1.txt');
    expect(second).toBe(first);
  });
});

describe('dispose', () => {
  it('drops the model so a stale controller cannot keep resolving a dead city', () => {
    const pass = makeCity(PATHS, BY_DIR);
    pass.dispose();
    const states = pass.run(makeScrubFrame({ pos: 2 }));
    expect(states.buildings.size).toBe(0);
  });
});
