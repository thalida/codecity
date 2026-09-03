// city/watch.ts — keep a city on the newest version of the repo it is showing.
//
// The shape of this is not a host's business. Poll a cheap signature, compare
// it against what is on screen, and re-apply only when it moves; yield to a
// foreground load rather than racing it; drop a result the reader has already
// navigated away from. Every host wanting live updates would write the same
// loop, and would have to know which of a city's internals to consult to write
// it correctly — which is exactly what it should not have to know.
//
// A REFRESH is not a load. It shows no overlay and skips the skeleton, because
// applying one would animate every building down to placeholder heights and
// back on every save.

import { ScanError, ScanPhase } from '../client/manifest';
import type { CodecityClient } from '../client/index';
import type { CityEmitter } from '../state/events';
import type { SourceLoader } from './loadSource';
import type { TimelineState } from '../timeline/state';
import type { Manifest } from '../types/manifest';

/** Floor: the server walks the filesystem per poll, so tighter burns CPU.
 *  Ceiling: past a minute, "live" stops feeling live. */
export const POLL_SECONDS_MIN = 1;
export const POLL_SECONDS_MAX = 60;

export function clampPollSeconds(s: unknown): number {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

export interface WatchOptions {
  /** How often to ask, in seconds. Clamped to [1, 60]. */
  intervalSeconds?: number;
  /** Paths the reader has hidden. Read per poll rather than captured, so a
   *  host that lets them be edited does not have to restart the watch. */
  excludes?: () => string[] | undefined;
  /** Told when a poll fails. Without this a watch is silent, and a repo that
   *  has gone away looks like one that simply is not changing. */
  onError?: (error: unknown) => void;
  /** Make the server re-scan rather than answer from its cache. For a refresh
   *  the reader asked for by hand; a poll leaves it off. */
  noCache?: boolean;
}

export interface WatchDeps {
  client: CodecityClient;
  loader: SourceLoader;
  timeline: TimelineState;
  events: CityEmitter;
  applyManifest(manifest: Manifest): Promise<void>;
  /** The content signature of the manifest this city is SHOWING. The baseline a
   *  poll compares against — not a copy the watch keeps, which would answer for
   *  a city it is no longer looking at after a load it did not make. */
  currentSignature(): string | null;
}

/** One check, and what it needs to remember between checks. A watch is this on
 *  a timer; a refresh is this once. */
function createChecker(deps: WatchDeps, options: WatchOptions) {
  const { client, loader, timeline, events, applyManifest } = deps;
  let inFlight = false;
  let stopped = false;

  async function fetchAndApply(request: { src: string; branch?: string }): Promise<void> {
    const myGeneration = loader.generation();
    for await (const event of client.streamManifest(
      client.manifestUrlFor({ ...request, exclude: options.excludes?.(), noCache: options.noCache })
    )) {
      if (event.phase === ScanPhase.Error) throw new ScanError(event.error, event.code);
      // Only the complete one: a refresh that applied the skeleton would drop
      // the city to placeholder heights in front of the reader.
      if (event.phase !== ScanPhase.CompleteManifest) continue;
      // A load started while this was in flight, so the reader is looking at
      // something else and this result is about the repo they left.
      if (myGeneration !== loader.generation() || stopped) return;
      const manifest = event.manifest;
      if (!manifest?.content_signature) continue;
      // Applied before it is announced, so nothing hears "there is a newer
      // manifest" ahead of the paint that shows it — the same order a scan
      // uses, and the reason a host can treat the two identically.
      await applyManifest(manifest);
      if (stopped || myGeneration !== loader.generation()) return;
      events.emit('scan:manifest', { manifest, phase: ScanPhase.CompleteManifest });
    }
  }

  /** Whether it is worth asking at all. Both paths share these: a poll and a
   *  refresh must equally not fight a foreground load or replace the union
   *  city under a reader who is scrubbing it. */
  function ready(): boolean {
    if (inFlight || stopped) return false;
    // Timeline owns the scene while it is on — the union city and its scrub are
    // not a thing a refresh can replace under the reader.
    if (timeline.mode) return false;
    // A foreground load is showing what the reader actually asked for.
    if (loader.loading()) return false;
    return loader.request() !== null;
  }

  /** Re-scan and apply, without asking whether anything changed. What a host
   *  triggers when IT changed the question — the reader hid a path — since the
   *  repo's own content signature has not moved and a probe would answer
   *  "nothing to do" for a scan that would return something different. */
  async function refresh(): Promise<void> {
    if (!ready()) return;
    const request = loader.request();
    if (!request) return;
    inFlight = true;
    const myGeneration = loader.generation();
    try {
      await fetchAndApply(request);
    } catch (error) {
      if (stopped || myGeneration !== loader.generation()) return;
      options.onError?.(error);
    } finally {
      inFlight = false;
    }
  }

  async function poll(): Promise<void> {
    if (inFlight || stopped) return;
    // Timeline owns the scene while it is on — the union city and its scrub are
    // not a thing a live poll can replace under the reader.
    if (timeline.mode) return;
    // A foreground load is showing what the reader actually asked for.
    if (loader.loading()) return;
    const request = loader.request();
    if (!request) return;

    inFlight = true;
    const myGeneration = loader.generation();
    try {
      // The cheap question first: the full manifest costs a walk, and most
      // polls find nothing changed.
      const signature = await client.fetchSignature(
        request.src,
        request.branch,
        options.excludes?.()
      );
      if (stopped || myGeneration !== loader.generation()) return;
      const next = signature?.content_signature;
      if (!next || next === deps.currentSignature()) return;
      await fetchAndApply(request);
    } catch (error) {
      if (stopped || myGeneration !== loader.generation()) return;
      options.onError?.(error);
    } finally {
      inFlight = false;
    }
  }

  return {
    poll,
    refresh,
    stop: () => void (stopped = true),
  };
}

/** Start watching. Returns stop(); calling it twice is harmless. */
export function startWatch(deps: WatchDeps, options: WatchOptions = {}): () => void {
  const everySeconds = clampPollSeconds(options.intervalSeconds ?? POLL_SECONDS_MAX);
  const checker = createChecker(deps, options);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void checker.poll().finally(schedule);
    }, everySeconds * 1000);
  }

  schedule();

  return function stop(): void {
    stopped = true;
    checker.stop();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

/** Ask once, now. What a host calls when something it knows about changed —
 *  the reader hid a path, or pressed refresh — rather than waiting out an
 *  interval that was chosen for a quiet repo. Same rules as a poll: it yields
 *  to a foreground load, skips the skeleton, and drops its result if the reader
 *  navigated away while it ran. */
export async function refreshOnce(deps: WatchDeps, options: WatchOptions = {}): Promise<void> {
  const checker = createChecker(deps, options);
  try {
    await checker.refresh();
  } finally {
    checker.stop();
  }
}
