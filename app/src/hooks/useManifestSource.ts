// hooks/useManifestSource.ts — The FETCH layer of the city's manifest pipeline.
//
// SCENE-FREE by contract: it never touches the Three.js world. It streams
// manifests (cold-boot from ?src, user-submitted source switches, and the
// background live-update poll) and WRITES them via setManifest. The render
// layer (the City component, in CenterPane) is a CONSUMER of MANIFEST — it applies
// whatever this layer publishes to the scene and OWNS the rebuild status for
// the apply (Rebuilding/Decorating/Idle + render-apply Error).
//
// This module consumes the PURE fetch primitives in @/api/manifest
// (streamManifest/urls) and drives the session stores: it WRITES the canonical
// SCAN_PROGRESS signal while a source loads (the loading overlay is a REACTION to
// it — see state/loadingReactions; this layer never pokes LOADING_OVERLAY). On a
// successful load it commits the source via setCurrentSource (CURRENT_SOURCE +
// recents) — this layer never writes CURRENT_SOURCE directly. The header chip
// (SOURCE_INFO) is a computed off CURRENT_SOURCE + MANIFEST — this layer never
// writes it. It writes REBUILD_STATUS=Error only for a live-update FETCH/network
// failure — a distinct concern from the render layer's apply error.
//
// Shape of the file, top to bottom:
//   1. pumpManifestStream — the helper shared by the stream entry points
//   2. loadSource         — the one canonical load (cold boot + user switch)
//   3. setupLiveUpdates   — the background poll loop + its ENABLED gate
//   4. useManifestSource  — wire it all together on mount

import { useEffect, useCallback } from 'preact/hooks';
import { effect } from '@preact/signals';

import { manifestUrlFor, signatureUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import { getServerConfig } from '@/api/config';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import {
  PENDING_SOURCE_LABEL,
  SOURCE_ERROR,
  setCurrentSource,
  CURRENT_SOURCE,
} from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { MANIFEST, setManifest, markError, markRebuilding } from '@/state/stores/manifest';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { TIME_TRAVEL_REF } from '@/state/stores/timeTravel';
import { activeExcludePathsFor, ACTIVE_EXCLUDES } from '@/state/stores/excludes';
import { srcKind, SourceKind, srcNeedsBranch, identityBranch, sourceKey } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import { URL_PARAMS } from '@/constants/urlParams';
import type { Manifest } from '@/types';
import type { SourcePayload } from '@/state/stores/ui';

// ── Shared helpers ───────────────────────────────────────────────────

/**
 * Consume a manifest stream, writing the canonical SCAN_PROGRESS signal per
 * event (the loading overlay is a REACTION to it — see state/loadingReactions)
 * — throw on an error event, set the pending-title once, publish cloning/scanning
 * progress, and write a skeleton/final SCAN_PROGRESS — then invoke onManifest for
 * each skeleton/final manifest event so the caller can do its phase-specific
 * publish work. Returns the final manifest; throws if the stream ends without
 * yielding one.
 */
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

  for await (const event of streamManifest(url, { signal })) {
    if (event.phase === ScanPhase.Error) throw new Error(event.error);

    if ('label' in event && event.label) {
      // The canonical "label of the source being loaded" — computed server-side
      // and read by BOTH the document title (useDocumentTitle) and the loading
      // overlay's header, so the project name isn't derived client-side. Idempotent:
      // @preact/signals dedupes same-value writes and the label is stable per load.
      PENDING_SOURCE_LABEL.value = event.label;
    }

    if (event.phase === ScanPhase.CloneProgress || event.phase === ScanPhase.ScanProgress) {
      SCAN_PROGRESS.value = {
        ...meta,
        phase: event.phase,
        percent: event.phase === ScanPhase.CloneProgress ? event.percent : undefined,
        stage: event.phase === ScanPhase.CloneProgress ? event.stage : undefined,
        mbOnDisk: event.phase === ScanPhase.CloneProgress ? event.mb_on_disk : undefined,
        filesScanned: event.phase === ScanPhase.ScanProgress ? event.files_scanned : undefined,
      };
      continue;
    }

    // Skeleton or final.
    SCAN_PROGRESS.value = { ...meta, phase: event.phase };
    // Once a manifest lands, its tree.name is the canonical repo name (the
    // remote's owner/repo), better than the src basename — which for a
    // local working tree is the folder name (e.g. a git-worktree dir).
    if (event.manifest.tree?.name) PENDING_SOURCE_LABEL.value = event.manifest.tree.name;
    await onManifest(event.manifest, event.phase);
    lastManifest = event.manifest;
  }

  if (!lastManifest) throw new Error('No manifest received');
  return lastManifest;
}

// ── Single-writer generation guard ───────────────────────────────────
// MANIFEST has many would-be writers — the cold-boot load, each user switch,
// and the background live-update poll — all targeting one signal. A monotonic
// generation token makes the NEWEST load authoritative: every write (skeleton,
// final, the source commit, the overlay teardown, a surfaced error) is gated on
// "am I still the current generation?". A foreground load bumps it, which
// silently drops any older in-flight load AND any in-flight poll write — so an
// update firing mid-load can no longer clobber the world being loaded with the
// previous source's manifest. Mirrors the same generation guard cityState's
// applyManifest already uses one layer down.
let loadGeneration = 0;

// The AbortController for the current foreground load, so the UI can cancel a
// slow clone/scan. A new load or a cancel aborts the previous one.
let loadController: AbortController | null = null;

// ── Canonical source load (cold-boot + user switch) ──────────────────
// The one way to load a source: claim the generation → overlay → stream
// skeleton+final into MANIFEST → on success commit the source (CURRENT_SOURCE +
// recents) → on failure write SOURCE_ERROR. Scene-free + UI-free: it publishes
// canonical signals only; the render layer applies MANIFEST and resets the
// camera, App coordinates the picker off SOURCE_ERROR. (The live-update poll
// below is a SEPARATE op — a background refresh of the current source that
// shares only the MANIFEST sink, and yields to a foreground load via the gen.)
export async function loadSource(payload: SourcePayload): Promise<void> {
  TIME_TRAVEL_REF.value = null; // any real source load means back to live
  const myGen = ++loadGeneration; // claim authority; supersedes any in-flight load/poll
  loadController?.abort(); // supersede any in-flight load
  const controller = new AbortController();
  loadController = controller;
  // A local source has no branch axis — drop any branch (a stale deep-link or a
  // legacy recent could carry one) so the fetch URL, overlay, committed source,
  // and prefill all stay branch-less. The checked-out branch is display-only.
  const branch = identityBranch(payload.src, payload.branch);
  const meta = {
    kind: srcKind(payload.src),
    branch,
  };
  SCAN_PROGRESS.value = { ...meta, phase: null }; // show overlay immediately
  // Snapshot the applied manifest so a cancel that lands after a skeleton was
  // streamed into MANIFEST can roll it back — otherwise the canceled repo's
  // partial geometry lingers under the unchanged CURRENT_SOURCE's header.
  const prevManifest = MANIFEST.peek();

  try {
    const url = manifestUrlFor({
      src: payload.src,
      branch,
      noCache: !!payload.skipCache,
      exclude: activeExcludePathsFor(payload.src),
    });
    // Publish the skeleton as it streams (early structure, behind the overlay);
    // the final is published below, AFTER committing the source.
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
    // Canceled after a skeleton: the aborted stream ends as done (not a throw),
    // so we got the partial manifest back. Don't commit it — roll MANIFEST back
    // to the pre-load snapshot so the canceled repo's skeleton doesn't linger.
    if (controller.signal.aborted) {
      setManifest(prevManifest);
      return;
    }
    // Commit the source BEFORE publishing the final manifest. The render layer's
    // camera-reframe reaction keys off CURRENT_SOURCE captured at apply-START, so
    // the new key must be live for the FINAL apply (the one to frame on) and NOT
    // for the preceding skeleton apply (which must not reframe).
    setCurrentSource(payload.src, branch, manifest);
    setManifest(manifest);
  } catch (err) {
    if (myGen !== loadGeneration) return; // superseded — its error isn't current
    if (controller.signal.aborted) {
      setManifest(prevManifest); // user canceled: not an error; roll back any skeleton
      return;
    }
    SOURCE_ERROR.value = {
      error: err instanceof Error ? err.message : String(err),
      prefill: { src: payload.src, branch },
    };
  } finally {
    // Only the authoritative load tears down the overlay; a superseded one must
    // not clear it out from under the newer load that's still streaming.
    if (myGen === loadGeneration) {
      SCAN_PROGRESS.value = null;
      PENDING_SOURCE_LABEL.value = null;
      if (loadController === controller) loadController = null;
    }
  }
}

/**
 * Abort the in-flight foreground load, if any. Exposed to the UI (a cancel
 * button on the loading overlay) via the hook's return; the abort is treated
 * as a clean user cancel, not a failure — see the `catch` branch above.
 */
export function cancelLoad(): void {
  loadController?.abort();
}

// Load a past ref of CURRENT_SOURCE in place. Streams the final directly (like
// the live-update refresh) instead of via pumpManifestStream, so it never writes
// SCAN_PROGRESS: no loading overlay, the scene tween carries the morph. Shares
// the generation guard; leaves CURRENT_SOURCE/recents alone.
export async function loadRef(sha: string): Promise<void> {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return;
  const myGen = ++loadGeneration; // supersedes any in-flight load/poll
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  markRebuilding(); // footer shows "rebuilding…" through the fetch, before the apply
  try {
    const url = manifestUrlFor({
      src: cur.src,
      branch: cur.branch,
      ref: sha,
      exclude: activeExcludePathsFor(cur.src),
    });
    for await (const event of streamManifest(url, { signal: controller.signal })) {
      if (event.phase === ScanPhase.Error) throw new Error(event.error);
      if (event.phase !== ScanPhase.CompleteManifest) continue;
      if (myGen !== loadGeneration) return;
      setManifest(event.manifest);
    }
    if (myGen !== loadGeneration || controller.signal.aborted) return;
    TIME_TRAVEL_REF.value = sha; // pin AFTER a successful apply
  } catch (err) {
    if (myGen !== loadGeneration || controller.signal.aborted) return;
    markError(err); // footer error, not the source picker (a bad slider sha is rare)
  } finally {
    if (myGen === loadGeneration && loadController === controller) loadController = null;
  }
}

// Clear the pin (poll resumes) then reload HEAD via loadSource.
export function exitTimeTravel(): void {
  const cur = CURRENT_SOURCE.peek();
  TIME_TRAVEL_REF.value = null; // clear first so the poll resumes
  if (cur) void loadSource({ src: cur.src, branch: cur.branch });
}

// ── Live-update poll loop ────────────────────────────────────────────

// Hard bounds for the user-set poll interval. 1s floor — the server does a real
// filesystem walk per poll, so tighter just burns CPU. 60s ceiling — beyond
// that "live" stops feeling live.
const POLL_SECONDS_MIN = 1;
const POLL_SECONDS_MAX = 60;

function _clampPollSeconds(s: number | unknown): number {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

interface SignatureResponse {
  root: string;
  scanned_at: string;
  content_signature: string;
}

/**
 * Start the live-update poll loop. Two-stage poll: each tick hits the cheap
 * /signature endpoint for the committed CURRENT_SOURCE and only fetches the full
 * manifest when it differs from the currently-applied manifest's content_signature (both
 * read from canonical signals — no private mirror). On the final event of a
 * fetch it WRITES MANIFEST; the render effect applies it and owns
 * Rebuilding/Decorating/Idle. A live-update FETCH/network failure is surfaced via
 * REBUILD_STATUS=Error + LAST_REBUILD_ERROR (distinct from the render-owned apply
 * error). The loop no-ops until a source is loaded and yields (via loadGeneration
 * + the SCAN_PROGRESS gate) while a foreground load is in flight, so an update
 * firing mid-load can't clobber the world being loaded. Returns a dispose fn
 * (stop timer + tear down the ENABLED effect + the exclude-refresh reaction).
 * The poll loop itself is gated on LIVE_UPDATES.ENABLED, but the exclude-refresh
 * reaction below is NOT — it's the only trigger for an exclude edit and must run
 * regardless of the live-update toggle. Exported so the exclude-refresh reaction
 * is directly testable.
 */
export function setupLiveUpdates(): () => void {
  let timer: number | null = null;
  let inFlight = false;

  async function fetchAndApply(src: string, branch: string | undefined): Promise<void> {
    const myGen = loadGeneration; // capture; a foreground load bumping this drops our write
    try {
      for await (const event of streamManifest(
        manifestUrlFor({ src, branch, exclude: activeExcludePathsFor(src) })
      )) {
        if (event.phase === ScanPhase.Error) throw new Error(event.error);
        // Live-update path: skip skeleton. The city is already drawn; applying
        // a skeleton would animate every building to placeholder heights and
        // back on every save. Only the final tweens into the new state.
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

  // Poll tick: cheap signature first, full manifest only when it differs from
  // the applied manifest's content_signature. Targets the committed CURRENT_SOURCE (not
  // the page URL, which lags a switch) and yields while a foreground load owns
  // the overlay, so the poll never probes/applies a source that's mid-load.
  async function tick(): Promise<void> {
    if (inFlight) return;
    if (TIME_TRAVEL_REF.peek() !== null) return; // pinned to a past ref — the poll must not pull HEAD back in
    if (SCAN_PROGRESS.peek() !== null) return; // a foreground load is in flight — yield
    const cur = CURRENT_SOURCE.peek();
    if (!cur) return; // nothing loaded yet
    const current = MANIFEST.peek();
    if (isEmptyManifest(current)) return;
    const applied = (current as Manifest).content_signature;
    inFlight = true;
    try {
      const sigResp = await fetch(
        signatureUrlFor(cur.src, cur.branch, activeExcludePathsFor(cur.src))
      );
      if (!sigResp.ok) return;
      const sig: SignatureResponse | null = await sigResp.json();
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
    if (LIVE_UPDATES.value.ENABLED) start();
    else stop();
  });

  // Re-fetch the loaded source in place when ITS exclude set changes. The poll
  // is gated by LIVE_UPDATES.ENABLED (default off), so excludes need their own
  // trigger. Uses fetchAndApply (final-only, no overlay/skeleton) for a smooth
  // in-place update. Key-guarded: ACTIVE_EXCLUDES also recomputes on a source
  // switch (repo key changes) — only a same-repo list change refreshes.
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
    if (TIME_TRAVEL_REF.peek() !== null) return; // pinned to a past ref — don't pull HEAD back in
    if (SCAN_PROGRESS.peek() !== null) return; // yield to a foreground load
    if (!cur) return;
    if (inFlight) return; // the poll's tick is already covering this refresh
    inFlight = true;
    void fetchAndApply(cur.src, cur.branch).finally(() => {
      inFlight = false;
    });
  });

  return () => {
    stop();
    disposeEnabledEffect();
    disposeExcludeRefresh();
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Boot the manifest FETCH pipeline on mount: stream the initial manifest from
 * ?src into MANIFEST, fetch the server config, and start live updates.
 * Scene-free — the render layer (the City component) consumes MANIFEST and paints the
 * scene. UI-free too: it never opens/closes ProjectsView; on a load failure
 * (boot or submit) it WRITES the canonical SOURCE_ERROR signal and App reacts to
 * coordinate ProjectsView. A user-initiated cancel (`cancelLoad`) aborts the
 * in-flight stream but is NOT surfaced as a load failure — no SOURCE_ERROR write.
 * RETURNS the submit handler and a cancel handler so App can pass
 * them down to <ProjectsView>/the loading overlay as props (no global
 * register/invoke channel).
 */
export function useManifestSource(): {
  submitSource: (payload: SourcePayload) => void;
  cancelLoad: () => void;
} {
  const submitSource = useCallback((payload: SourcePayload) => {
    void loadSource(payload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let disposeLiveUpdates: (() => void) | null = null;
    (async () => {
      const qp = new URLSearchParams(window.location.search);
      const bootSrc = qp.get(URL_PARAMS.SRC);
      const bootBranch = qp.get(URL_PARAMS.BRANCH) ?? undefined;
      // A remote ?src with no ?branch can't load without a branch choice — App
      // opens the picker (prefilled) for it, just like a no-src cold boot. Only
      // auto-load a fully-specified source here.
      if (bootSrc && !srcNeedsBranch(bootSrc, bootBranch)) {
        await loadSource({ src: bootSrc, branch: bootBranch });
      }
      if (cancelled) return;

      const serverConfig = await getServerConfig();
      SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };

      // One poll loop for the app's lifetime; no-ops until a source is loaded,
      // re-reads CURRENT_SOURCE + MANIFEST.content_signature each tick (covers
      // boot + every switch).
      disposeLiveUpdates = setupLiveUpdates();
      // No ?src on cold boot → App opens the picker (the hook doesn't manage UI).
    })();
    return () => {
      cancelled = true;
      disposeLiveUpdates?.();
    };
  }, []);

  return { submitSource, cancelLoad };
}
