import { afterEach, describe, expect, it, vi } from 'vitest';

const streamManifest = vi.hoisted(() => vi.fn());
vi.mock('@/api/manifest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/manifest')>()),
  streamManifest,
}));

import { ScanPhase } from '@/api/manifest';
import {
  SCRUBBED_MANIFEST,
  loadManifestAt,
  resetScrubbedManifest,
  _clearScrubbedManifestCache,
} from '@/state/stores/scrubbedManifest';

function completes(manifest: unknown) {
  return async function* () {
    yield { phase: ScanPhase.CompleteManifest, manifest };
  };
}

afterEach(() => {
  resetScrubbedManifest();
  _clearScrubbedManifestCache();
  streamManifest.mockReset();
});

describe('loadManifestAt', () => {
  it('publishes the reconstructed manifest for a commit', async () => {
    streamManifest.mockImplementation(completes({ root: '/r', tree: { path: '' } }));
    await loadManifestAt('/r', 'main', 'a'.repeat(40));
    expect((SCRUBBED_MANIFEST.value as { root?: string })?.root).toBe('/r');
  });

  it('serves a revisited commit from cache: reconstruction is immutable per sha', async () => {
    streamManifest.mockImplementation(completes({ root: '/r' }));
    const sha = 'b'.repeat(40);
    await loadManifestAt('/r', 'main', sha);
    await loadManifestAt('/r', 'main', sha);
    expect(streamManifest).toHaveBeenCalledTimes(1);
  });

  it('a failed scan leaves the last good manifest rather than blanking the pane', async () => {
    streamManifest.mockImplementation(completes({ root: '/good' }));
    await loadManifestAt('/r', 'main', 'c'.repeat(40));
    streamManifest.mockImplementation(() => {
      throw new Error('network');
    });
    await loadManifestAt('/r', 'main', 'd'.repeat(40));
    expect((SCRUBBED_MANIFEST.value as { root?: string })?.root).toBe('/good');
  });
});

describe('reconstruction cache', () => {
  // Each entry is a whole repo tree, so an unbounded cache grows for the life of
  // the tab as you scrub a long history or switch repos.
  const sha = (n: number) => String(n).padStart(40, '0');

  async function load(n: number) {
    streamManifest.mockImplementation(completes({ root: '/r', tree: { path: `t${n}` } }));
    await loadManifestAt('/r', 'main', sha(n));
  }

  it('evicts the oldest entry once the cache is full', async () => {
    for (let i = 0; i < 20; i++) await load(i);
    streamManifest.mockClear();

    // The 16 most recent are still warm: no refetch.
    for (let i = 4; i < 20; i++) await load(i);
    expect(streamManifest).not.toHaveBeenCalled();

    // The four evicted ones are refetched.
    for (let i = 0; i < 4; i++) await load(i);
    expect(streamManifest).toHaveBeenCalledTimes(4);
  });

  it('a re-read counts as recent, so it is not the next one evicted', async () => {
    for (let i = 0; i < 16; i++) await load(i);
    await load(0); // touch the oldest, promoting it
    await load(99); // pushes one out — entry 1, not entry 0
    streamManifest.mockClear();

    await load(0);
    expect(streamManifest, 'the promoted entry should still be cached').not.toHaveBeenCalled();
  });
});
