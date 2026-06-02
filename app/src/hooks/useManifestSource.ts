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
// (streamManifest/urls) and drives the session stores (loading overlay, source
// info, per-source persistence). It writes REBUILD_STATUS=Error only for a
// live-update FETCH/network failure — a distinct concern from the render layer's
// apply error.
//
// Shape of the file, top to bottom:
//   1. small helpers shared by the two stream entry points (pumpManifestStream,
//      resolveBranch, setSourceInfo, syncUrlToSource)
//   2. streamInitialManifest — cold-boot load from ?src
//   3. applyNewSource        — user picks a new source in the picker
//   4. setupLiveUpdates      — the background poll loop + its ENABLED gate
//   5. useManifestSource     — wire it all together on mount

import { useEffect, useCallback, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';

import {
  manifestUrl,
  manifestUrlFor,
  signatureUrl,
  streamManifest,
  ScanPhase,
  type ScanProgressEvent,
} from '@/api/manifest';
import { getServerConfig } from '@/api/config';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import {
  SOURCE_INFO,
  sourceKey,
  CURRENT_SOURCE_KEY,
  PENDING_SOURCE_LABEL,
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
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  openSourcePicker,
  closeSourcePicker,
} from '@/state/stores/ui';
import { srcKind, SourceKind, labelFromUrl, labelFromManifest } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import { LoadingStep } from '@/constants/loadingSteps';
import { URL_PARAMS } from '@/constants/urlParams';
import type { Manifest } from '@/types';
import type { SourcePayload } from '@/state/stores/ui';

// ── Shared helpers ───────────────────────────────────────────────────

/** Map a cloning/scanning progress event to the loading-overlay step + tail. */
function _handleProgressEvent(event: ScanProgressEvent): void {
  if (event.phase === ScanPhase.Cloning) {
    setLoadingStep(LoadingStep.Cloning);
    if (event.percent !== undefined) {
      const stage = event.stage ? ` (${event.stage})` : '';
      setLoadingStepTail(LoadingStep.Cloning, `${event.percent}%${stage}`);
    }
  } else if (event.phase === ScanPhase.Scanning) {
    setLoadingStep(LoadingStep.Scanning);
    if (event.files_scanned !== undefined) {
      setLoadingStepTail(LoadingStep.Scanning, `${event.files_scanned.toLocaleString()} files`);
    }
  }
}

/**
 * Consume a manifest stream, driving the UI side-effects both entry points
 * share — throw on an error event, set the pending-title once, route
 * cloning/scanning to the progress helper, and advance the loading step — then
 * invoke onManifest for each skeleton/final manifest event so the caller can do
 * its phase-specific publish work. Returns the final manifest; throws if the
 * stream ends without yielding one.
 */
async function pumpManifestStream(
  url: string,
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
      _handleProgressEvent(event);
      continue;
    }

    // Skeleton or final: the cloning/scanning progress tails are done.
    setLoadingStepTail(LoadingStep.Cloning, null);
    setLoadingStepTail(LoadingStep.Scanning, null);
    setLoadingStep(event.phase === ScanPhase.Skeleton ? LoadingStep.Skeleton : LoadingStep.Building);

    await onManifest(event.manifest, event.phase);
    lastManifest = event.manifest;
  }

  if (!lastManifest) throw new Error('No manifest received');
  return lastManifest;
}

/**
 * Resolve which branch label to show and whether it's the repo default. The
 * server sometimes reports a non-branch (detached HEAD, "(no branch)", names
 * with spaces) — treat those as "no branch". An explicitly requested branch
 * always wins and is never considered the default.
 */
function resolveBranch(manifest: Manifest, requested?: string): { branch?: string; isDefault: boolean } {
  const mb = manifest.repo.branch;
  const looksReal = !!mb && !/\s/.test(mb) && !mb.startsWith('(') && !mb.startsWith('detached');
  return {
    branch: requested ?? (looksReal ? mb! : undefined),
    isDefault: !requested && looksReal,
  };
}

/** Publish SOURCE_INFO so the header renders its project chip. */
function setSourceInfo(src: string, manifest: Manifest, branch?: string): void {
  SOURCE_INFO.value = {
    label: labelFromManifest(manifest) ?? manifest.tree?.name ?? '',
    branch,
    sourceUrl: srcKind(src) === SourceKind.Git ? src : undefined,
  };
}

/** Reflect the applied source in the page URL so reload/share reopens it. */
function syncUrlToSource(payload: SourcePayload): void {
  const url = new URL(window.location.href);
  url.searchParams.set(URL_PARAMS.SRC, payload.src);
  if (payload.branch) url.searchParams.set(URL_PARAMS.BRANCH, payload.branch);
  else url.searchParams.delete(URL_PARAMS.BRANCH);
  history.replaceState(null, '', url.toString());
}

// ── Initial boot stream ──────────────────────────────────────────────

interface InitialStreamResult {
  error: string | null;
}

/**
 * Run the initial manifest stream on cold boot. With no ?src, returns
 * immediately (MANIFEST stays EMPTY_MANIFEST — the render layer paints an empty
 * scene). Otherwise shows the loading overlay, WRITES each manifest event into
 * MANIFEST (the render layer applies them), and writes SOURCE_INFO. On any
 * failure the returned error is set and MANIFEST is left at its current
 * (empty) value.
 */
async function streamInitialManifest(): Promise<InitialStreamResult> {
  const qp = new URLSearchParams(window.location.search);
  const bootSrc = qp.get(URL_PARAMS.SRC);

  if (!bootSrc) {
    return { error: null };
  }

  const bootBranch = qp.get(URL_PARAMS.BRANCH) ?? undefined;
  showLoadingOverlay({
    kind: srcKind(bootSrc),
    label: labelFromUrl(bootSrc) ?? bootSrc,
    branch: bootBranch,
  });

  let error: string | null = null;

  try {
    // Write each manifest event (skeleton, then final) into MANIFEST; the
    // render layer applies whatever MANIFEST holds. The display-label rewrite +
    // icon-atlas build happen inside world.applyManifest on the render side.
    await pumpManifestStream(manifestUrl(), (m) => {
      setManifest(m);
      setSourceInfo(bootSrc, m, resolveBranch(m, bootBranch).branch);
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // MANIFEST stays at its current (empty) value.
  } finally {
    hideLoadingOverlay();
    PENDING_SOURCE_LABEL.value = null;
  }

  return { error };
}

// ── New-source stream (user-submitted via source picker) ─────────────

interface ApplyNewSourceOpts {
  payload: SourcePayload;
  pendingSkipCache: boolean;
  /** Existing live-updates handle if already running, null if not yet started. */
  liveUpdatesHandle: { setSignature(sig: string): void } | null;
  onLiveUpdatesStarted: (api: { setSignature(sig: string): void }) => void;
  onError: (opts: { dismissible: boolean; payload: SourcePayload; error: string }) => void;
}

/**
 * Stream a new source submitted from the source picker: WRITE the skeleton into
 * MANIFEST as it arrives (the render layer paints it), then write the final
 * manifest and update the URL, SOURCE_INFO, per-source persistence, and
 * live-updates. Calls onError (dismissible) if streaming fails.
 *
 * Scene-free: where the old useCity called handle.world.resetCache() before
 * streaming, that call is intentionally dropped. resetCache only nulls the
 * tree_signature-keyed layout/scenic caches and disposes the instanced ad
 * panels — and a new source has a different tree_signature, so applyManifest's
 * full-rebuild path (cache miss + scenic-reuse guard miss) already busts those
 * caches and disposes/rebuilds the ad panels. Nothing is left stale.
 */
async function applyNewSource(opts: ApplyNewSourceOpts): Promise<void> {
  const { payload, pendingSkipCache, liveUpdatesHandle, onLiveUpdatesStarted, onError } = opts;

  showLoadingOverlay({
    kind: srcKind(payload.src),
    label: labelFromUrl(payload.src) ?? payload.src,
    branch: payload.branch,
  });

  try {
    const url = manifestUrlFor({ src: payload.src, branch: payload.branch, noCache: pendingSkipCache });

    // Publish the skeleton as soon as it arrives so the user sees structure; the
    // final manifest (the pump's return value) carries real heights + signature
    // and is published below.
    const manifest = await pumpManifestStream(url, (m, phase) => {
      if (phase === ScanPhase.Skeleton) {
        setManifest(m);
        setSourceInfo(payload.src, m, payload.branch);
      }
    });

    syncUrlToSource(payload);
    // cameraRig resets the camera when the active source key changes.
    CURRENT_SOURCE_KEY.value = sourceKey(payload.src, payload.branch);

    setManifest(manifest);

    const { branch, isDefault } = resolveBranch(manifest, payload.branch);
    setSourceInfo(payload.src, manifest, branch);

    // Live updates: the first successful load starts the poll loop; later
    // source switches just hand the running loop the new signature.
    if (liveUpdatesHandle) {
      liveUpdatesHandle.setSignature(manifest.signature);
    } else {
      onLiveUpdatesStarted(setupLiveUpdates(manifest.signature));
    }

    pushRecent({
      src: payload.src,
      branch,
      branchIsDefault: isDefault,
      label: labelFromUrl(payload.src) ?? payload.src,
    });
  } catch (err) {
    onError({
      dismissible: true,
      payload,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    hideLoadingOverlay();
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
 * /signature endpoint and only fetches the full manifest when it changed. On the
 * final event of a fetch it WRITES MANIFEST — the render effect applies it and
 * owns the Rebuilding/Decorating/Idle status. A live-update FETCH/network
 * failure (the stream throws) is surfaced through REBUILD_STATUS=Error +
 * LAST_REBUILD_ERROR here, distinct from the render-owned apply error.
 * Gates the timer on LIVE_UPDATES.ENABLED.
 */
function setupLiveUpdates(
  initialSignature: string
): { setSignature(sig: string): void } {
  let lastSignature = initialSignature || '';
  let timer: number | null = null;
  let inFlight = false;

  // Single fetch+publish path. Writes MANIFEST on the final event; the render
  // effect applies it and owns the rebuild status. A network/stream failure is
  // reported here as a fetch error (distinct from the render apply error).
  async function fetchAndApply(): Promise<void> {
    try {
      for await (const event of streamManifest(manifestUrl())) {
        if (event.phase === ScanPhase.Error) throw new Error(event.error);
        // Live-update path: skip skeleton. The city is already drawn; applying
        // a skeleton would animate every building to placeholder heights and
        // back on every save. Only the final tweens into the new state.
        if (event.phase !== ScanPhase.Final) continue;
        const m = event.manifest;
        if (m?.signature) {
          lastSignature = m.signature;
          setManifest(m);
        }
      }
    } catch (err) {
      REBUILD_STATUS.value = RebuildStatus.Error;
      LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
    }
  }

  // Poll tick: cheap signature first, full manifest only on change.
  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const sigResp = await fetch(signatureUrl());
      if (!sigResp.ok) return;
      const sig: SignatureResponse | null = await sigResp.json();
      if (!sig?.signature || sig.signature === lastSignature) return;
      await fetchAndApply();
    } catch (_) {
      // Signature-fetch errors (network blip on the cheap probe) are not
      // surfaced through REBUILD_STATUS — no rebuild attempt happened. The
      // next tick retries.
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

  // LIVE_UPDATES gates the loop: ENABLED turns polling on/off, POLL_SECONDS sets
  // the interval. effect() runs the body once immediately — doing the initial
  // start if enabled at boot — and re-runs on every change to either field.
  // start() is idempotent (it stop()s first), so a POLL_SECONDS change just
  // re-arms the timer at the new interval.
  effect(() => {
    if (LIVE_UPDATES.value.ENABLED) start();
    else stop();
  });

  return {
    setSignature(sig: string) {
      lastSignature = sig;
    },
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Boot the manifest FETCH pipeline on mount: stream the initial manifest from
 * ?src into MANIFEST, fetch the server config, and start live updates.
 * Scene-free — the render layer (useCityScene) consumes MANIFEST and paints the
 * scene. RETURNS the source-picker submit handler so App can pass it down to
 * <SourcePicker> as a prop (no global register/invoke channel). The handler
 * closes over a ref holding the mutable live-updates handle, so a single stable
 * callback can read/write whatever the boot/first-submit started.
 */
export function useManifestSource(): (payload: SourcePayload) => void {
  const liveUpdatesRef = useRef<{ setSignature(s: string): void } | null>(null);

  const submitSource = useCallback((payload: SourcePayload) => {
    closeSourcePicker();
    applyNewSource({
      payload,
      pendingSkipCache: !!payload.skipCache,
      liveUpdatesHandle: liveUpdatesRef.current,
      onLiveUpdatesStarted(api) {
        liveUpdatesRef.current = api;
      },
      onError({ dismissible, payload: errPayload, error }) {
        openSourcePicker({ dismissible, prefill: errPayload, error });
      },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has(URL_PARAMS.SRC)) {
        CURRENT_SOURCE_KEY.value = sourceKey(qp.get(URL_PARAMS.SRC)!, qp.get(URL_PARAMS.BRANCH) ?? undefined);
      }
      const { error: initialError } = await streamInitialManifest();
      if (cancelled) return;
      const serverConfig = await getServerConfig();
      SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };
      if (qp.has(URL_PARAMS.SRC) && !initialError && !isEmptyManifest(MANIFEST.peek())) {
        liveUpdatesRef.current = setupLiveUpdates((MANIFEST.peek() as Manifest).signature);
      }

      if (initialError) {
        openSourcePicker({
          dismissible: false,
          prefill: { src: qp.get(URL_PARAMS.SRC)!, branch: qp.get(URL_PARAMS.BRANCH) ?? undefined },
          error: initialError,
        });
      } else if (!qp.has(URL_PARAMS.SRC)) {
        openSourcePicker({ dismissible: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return submitSource;
}
