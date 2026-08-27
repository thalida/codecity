// hooks/useManifestSource.ts — The FETCH layer of the city's manifest pipeline.
// Scene-free by contract: it streams manifests and publishes canonical signals
// (MANIFEST, SCAN_PROGRESS, CURRENT_SOURCE via setCurrentSource, SOURCE_ERROR).
// The render layer consumes them and owns the apply's rebuild status.

import { useEffect } from 'preact/hooks';
import { computed, effect } from '@preact/signals';

import { LIVE_UPDATES, LIVE_UPDATES_ACTIVE } from '@/state/settings/fields/updates';
import {
  RECENTS,
  SOURCE_ERROR,
  commitSource,
  CURRENT_SOURCE,
  activeExcludePathsFor,
  ACTIVE_EXCLUDES,
} from '@/state/stores/source';
import { DISCOVER, SERVER_CONFIG } from '@/state/stores/serverData';
import { MANIFEST, setManifest } from '@/state/stores/manifest';
import {
  markError,
  markRebuilding,
  SCAN_PROGRESS,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/progress';
import { TIMELINE_MODE, resetTimelineMode } from '@/state/stores/timeline';
import {
  srcKind,
  SourceKind,
  identityBranch,
  sourceKey,
  sameSourceIdentity,
  sourceIdentity,
} from '@/utils/sources';
import { readUrlView, type UrlView } from '@/router/viewParams';
import { ROUTE_PARAMS, ROUTE_PATH } from '@/router/location';
import { ROUTES } from '@/router/paths';
import type { SourcePayload } from '@/types/ui';
import { ScanError, ScanPhase } from '@codecity/city';
import { API } from '@/apiClient';
import type { Manifest } from '@codecity/city';

// ── Shared helpers ───────────────────────────────────────────────────

/** Consume a manifest stream, publishing SCAN_PROGRESS per event and handing
 *  each skeleton/final to onManifest. Returns the final; throws without one. */
async function pumpManifestStream(
  url: string,
  meta: { kind: SourceKind; branch?: string },
  onManifest: (
    manifest: Manifest,
    phase: ScanPhase.PartialManifest | ScanPhase.CompleteManifest
  ) => Promise<void> | void,
  signal?: AbortSignal
): Promise<Manifest> {
  let lastManifest: Manifest | null = null;
  // Only partials are applied in here, so the complete event carries the last
  // applied `pending` forward rather than claiming its own as applied.
  let appliedPending: Manifest['pending'] | undefined;

  for await (const event of API.streamManifest(url, { signal })) {
    if (event.phase === ScanPhase.Error) throw new ScanError(event.error, event.code);

    if ('label' in event && event.label) {
      // Server-side, so the document title and the overlay header name the
      // project the same way instead of each deriving it from the src.
      PENDING_SOURCE_LABEL.value = event.label;
    }

    if (event.phase === ScanPhase.CloneProgress || event.phase === ScanPhase.ScanProgress) {
      SCAN_PROGRESS.value = {
        ...meta,
        phase: event.phase,
        percent: event.phase === ScanPhase.CloneProgress ? event.percent : undefined,
        stage: event.phase === ScanPhase.CloneProgress ? event.stage : undefined,
        mbOnDisk: event.phase === ScanPhase.CloneProgress ? event.mb_on_disk : undefined,
        objects: event.phase === ScanPhase.CloneProgress ? event.objects : undefined,
        objectsTotal: event.phase === ScanPhase.CloneProgress ? event.objects_total : undefined,
        mib: event.phase === ScanPhase.CloneProgress ? event.mib : undefined,
        filesScanned: event.phase === ScanPhase.ScanProgress ? event.files_scanned : undefined,
      };
      continue;
    }

    // tree.name beats the src basename, which for a working tree is whatever
    // the folder is called (e.g. a git-worktree dir).
    if (event.manifest.tree?.name) PENDING_SOURCE_LABEL.value = event.manifest.tree.name;
    await onManifest(event.manifest, event.phase);
    lastManifest = event.manifest;
    if (event.phase === ScanPhase.PartialManifest) appliedPending = event.manifest.pending;
    // After onManifest, so the overlay reaction can never see "heights final"
    // ahead of the paint that shows them.
    SCAN_PROGRESS.value = { ...meta, phase: event.phase, appliedPending };
  }

  if (!lastManifest) throw new Error('No manifest received');
  return lastManifest;
}

// Injected, not imported (importing useTimelineMode back was a cycle); it
// registers before TIMELINE_MODE can turn on.
type TimelineRefresh = (opts?: { noCache?: boolean; overlay?: boolean }) => Promise<void>;

let timelineRefresh: TimelineRefresh | null = null;

export function setTimelineRefreshHandler(fn: TimelineRefresh | null): void {
  timelineRefresh = fn;
}

/** The Timeline boot: `?mode=timeline` loads the history bundle instead of a
 *  HEAD scan, and commits its own manifest. Injected for the same cycle reason. */
type TimelineBoot = (payload: { src: string; branch?: string; commit?: string }) => Promise<void>;

let timelineBoot: TimelineBoot | null = null;

export function setTimelineBootHandler(fn: TimelineBoot | null): void {
  timelineBoot = fn;
}

// ── Single-writer generation guard ───────────────────────────────────

// Every write is gated on "am I still the current generation?", so a newer load
// silently drops an older one and any in-flight poll write with it.
let loadGeneration = 0;

// The AbortController for the current foreground load, so the UI can cancel a
// slow clone/scan. A new load or a cancel aborts the previous one.
let loadController: AbortController | null = null;

// ── Canonical source load (cold-boot + user switch) ──────────────────

// The one way to load a source. The poll below is a separate op that shares
// only the MANIFEST sink and yields to this via the generation.
export async function loadSource(payload: SourcePayload): Promise<void> {
  // This attempt supersedes the last failure, so nothing outlives it to explain
  // a load that is no longer the current one.
  SOURCE_ERROR.value = null;
  // A source switch always exits Timeline; the city layer reacts to the flip.
  if (TIMELINE_MODE.peek()) resetTimelineMode();
  const myGen = ++loadGeneration; // claim authority; supersedes any in-flight load/poll
  loadController?.abort(); // supersede any in-flight load
  const controller = new AbortController();
  loadController = controller;
  // A local source has no branch axis, so a stale deep-link's branch is dropped
  // rather than carried into the URL, the overlay and the committed source.
  const branch = identityBranch(payload.src, payload.branch);
  // The server's label arrives with the first stream event, by which time the
  // overlay is already up; recents cover the gap.
  PENDING_SOURCE_LABEL.value = RECENTS.peek().find((r) => r.src === payload.src)?.label ?? null;
  const meta = {
    kind: srcKind(payload.src),
    branch,
  };
  SCAN_PROGRESS.value = { ...meta, phase: null }; // show overlay immediately
  // What a cancel rolls back to, captured before the clear below: otherwise the
  // canceled repo's geometry lingers under the unchanged header.
  const prevManifest = MANIFEST.peek();
  // A DIFFERENT project retires the one on screen: the route changes on the
  // click now, so the last city would draw under the overlay for the load.
  const opened = CURRENT_SOURCE.peek();
  if (!opened || !sameSourceIdentity(opened, { src: payload.src, branch })) {
    setManifest(null);
  }

  try {
    const url = API.manifestUrlFor({
      src: payload.src,
      branch,
      noCache: !!payload.skipCache,
      exclude: activeExcludePathsFor(payload.src),
    });
    // Skeleton streams out here; the final is published below, after the
    // source is committed.
    const manifest = await pumpManifestStream(
      url,
      meta,
      (m, phase) => {
        if (phase === ScanPhase.PartialManifest && myGen === loadGeneration) setManifest(m);
      },
      controller.signal
    );
    // A newer load superseded this one: it owns MANIFEST now, don't touch.
    if (myGen !== loadGeneration) return;
    // An aborted stream ends as done, not a throw, so a cancel arrives here
    // holding the partial. Roll back rather than commit it.
    if (controller.signal.aborted) {
      setManifest(prevManifest);
      return;
    }
    // One commit point, whichever view loaded it: source, recents, manifest.
    commitSource(payload.src, branch, manifest);
  } catch (err) {
    if (myGen !== loadGeneration) return; // superseded — its error isn't current
    if (controller.signal.aborted) {
      setManifest(prevManifest); // user canceled: not an error; roll back any skeleton
      return;
    }
    SOURCE_ERROR.value = {
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof ScanError ? err.code : undefined,
      prefill: { src: payload.src, branch },
    };
  } finally {
    // Only the authoritative load tears the overlay down, or a superseded one
    // clears it out from under the load still streaming.
    if (myGen === loadGeneration) {
      SCAN_PROGRESS.value = null;
      if (loadController === controller) loadController = null;
    }
  }
}

/** Abort the in-flight foreground load. Treated as a clean user cancel, not a
 *  failure: see the `catch` branch above. */
export function cancelLoad(): void {
  loadController?.abort();
}

/** Re-read the source already open, in whichever mode it is being viewed:
 *  Timeline refetches its bundle in place rather than dropping to live HEAD. */
export function refreshCurrentSource(skipCache = false): void {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return;
  if (TIMELINE_MODE.peek() && timelineRefresh) {
    // Asked for by hand, so it gets the same stepped overlay a Live refresh
    // does: the history walk behind it runs for minutes on a big repo.
    void timelineRefresh({ noCache: skipCache, overlay: true });
    return;
  }
  void loadSource({ src: cur.src, branch: cur.branch, skipCache: skipCache || undefined });
}

// ── Live-update poll loop ────────────────────────────────────────────

// Floor: the server walks the filesystem per poll, so tighter burns CPU.
// Ceiling: past a minute "live" stops feeling live.
const POLL_SECONDS_MIN = 1;
const POLL_SECONDS_MAX = 60;

function _clampPollSeconds(s: number | unknown): number {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

/** Start the live-update poll loop and the exclude-refresh reaction, returning
 *  a dispose for both. Exported so the reaction is directly testable. */
export function setupLiveUpdates(): () => void {
  let timer: number | null = null;
  let inFlight = false;

  async function fetchAndApply(src: string, branch: string | undefined): Promise<void> {
    const myGen = loadGeneration; // capture; a foreground load bumping this drops our write
    try {
      for await (const event of API.streamManifest(
        API.manifestUrlFor({ src, branch, exclude: activeExcludePathsFor(src) })
      )) {
        if (event.phase === ScanPhase.Error) throw new ScanError(event.error, event.code);
        // Skip the skeleton: the city is already drawn, and applying one would
        // animate every building to placeholder heights and back on each save.
        if (event.phase !== ScanPhase.CompleteManifest) continue;
        if (myGen !== loadGeneration) return; // a foreground load started — this refresh is stale
        const m = event.manifest;
        if (m?.content_signature) setManifest(m);
      }
    } catch (err) {
      if (myGen !== loadGeneration) return; // superseded by a load — not our error to surface
      markError(err);
    }
  }

  // Cheap signature first, full manifest only when it differs. Targets the
  // committed CURRENT_SOURCE, not the page URL, which lags a switch.
  async function tick(): Promise<void> {
    if (inFlight) return;
    if (TIMELINE_MODE.peek()) return; // Timeline mode owns the scene (union city + scrub) — no live poll
    if (SCAN_PROGRESS.peek() !== null) return; // a foreground load is in flight — yield
    const cur = CURRENT_SOURCE.peek();
    if (!cur) return; // nothing loaded yet
    const current = MANIFEST.peek();
    if (!current) return;
    const applied = (current as Manifest).content_signature;
    inFlight = true;
    try {
      const sig = await API.fetchSignature(cur.src, cur.branch, activeExcludePathsFor(cur.src));
      if (!sig?.content_signature || sig.content_signature === applied) return;
      await fetchAndApply(cur.src, cur.branch);
    } catch (_) {
      // Cheap-probe network blip: no rebuild attempted, so not surfaced. Next
      // tick retries.
    } finally {
      inFlight = false;
    }
  }

  function start(): void {
    stop();
    const seconds = _clampPollSeconds(LIVE_UPDATES.value.POLL_SECONDS);
    timer = window.setInterval(tick, seconds * 1000);
  }
  function stop(): void {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  const disposeEnabledEffect = effect(() => {
    // Tracks the source too, so switching between a local tree and a clone
    // starts or stops the timer without a reload.
    if (LIVE_UPDATES_ACTIVE.value) start();
    else stop();
  });

  // Excludes need their own trigger, since the poll is gated on
  // LIVE_UPDATES_ACTIVE. Key-guarded so a source switch isn't read as an edit.
  let lastExcludeKey: string | null = null;
  const disposeExcludeRefresh = effect(() => {
    const serialized = ACTIVE_EXCLUDES.value.join('\n');
    const cur = CURRENT_SOURCE.peek();
    const repoKey = cur ? sourceKey(cur.src) : null;
    const nextKey = repoKey === null ? null : `${repoKey}|${serialized}`;
    const prev = lastExcludeKey;
    lastExcludeKey = nextKey;
    if (prev === null || nextKey === null) return; // first run / no source
    const [prevRepo] = prev.split('|', 1);
    if (prevRepo !== repoKey) return; // source switched — the load owns it
    if (prev === nextKey) return; // no actual change
    if (SCAN_PROGRESS.peek() !== null) return; // yield to a foreground load
    if (!cur) return;
    if (inFlight) return; // the poll's tick is already covering this refresh
    inFlight = true;
    // Timeline owns the scene: excludes change the union data, so refetch its
    // bundle + re-pack (it reports itself through the readout). Live: re-scan.
    let refresh: Promise<void>;
    if (TIMELINE_MODE.peek() && timelineRefresh) {
      refresh = timelineRefresh();
    } else {
      markRebuilding(); // say so now, not after the re-scan streams back
      refresh = fetchAndApply(cur.src, cur.branch);
    }
    void refresh.finally(() => {
      inFlight = false;
    });
  });

  return () => {
    stop();
    disposeEnabledEffect();
    disposeExcludeRefresh();
  };
}

/** The load the URL asks for, in the mode it asks for. A Timeline boot that
 *  fails to engage falls through to Live, so the page lands on a working city. */
export async function bootLoad(boot: UrlView): Promise<void> {
  const src = boot.src;
  if (!src) return;
  if (boot.timeline && timelineBoot) {
    await timelineBoot({ src, branch: boot.branch, commit: boot.commit ?? undefined });
    if (TIMELINE_MODE.peek()) return;
  }
  await loadSource({ src, branch: boot.branch });
}

/** The project the URL asks for, as one comparable string: a computed notifies
 *  only when THAT changes, so writing ?sel= or ?mode= cannot re-ask it. */
const URL_SOURCE = computed(() => {
  if (ROUTE_PATH.value !== ROUTES.CITY) return '';
  const view = readUrlView(ROUTE_PARAMS.value);
  return view.src ? sourceIdentity(view.src, view.branch) : '';
});

/** Load whatever project the URL names, whenever that changes: the boot read
 *  and every Back/Forward between cities are the same event. Returns a dispose. */
export function attachRouteLoad(): () => void {
  return effect(() => {
    if (!URL_SOURCE.value) return;
    // Peeked: the identity above is the trigger, and re-reading the params here
    // must not subscribe this to the view ones alongside it.
    const boot = readUrlView(ROUTE_PARAMS.peek());
    // Out of the tracking scope: the load writes signals this effect reads.
    queueMicrotask(() => {
      // Committing a remote keeps the branch the server resolved, which lands in
      // the URL and moves the identity above. The city on screen is not a new ask.
      const cur = CURRENT_SOURCE.peek();
      if (cur && boot.src && sameSourceIdentity(cur, { src: boot.src, branch: boot.branch })) {
        return;
      }
      void bootLoad(boot);
    });
  });
}

// ── Hook ─────────────────────────────────────────────────────────────

/** Boot the fetch pipeline on mount. Nothing to hand back: loadSource and
 *  friends are module functions, so each view calls the one it needs. */
export function useManifestSource(): void {
  useEffect(() => {
    let cancelled = false;
    let disposeLiveUpdates: (() => void) | null = null;
    // The URL drives what is rendered: boot read and every later Back/Forward.
    // A bare ?src is complete; the server resolves the default branch.
    const disposeRouteLoad = attachRouteLoad();
    (async () => {
      // Independent boot reads, so they go out together rather than making the
      // landing wait for two round trips in series.
      const [serverConfig, discover] = await Promise.all([
        API.getServerConfig(),
        API.getDiscover(),
      ]);
      if (cancelled) return;
      SERVER_CONFIG.value = serverConfig;
      DISCOVER.value = discover;

      // One loop for the app's lifetime: it re-reads the canonical signals per
      // tick, so boot and every switch are covered without restarting it.
      disposeLiveUpdates = setupLiveUpdates();
    })();
    return () => {
      cancelled = true;
      disposeRouteLoad();
      disposeLiveUpdates?.();
    };
  }, []);
}
