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
} from '@/state/stores/scrubbedManifest';

function completes(manifest: unknown) {
  return async function* () {
    yield { phase: ScanPhase.CompleteManifest, manifest };
  };
}

afterEach(() => {
  resetScrubbedManifest();
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
