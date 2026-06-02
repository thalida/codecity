// hooks/useManifestSource.ts — The FETCH layer of the city's manifest pipeline.
//
// SCENE-FREE by contract: it never touches the Three.js world. It streams
// manifests (cold-boot from ?src, user-submitted source switches, and the
// background live-update poll) and WRITES them via setManifest. The render
// layer (useCityScene, in CenterPane) is a CONSUMER of MANIFEST — it applies
// whatever this layer publishes to the scene and OWNS the rebuild status for
// the apply (Rebuilding/Decorating/Idle + render-apply Error).
//
// This module consumes the PURE fetch primitives in @/api/manifest
// (streamManifest/urls) and drives the session stores: it WRITES the canonical
// SCAN_PROGRESS signal while a source loads (the loading overlay is a REACTION to
// it — see state/loadingReactions; this layer never pokes LOADING_OVERLAY), plus
// CURRENT_SOURCE and per-source persistence. The header chip (SOURCE_INFO) is a
// computed off CURRENT_SOURCE + MANIFEST — this layer never writes it. It writes
// REBUILD_STATUS=Error only for a live-update FETCH/network failure — a distinct
// concern from the render layer's apply error.
//
// Shape of the file, top to bottom:
//   1. pumpManifestStream — the helper shared by the two stream entry points
//   2. streamInitialManifest — cold-boot load from ?src
//   3. applyNewSource        — user picks a new source in the picker
//   4. setupLiveUpdates      — the background poll loop + its ENABLED gate
//   5. useManifestSource     — wire it all together on mount

import { useEffect, useCallback } from 'preact/hooks';
import { effect } from '@preact/signals';

import {
  manifestUrl,
  manifestUrlFor,
  signatureUrl,
  streamManifest,
  ScanPhase,
} from '@/api/manifest';
import { getServerConfig } from '@/api/config';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import {
  CURRENT_SOURCE,
  PENDING_SOURCE_LABEL,
  SOURCE_ERROR,
  pushRecent,
} from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import {
  MANIFEST,
  setManifest,
  REBUILD_STATUS,
  RebuildStatus,
  LAST_REBUILD_ERROR,
} from '@/state/stores/manifest';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { srcKind, labelFromUrl, resolveBranch, SourceKind } from '@/utils/sources';
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
  meta: { kind: SourceKind; label: string; branch?: string },
  onManifest: (manifest: Manifest, phase: ScanPhase.Skeleton | ScanPhase.Final) => Promise<void> | void
): Promise<Manifest> {
  let lastManifest: Manifest | null = null;

  for await (const event of streamManifest(url)) {
    if (event.phase === ScanPhase.Error) throw new Error(event.error);

    if ('display_root' in event && event.display_root) {
      // The canonical "label of the source being loaded" — read by BOTH the
      // document title (useDocumentTitle) and the loading overlay's header, so
      // the project name isn't duplicated into the overlay store. Idempotent:
      // @preact/signals dedupes same-value writes and display_root is stable
      // per load, so no need to guard against repeat events.
      PENDING_SOURCE_LABEL.value = labelFromUrl(event.display_root) ?? null;
    }

    if (event.phase === ScanPhase.Cloning || event.phase === ScanPhase.Scanning) {
      SCAN_PROGRESS.value = {
        ...meta,
        phase: event.phase,
        percent: event.phase === ScanPhase.Cloning ? event.percent : undefined,
        stage: event.phase === ScanPhase.Cloning ? event.stage : undefined,
        filesScanned: event.phase === ScanPhase.Scanning ? event.files_scanned : undefined,
      };
      continue;
    }

    // Skeleton or final.
    SCAN_PROGRESS.value = { ...meta, phase: event.phase };
    await onManifest(event.manifest, event.phase);
    lastManifest = event.manifest;
  }

  if (!lastManifest) throw new Error('No manifest received');
  return lastManifest;
}

// ── Initial boot stream ──────────────────────────────────────────────

interface InitialStreamResult {
  error: string | null;
}

/**
 * Run the initial manifest stream on cold boot. With no ?src, returns
 * immediately (MANIFEST stays EMPTY_MANIFEST — the render layer paints an empty
 * scene). Otherwise sets SCAN_PROGRESS (which the loading-overlay reaction shows)
 * and WRITES each manifest event into MANIFEST (the render layer applies them).
 * On any failure the returned error is set and MANIFEST is left at its current
 * (empty) value.
 */
async function streamInitialManifest(): Promise<InitialStreamResult> {
  const qp = new URLSearchParams(window.location.search);
  const bootSrc = qp.get(URL_PARAMS.SRC);

  if (!bootSrc) {
    return { error: null };
  }

  const bootBranch = qp.get(URL_PARAMS.BRANCH) ?? undefined;
  const meta = { kind: srcKind(bootSrc), label: labelFromUrl(bootSrc) ?? bootSrc, branch: bootBranch };
  SCAN_PROGRESS.value = { ...meta, phase: null }; // show overlay immediately

  let error: string | null = null;

  try {
    // Write each manifest event (skeleton, then final) into MANIFEST; the
    // render layer applies whatever MANIFEST holds. The display-label rewrite +
    // icon-atlas build happen inside world.applyManifest on the render side.
    await pumpManifestStream(manifestUrl(), meta, (m) => {
      setManifest(m);
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // MANIFEST stays at its current (empty) value.
  } finally {
    SCAN_PROGRESS.value = null;
    PENDING_SOURCE_LABEL.value = null;
  }

  return { error };
}

// ── New-source stream (user-submitted via source picker) ─────────────

interface ApplyNewSourceOpts {
  payload: SourcePayload;
  pendingSkipCache: boolean;
}

/**
 * Stream a new source submitted from the source picker: WRITE the skeleton into
 * MANIFEST as it arrives (the render layer paints it), then write the final
 * manifest, publish CURRENT_SOURCE (which drives the URL + the SOURCE_INFO
 * computed), and update per-source persistence. The always-running poll loop
 * picks up the new MANIFEST.signature on its own — no live-update wiring here.
 * On a streaming failure it WRITES the canonical SOURCE_ERROR signal (App reacts
 * to it to reopen the picker — this layer never touches the picker UI).
 *
 * Scene-free: where the old useCity called handle.world.resetCache() before
 * streaming, that call is intentionally dropped. resetCache only nulls the
 * tree_signature-keyed layout/scenic caches and disposes the instanced ad
 * panels — and a new source has a different tree_signature, so applyManifest's
 * full-rebuild path (cache miss + scenic-reuse guard miss) already busts those
 * caches and disposes/rebuilds the ad panels. Nothing is left stale.
 */
async function applyNewSource(opts: ApplyNewSourceOpts): Promise<void> {
  const { payload, pendingSkipCache } = opts;

  const meta = { kind: srcKind(payload.src), label: labelFromUrl(payload.src) ?? payload.src, branch: payload.branch };
  SCAN_PROGRESS.value = { ...meta, phase: null }; // show overlay immediately

  try {
    const url = manifestUrlFor({ src: payload.src, branch: payload.branch, noCache: pendingSkipCache });

    // Publish the skeleton as soon as it arrives so the user sees structure; the
    // final manifest (the pump's return value) carries real heights + signature
    // and is published below.
    const manifest = await pumpManifestStream(url, meta, (m, phase) => {
      if (phase === ScanPhase.Skeleton) {
        setManifest(m);
      }
    });

    // Publish the applied source: drives CURRENT_SOURCE_KEY (camera reset),
    // the page URL (reload/share), and SOURCE_INFO — all derived from this.
    CURRENT_SOURCE.value = { src: payload.src, branch: payload.branch };

    setManifest(manifest);

    const { branch, isDefault } = resolveBranch(manifest, payload.branch);

    pushRecent({
      src: payload.src,
      branch,
      branchIsDefault: isDefault,
      label: labelFromUrl(payload.src) ?? payload.src,
    });
  } catch (err) {
    SOURCE_ERROR.value = {
      error: err instanceof Error ? err.message : String(err),
      prefill: { src: payload.src, branch: payload.branch },
    };
  } finally {
    SCAN_PROGRESS.value = null;
    PENDING_SOURCE_LABEL.value = null;
  }
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
  signature: string;
}

/**
 * Start the live-update poll loop. Two-stage poll: each tick hits the cheap
 * /signature endpoint and only fetches the full manifest when it differs from
 * the currently-applied manifest's signature (read from the canonical MANIFEST
 * signal — no private mirror). On the final event of a fetch it WRITES MANIFEST;
 * the render effect applies it and owns Rebuilding/Decorating/Idle. A live-update
 * FETCH/network failure is surfaced via REBUILD_STATUS=Error + LAST_REBUILD_ERROR
 * (distinct from the render-owned apply error). The loop no-ops until a source is
 * loaded (MANIFEST non-empty). Returns a dispose fn (stop timer + tear down the
 * ENABLED effect). Gated on LIVE_UPDATES.ENABLED.
 */
function setupLiveUpdates(): () => void {
  let timer: number | null = null;
  let inFlight = false;

  async function fetchAndApply(): Promise<void> {
    try {
      for await (const event of streamManifest(manifestUrl())) {
        if (event.phase === ScanPhase.Error) throw new Error(event.error);
        // Live-update path: skip skeleton. The city is already drawn; applying
        // a skeleton would animate every building to placeholder heights and
        // back on every save. Only the final tweens into the new state.
        if (event.phase !== ScanPhase.Final) continue;
        const m = event.manifest;
        if (m?.signature) setManifest(m);
      }
    } catch (err) {
      REBUILD_STATUS.value = RebuildStatus.Error;
      LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
    }
  }

  // Poll tick: cheap signature first, full manifest only when it differs from
  // the applied manifest's signature. No-op until a source is loaded.
  async function tick(): Promise<void> {
    if (inFlight) return;
    const current = MANIFEST.peek();
    if (isEmptyManifest(current)) return; // nothing loaded yet
    const applied = (current as Manifest).signature;
    inFlight = true;
    try {
      const sigResp = await fetch(signatureUrl());
      if (!sigResp.ok) return;
      const sig: SignatureResponse | null = await sigResp.json();
      if (!sig?.signature || sig.signature === applied) return;
      await fetchAndApply();
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

  return () => {
    stop();
    disposeEnabledEffect();
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Boot the manifest FETCH pipeline on mount: stream the initial manifest from
 * ?src into MANIFEST, fetch the server config, and start live updates.
 * Scene-free — the render layer (useCityScene) consumes MANIFEST and paints the
 * scene. UI-free too: it never opens/closes the source picker; on a load failure
 * (boot or submit) it WRITES the canonical SOURCE_ERROR signal and App reacts to
 * coordinate the picker. RETURNS the source-picker submit handler so App can pass
 * it down to <SourcePicker> as a prop (no global register/invoke channel).
 */
export function useManifestSource(): (payload: SourcePayload) => void {
  const submitSource = useCallback((payload: SourcePayload) => {
    applyNewSource({ payload, pendingSkipCache: !!payload.skipCache });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let disposeLiveUpdates: (() => void) | null = null;
    (async () => {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has(URL_PARAMS.SRC)) {
        CURRENT_SOURCE.value = {
          src: qp.get(URL_PARAMS.SRC)!,
          branch: qp.get(URL_PARAMS.BRANCH) ?? undefined,
        };
      }
      const { error: initialError } = await streamInitialManifest();
      if (cancelled) return;
      const serverConfig = await getServerConfig();
      SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };

      // One poll loop for the app's lifetime. It no-ops until MANIFEST is
      // non-empty and re-reads MANIFEST.signature each tick, so it covers the
      // initial source AND every later switch with no re-wiring.
      disposeLiveUpdates = setupLiveUpdates();

      if (initialError) {
        SOURCE_ERROR.value = {
          error: initialError,
          prefill: { src: qp.get(URL_PARAMS.SRC)!, branch: qp.get(URL_PARAMS.BRANCH) ?? undefined },
        };
      }
      // No ?src on cold boot → App opens the picker (the hook doesn't manage UI).
    })();
    return () => {
      cancelled = true;
      disposeLiveUpdates?.();
    };
  }, []);

  return submitSource;
}
