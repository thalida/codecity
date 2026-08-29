// Showing a repo's history. The order is the whole difficulty, and it is a
// property of the pieces rather than of any host: the mode goes on BEFORE the
// manifest or the pack builds a live city and the commit lands as a live one;
// the transparency flips AFTER the pack because applying rebuilds the street
// and footprint meshes opaque; and the scrub controller installs last because
// it drives the meshes the pack has just made.
//
// A host that had to rediscover that would get it wrong, which is why this is
// not a host's to own.

import { describe, it, expect, vi } from 'vitest';
import { createTimelineLoader } from '../src/data/loadTimeline';
import { createTimelineState } from '../src/timeline/state';
import { createEmitter } from '../src/state/events';
import { BuildStage } from '../src/types/build';
import { makeCommitBundle } from './_helpers/scrub';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import type { TimelineBundle } from '../src/types/timeline';

/** A bundle the replay can walk: makeCommitBundle names commits but carries no
 *  per-commit deltas, and buildPathTimelines needs one row per commit. */
function bundleOf(n: number): TimelineBundle {
  const bundle = makeCommitBundle(n) as unknown as Record<string, unknown>;
  bundle.deltas = Array.from({ length: n }, (_, i) => ({ sha: `c${i}`, changes: [] }));
  bundle.unionManifest = { ...EMPTY_MANIFEST, pending: [] };
  bundle.commitLineRanges = [];
  return bundle as unknown as TimelineBundle;
}

function harness(bundle: TimelineBundle = bundleOf(4)) {
  const order: string[] = [];
  const timeline = createTimelineState();
  const events = createEmitter();
  const applyManifest = vi.fn(async () => void order.push('apply'));

  // Typed as the shape the loader uses, not `never`: a test that reassigns a
  // client method below needs the property to exist.
  const client = {
    fetchTimelineBundle: vi.fn(
      async (
        _src: string,
        _branch?: string,
        onProgress?: (p: { stage: string }) => void
      ): Promise<TimelineBundle> => {
        void onProgress;
        order.push('fetch');
        return bundle;
      }
    ),
  };

  const deps = {
    client: client as never,
    events,
    timeline,
    applyManifest,
    setStreetsTransparent: vi.fn((on: boolean) => void order.push(`streets:${on}`)),
    setFootprintsTransparent: vi.fn((on: boolean) => void order.push(`footprints:${on}`)),
    installScrubController: vi.fn(() => void order.push('controller')),
    uninstallScrubController: vi.fn(() => void order.push('uninstall')),
    nextPaint: async () => {},
  };
  return { deps, client, order, timeline, events, applyManifest, bundle };
}

describe('loading a timeline', () => {
  it('enters the mode before the pack, and dresses the scene after it', async () => {
    const h = harness();
    await createTimelineLoader(h.deps).load({ src: '/repo' });

    // Every rule in one list. The mode is asserted separately below because it
    // is a state rather than a call.
    expect(h.order).toEqual(['fetch', 'apply', 'streets:true', 'footprints:true', 'controller']);
  });

  it('is in the mode by the time the manifest is applied', async () => {
    const h = harness();
    let modeAtApply: boolean | null = null;
    h.applyManifest.mockImplementation(async () => void (modeAtApply = h.timeline.mode));

    await createTimelineLoader(h.deps).load({ src: '/repo' });

    // Otherwise the pack builds a live city, and the commit lands as a live one.
    expect(modeAtApply).toBe(true);
  });

  it('packs the union manifest, naming the work that ran before it', async () => {
    const h = harness();
    await createTimelineLoader(h.deps).load({ src: '/repo' });

    expect(h.applyManifest).toHaveBeenCalledWith(h.bundle.unionManifest, [
      BuildStage.Assembling,
      BuildStage.Replay,
    ]);
  });

  it('opens at the present', async () => {
    const h = harness(bundleOf(5));
    await createTimelineLoader(h.deps).load({ src: '/repo' });
    expect(h.timeline.pos).toBe(h.timeline.max);
  });

  it('rests on a named commit', async () => {
    const bundle = bundleOf(5);
    const h = harness(bundle);
    await createTimelineLoader(h.deps).load({ src: '/repo', commit: bundle.commits[2].sha });
    expect(h.timeline.pos).toBe(2);
  });

  // A union cap can drop a commit, and a link can go stale: falling through to
  // the present beats erroring on a repo the reader can perfectly well see.
  it('falls through to the present for a commit it cannot find', async () => {
    const h = harness(bundleOf(5));
    await createTimelineLoader(h.deps).load({ src: '/repo', commit: 'nope' });
    expect(h.timeline.pos).toBe(h.timeline.max);
  });

  it('holds the position when asked, which is what a refetch wants', async () => {
    const h = harness(bundleOf(6));
    const loader = createTimelineLoader(h.deps);
    await loader.load({ src: '/repo' });
    h.timeline.setPosition(2);

    await loader.load({ src: '/repo', keepPosition: true });

    expect(h.timeline.pos).toBe(2);
  });

  it('reports the assembly, so a host can draw rows for it', async () => {
    const h = harness();
    const seen: string[] = [];
    h.events.on('timeline:progress', ({ event }) => seen.push(event.stage));
    h.client.fetchTimelineBundle.mockImplementation(async (_s, _b, onProgress) => {
      onProgress?.({ stage: 'history' } as never);
      return h.bundle;
    });

    await createTimelineLoader(h.deps).load({ src: '/repo' });

    expect(seen).toEqual(['history']);
  });

  // A failure can predate the controller install, so nothing else would unwind
  // it: the city leaves no half-entered timeline behind.
  it('unwinds its own scene when the pack fails', async () => {
    const h = harness();
    h.applyManifest.mockRejectedValue(new Error('pack failed'));

    await expect(createTimelineLoader(h.deps).load({ src: '/repo' })).rejects.toThrow(
      'pack failed'
    );

    expect(h.timeline.mode).toBe(false);
    expect(h.deps.uninstallScrubController).toHaveBeenCalled();
    expect(h.deps.setStreetsTransparent).toHaveBeenLastCalledWith(false);
  });

  it('says so when the fetch fails, rather than going quiet', async () => {
    const h = harness();
    const boom = new Error('no history');
    h.client.fetchTimelineBundle.mockRejectedValue(boom);
    const errors: unknown[] = [];
    h.events.on('scan:error', ({ error }) => errors.push(error));

    await expect(createTimelineLoader(h.deps).load({ src: '/repo' })).rejects.toThrow(boom);

    expect(errors).toEqual([boom]);
    expect(h.timeline.mode).toBe(false);
  });
});
