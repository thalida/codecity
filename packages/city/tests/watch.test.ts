// Keeping a city on the newest version of its repo. Every rule here is one a
// host would otherwise have to know to write the loop correctly: which of a
// city's internals to consult, what a refresh must NOT apply, and whose result
// wins when the reader navigates mid-poll.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startWatch,
  refreshOnce,
  clampPollSeconds,
  POLL_SECONDS_MIN,
  POLL_SECONDS_MAX,
} from '../src/data/watch';
import { createEmitter } from '../src/state/events';
import { createTimelineState } from '../src/timeline/state';
import { ScanPhase } from '../src/client/manifest';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import type { Manifest } from '../src/types/manifest';

const manifest = (signature: string) =>
  ({ ...EMPTY_MANIFEST, pending: [], content_signature: signature }) as unknown as Manifest;

/** A city's moving parts, as the watch consults them. */
function harness(opts: { signature?: string } = {}) {
  const applied: Manifest[] = [];
  const timeline = createTimelineState();
  const events = createEmitter();
  let generation = 1;
  let loading = false;
  let request: { src: string; branch?: string } | null = { src: '/repo' };
  /** What the city is showing, which is what a poll compares against. */
  let showing: string | null = 'sig-1';
  const urls: string[] = [];

  const client = {
    fetchSignature: vi.fn(async () => ({ content_signature: opts.signature ?? 'sig-1' })),
    manifestUrlFor: vi.fn((r: { src: string; exclude?: string[] }) => {
      const url = `/api/manifest?src=${encodeURIComponent(r.src)}${(r.exclude ?? [])
        .map((e) => `&exclude=${encodeURIComponent(e)}`)
        .join('')}`;
      urls.push(url);
      return url;
    }),
    streamManifest: vi.fn(async function* () {
      yield { phase: ScanPhase.PartialManifest, manifest: manifest('skeleton') };
      yield { phase: ScanPhase.CompleteManifest, manifest: manifest('sig-2') };
    }),
  };

  const deps = {
    client: client as never,
    loader: {
      generation: () => generation,
      loading: () => loading,
      request: () => request,
    } as never,
    timeline,
    events,
    applyManifest: async (m: Manifest) => void applied.push(m),
    currentSignature: () => showing,
  };

  return {
    deps,
    applied,
    urls,
    client,
    timeline,
    events,
    bumpGeneration: () => void generation++,
    setLoading: (v: boolean) => void (loading = v),
    setRequest: (r: typeof request) => void (request = r),
    setShowing: (v: string | null) => void (showing = v),
  };
}

describe('clampPollSeconds', () => {
  it('keeps a poll off the floor and off the ceiling', () => {
    // Tighter burns CPU on a server that walks the filesystem per poll; looser
    // stops feeling live.
    expect(clampPollSeconds(0)).toBe(POLL_SECONDS_MIN);
    expect(clampPollSeconds(9999)).toBe(POLL_SECONDS_MAX);
    expect(clampPollSeconds('nonsense')).toBe(POLL_SECONDS_MIN);
    expect(clampPollSeconds(NaN)).toBe(POLL_SECONDS_MIN);
    expect(clampPollSeconds(10)).toBe(10);
  });
});

describe('a watch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the cheap question first, and stops there when nothing moved', async () => {
    // The city is showing exactly what the server reports.
    const h = harness({ signature: 'sig-1' });
    const stop = startWatch(h.deps, { intervalSeconds: 1 });

    await vi.advanceTimersByTimeAsync(2000);

    expect(h.client.fetchSignature).toHaveBeenCalled();
    // The full manifest costs a walk, and most polls find nothing changed.
    expect(h.client.streamManifest).not.toHaveBeenCalled();
    stop();
  });

  it('re-applies when the signature moves', async () => {
    const h = harness({ signature: 'sig-moved' }); // server ahead of the city
    const stop = startWatch(h.deps, { intervalSeconds: 1 });

    await vi.advanceTimersByTimeAsync(1000);

    expect(h.applied).toHaveLength(1);
    stop();
  });

  // A refresh that applied the skeleton would drop every building to
  // placeholder heights and back, in front of the reader, on every save.
  it('never applies the skeleton', async () => {
    const h = harness({ signature: 'sig-moved' });
    const stop = startWatch(h.deps, { intervalSeconds: 1 });

    await vi.advanceTimersByTimeAsync(1000);

    expect(h.applied.map((m) => m.content_signature)).toEqual(['sig-2']);
    stop();
  });

  // The union city and its scrub are not something a poll can replace under a
  // reader who is scrubbing them.
  it('suspends while the timeline owns the scene, and resumes on exit', async () => {
    const h = harness();
    const stop = startWatch(h.deps, { intervalSeconds: 1 });

    h.timeline.enter();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.client.fetchSignature).not.toHaveBeenCalled();

    h.timeline.exit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.client.fetchSignature).toHaveBeenCalled();
    stop();
  });

  it('yields to a foreground load rather than racing it', async () => {
    const h = harness();
    h.setLoading(true);
    const stop = startWatch(h.deps, { intervalSeconds: 1 });

    await vi.advanceTimersByTimeAsync(2000);

    expect(h.client.fetchSignature).not.toHaveBeenCalled();
    stop();
  });

  it('does nothing before anything has been loaded', async () => {
    const h = harness();
    h.setRequest(null);
    const stop = startWatch(h.deps, { intervalSeconds: 1 });

    await vi.advanceTimersByTimeAsync(2000);

    expect(h.client.fetchSignature).not.toHaveBeenCalled();
    stop();
  });

  it('stops asking once stopped', async () => {
    const h = harness();
    const stop = startWatch(h.deps, { intervalSeconds: 1 });
    stop();

    await vi.advanceTimersByTimeAsync(5000);

    expect(h.client.fetchSignature).not.toHaveBeenCalled();
  });

  it('reports a failure rather than going quiet', async () => {
    const h = harness();
    const boom = new Error('server gone');
    h.client.fetchSignature.mockRejectedValue(boom);
    const onError = vi.fn();
    const stop = startWatch(h.deps, { intervalSeconds: 1, onError });

    await vi.advanceTimersByTimeAsync(1000);

    expect(onError).toHaveBeenCalledWith(boom);
    stop();
  });
});

describe('a refresh', () => {
  // The repo has not changed — the QUESTION has. Probing the signature would
  // answer "nothing to do" for a scan that would return something different.
  it('re-scans without asking whether the repo moved', async () => {
    const h = harness({ signature: 'sig-1' });

    await refreshOnce(h.deps, { excludes: () => ['node_modules'] });

    expect(h.client.fetchSignature).not.toHaveBeenCalled();
    expect(h.applied).toHaveLength(1);
    expect(h.urls[0]).toContain('exclude=node_modules');
  });

  it('yields to a foreground load, like a poll does', async () => {
    const h = harness();
    h.setLoading(true);

    await refreshOnce(h.deps);

    expect(h.client.streamManifest).not.toHaveBeenCalled();
  });

  // The reader navigated while it ran, so this result is about the repo they
  // left, and applying it would put the old city back.
  it('drops its result when a load supersedes it', async () => {
    const h = harness();
    h.client.streamManifest.mockImplementation(async function* () {
      h.bumpGeneration();
      yield { phase: ScanPhase.CompleteManifest, manifest: manifest('stale') };
    });

    await refreshOnce(h.deps);

    expect(h.applied).toHaveLength(0);
  });

  it('announces what it applied, so a host hears it like any other manifest', async () => {
    const h = harness();
    const heard: string[] = [];
    h.events.on('scan:manifest', ({ manifest: m }) => heard.push(m.content_signature!));

    await refreshOnce(h.deps);

    expect(heard).toEqual(['sig-2']);
  });
});
