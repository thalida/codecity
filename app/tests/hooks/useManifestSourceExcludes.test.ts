import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSource, setupLiveUpdates } from '@/hooks/useManifestSource';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { EXCLUDES, addExclude } from '@/state/stores/excludes';
import { StubEventSource, installEventSource } from '../_helpers/eventSource';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// Minimal manifest-complete payload so loadSource commits the source. The
// stream reader treats a `manifest-complete` event as terminal (it closes the
// EventSource itself) — no separate "done" event exists on the wire.
const MANIFEST_JSON = JSON.stringify({
  manifest: {
    content_signature: 'sig0',
    structure_signature: 't0',
    layout_signature: 't0',
    tree: { name: 'r', type: 'directory', path: '.', children: [] },
    repo: {},
  },
});

describe('exclude-driven re-fetch', () => {
  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = null;
    MANIFEST.value = { tree: {} } as never;
  });
  afterEach(() => {
    restoreEventSource();
  });

  it('re-fetches the loaded source with the exclude param when an exclude is added', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(CURRENT_SOURCE.value?.src).toBe('s');

    const dispose = setupLiveUpdates();
    const before = StubEventSource.instances.length;
    addExclude('vendor');
    await flush();
    const fresh = StubEventSource.instances.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(new URL(fresh[0].url).searchParams.getAll('exclude')).toEqual(['vendor']);
    dispose();
  });

  it('does not re-fetch merely because the source switched', async () => {
    // Load s1 first so the reaction records a non-null key for it — otherwise
    // the switch run exits on the `prev === null` branch and the actual
    // switch-guard (`prevRepo !== repoKey`) is never exercised.
    const load = loadSource({ src: 's1', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(CURRENT_SOURCE.value?.src).toBe('s1');

    const dispose = setupLiveUpdates();
    const before = StubEventSource.instances.length;
    CURRENT_SOURCE.value = { src: 's2', branch: undefined }; // real repo-key change, no exclude edit
    await flush();
    // The switch alone must NOT refetch — the load owns sending s2's excludes.
    expect(StubEventSource.instances.length).toBe(before);
    dispose();
  });
});
