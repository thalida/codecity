// hooks/useCity.ts — The city's lifecycle + manifest-loading orchestration.
// CenterPane calls useCity(canvasRef) on mount; it streams the initial manifest,
// builds the scene, wires the source-picker apply handler + live-update poll,
// and tears down on unmount.
//
// This is the imperative orchestration layer: it consumes the PURE fetch
// primitives in @/api/manifest (streamManifest/urls) and drives the scene
// (startRenderLoop / world.applyManifest) + the session stores (loading
// overlay, source info, rebuild status). api/ stays free of scene/UI deps;
// this hook owns the apply-to-scene + overlay translation.
//
// Shape of the file, top to bottom:
//   1. small helpers shared by the two stream entry points (pumpManifestStream,
//      startScene, resolveBranch, setSourceInfo, loadIconAtlas, syncUrlToSource)
//   2. streamInitialManifest — cold-boot load from ?src
//   3. applyNewSource        — user picks a new source in the picker
//   4. setupLiveUpdates      — the background poll loop + its ENABLED gate
//   5. bootCity / useCity    — wire it all together on mount

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
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
import { startRenderLoop, _applyDisplayLabel } from '@/scene/renderLoop';
import { buildIconAtlas } from '@/scene/components/buildings/iconAtlas';
import { setIconAtlas } from '@/scene/components/buildings/buildings';
import { setCellIconAtlas } from '@/scene/components/buildings/buildingsCell';
import { attachCommitReactions } from '@/state/settingsReactions';
import { LIVE_UPDATES } from '@/state/stores/settings/index';
import { SCENE_HANDLE, type SceneHandle } from '@/state/stores/scene';
import {
  SOURCE_INFO,
  sourceKey,
  CURRENT_SOURCE_KEY,
  pushRecent,
} from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { REBUILD_STATUS, RebuildStatus, LAST_REBUILD_ERROR, registerRefreshHandler } from '@/state/stores/manifest';
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingPendingLabel,
  setLoadingStepTail,
  openSourcePicker,
  closeSourcePicker,
  registerSourceApplier,
} from '@/state/stores/ui';
import { srcKind, SourceKind, labelFromUrl, labelFromManifest } from '@/utils/sources';
import { applyPendingTitle } from '@/utils/pendingTitle';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { LoadingStep } from '@/constants';
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
 * its phase-specific scene work. Returns the final manifest; throws if the
 * stream ends without yielding one.
 */
async function pumpManifestStream(
  url: string,
  onManifest: (manifest: Manifest, phase: ScanPhase.Skeleton | ScanPhase.Final) => Promise<void> | void
): Promise<Manifest> {
  let lastManifest: Manifest | null = null;
  let titleApplied = false;

  for await (const event of streamManifest(url)) {
    if (event.phase === ScanPhase.Error) throw new Error(event.error);

    if (!titleApplied && 'display_root' in event && event.display_root) {
      applyPendingTitle(event.display_root);
      setLoadingPendingLabel(labelFromUrl(event.display_root));
      titleApplied = true;
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

/** Start the render loop for `manifest`, publish the handle, and wire the
 *  settings-commit reactions. The three steps every scene-start path repeats. */
async function startScene(canvas: HTMLCanvasElement, manifest: Manifest): Promise<SceneHandle> {
  const handle = await startRenderLoop(canvas, manifest);
  SCENE_HANDLE.value = handle;
  attachCommitReactions({ world: handle.world, applyTheme: handle.applyTheme });
  return handle;
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

/** Build the building-roof icon atlas from a manifest and install it. Failures
 *  are non-fatal — roofs just render without glyphs. */
async function loadIconAtlas(manifest: Manifest): Promise<void> {
  try {
    const atlas = await buildIconAtlas(manifest);
    setIconAtlas(atlas);
    setCellIconAtlas(atlas);
  } catch (err) {
    console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
  }
}

/** Reflect the applied source in the page URL so reload/share reopens it. */
function syncUrlToSource(payload: SourcePayload): void {
  const url = new URL(window.location.href);
  url.searchParams.set('src', payload.src);
  if (payload.branch) url.searchParams.set('branch', payload.branch);
  else url.searchParams.delete('branch');
  url.searchParams.delete('git_window');
  history.replaceState(null, '', url.toString());
}

// ── Initial boot stream ──────────────────────────────────────────────

interface InitialStreamResult {
  manifest: Manifest;
  handle: SceneHandle;
  error: string | null;
}

/**
 * Run the initial manifest stream on cold boot. With no ?src, starts an empty
 * scene and returns immediately. Otherwise shows the loading overlay, builds the
 * scene from the first manifest event and applies later ones, and writes
 * SOURCE_INFO. On any failure the returned error is set and the scene falls back
 * to EMPTY_MANIFEST — a live scene handle is always returned.
 */
async function streamInitialManifest(canvas: HTMLCanvasElement): Promise<InitialStreamResult> {
  const qp = new URLSearchParams(window.location.search);
  const bootSrc = qp.get('src');

  if (!bootSrc) {
    const handle = await startScene(canvas, EMPTY_MANIFEST);
    return { manifest: EMPTY_MANIFEST, handle, error: null };
  }

  const bootBranch = qp.get('branch') ?? undefined;
  showLoadingOverlay({
    kind: srcKind(bootSrc),
    label: labelFromUrl(bootSrc) ?? bootSrc,
    branch: bootBranch,
  });

  let handle: SceneHandle | null = null;
  let manifest: Manifest = EMPTY_MANIFEST;
  let error: string | null = null;

  try {
    manifest = await pumpManifestStream(manifestUrl(), async (m) => {
      // Build the scene from the first manifest event, then apply later events
      // into it. The atlas only needs building once (from that first manifest).
      if (handle === null) {
        await loadIconAtlas(m);
        handle = await startScene(canvas, m);
      } else {
        _applyDisplayLabel(m);
        await handle.world.applyManifest(m);
      }
      setSourceInfo(bootSrc, m, resolveBranch(m, bootBranch).branch);
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // manifest stays EMPTY_MANIFEST (its initial value).
  } finally {
    hideLoadingOverlay();
  }

  // Guarantee a live scene exists even if the stream never produced one.
  if (handle === null) {
    handle = await startScene(canvas, EMPTY_MANIFEST);
  }

  return { manifest, handle, error };
}

// ── New-source stream (user-submitted via source picker) ─────────────

interface ApplyNewSourceOpts {
  handle: SceneHandle;
  payload: SourcePayload;
  pendingSkipCache: boolean;
  /** Existing live-updates handle if already running, null if not yet started. */
  liveUpdatesHandle: { setSignature(sig: string): void } | null;
  onLiveUpdatesStarted: (api: { setSignature(sig: string): void }) => void;
  onError: (opts: { dismissible: boolean; payload: SourcePayload; error: string }) => void;
}

/**
 * Stream a new source submitted from the source picker into the existing scene:
 * paint the skeleton as it arrives, then apply the final manifest and update the
 * URL, SOURCE_INFO, per-source persistence, and live-updates. Calls onError
 * (dismissible) if streaming fails.
 */
async function applyNewSource(opts: ApplyNewSourceOpts): Promise<void> {
  const { handle, payload, pendingSkipCache, liveUpdatesHandle, onLiveUpdatesStarted, onError } = opts;

  handle.world.resetCache();
  showLoadingOverlay({
    kind: srcKind(payload.src),
    label: labelFromUrl(payload.src) ?? payload.src,
    branch: payload.branch,
  });

  try {
    const url = manifestUrlFor({ src: payload.src, branch: payload.branch, noCache: pendingSkipCache });

    // Paint the skeleton as soon as it arrives so the user sees structure; the
    // final manifest (the pump's return value) carries real heights + signature
    // and is applied below.
    const manifest = await pumpManifestStream(url, async (m, phase) => {
      if (phase === ScanPhase.Skeleton) {
        _applyDisplayLabel(m);
        await handle.world.applyManifest(m);
        setSourceInfo(payload.src, m, payload.branch);
      }
    });

    syncUrlToSource(payload);
    // cameraRig resets the camera when the active source key changes.
    CURRENT_SOURCE_KEY.value = sourceKey(payload.src, payload.branch);

    await loadIconAtlas(manifest);
    _applyDisplayLabel(manifest);
    await handle.world.applyManifest(manifest);

    const { branch, isDefault } = resolveBranch(manifest, payload.branch);
    setSourceInfo(payload.src, manifest, branch);

    // Live updates: the first successful load starts the poll loop; later
    // source switches just hand the running loop the new signature.
    if (liveUpdatesHandle) {
      liveUpdatesHandle.setSignature(manifest.signature);
    } else {
      onLiveUpdatesStarted(setupLiveUpdates(handle, manifest.signature));
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
 * Start the live-update poll loop for the given scene handle. Two-stage poll:
 * each tick hits the cheap /signature endpoint and only fetches the full
 * manifest when it changed. Registers the manual-refresh chokepoint
 * (refreshManifest) and gates the timer on LIVE_UPDATES.ENABLED.
 */
function setupLiveUpdates(
  handle: SceneHandle,
  initialSignature: string
): { setSignature(sig: string): void } {
  let lastSignature = initialSignature || '';
  let timer: number | null = null;
  let inFlight = false;
  let needsRefresh = false;

  // Single fetch+apply path. Flips REBUILD_STATUS to 'rebuilding' for the
  // duration so the footer indicator behaves identically for poll + toggle.
  async function fetchAndApply(): Promise<void> {
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
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
          _applyDisplayLabel(m);
          await handle.world.applyManifest(m);
        }
      }
      REBUILD_STATUS.value = RebuildStatus.Idle;
      LAST_REBUILD_ERROR.value = null;
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
      do {
        needsRefresh = false;
        const sigResp = await fetch(signatureUrl());
        if (!sigResp.ok) break;
        const sig: SignatureResponse | null = await sigResp.json();
        if (!sig?.signature || sig.signature === lastSignature) break;
        await fetchAndApply();
      } while (needsRefresh);
    } catch (_) {
      // Signature-fetch errors (network blip on the cheap probe) are not
      // surfaced through REBUILD_STATUS — no rebuild attempt happened. The
      // next tick retries.
    } finally {
      inFlight = false;
    }
  }

  // Toggle/refresh handler: bypass the cheap check (the manifest WILL differ),
  // deferring to the inFlight gate so the two paths can't trample each other.
  async function refreshFromToggle(): Promise<void> {
    if (inFlight) {
      needsRefresh = true;
      return;
    }
    inFlight = true;
    try {
      do {
        needsRefresh = false;
        await fetchAndApply();
      } while (needsRefresh);
    } catch {
      /* keep polling */
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

  // The footer refresh button funnels through the same fetch+apply chain.
  registerRefreshHandler(refreshFromToggle);

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

// ── Boot sequence ────────────────────────────────────────────────────

async function bootCity(canvas: HTMLCanvasElement): Promise<() => void> {
  const qp = new URLSearchParams(window.location.search);
  if (qp.has('src')) {
    CURRENT_SOURCE_KEY.value = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);
  }

  const { manifest: initialManifest, handle, error: initialError } =
    await streamInitialManifest(canvas);

  const serverConfig = await getServerConfig();
  SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };

  let liveUpdates: { setSignature(sig: string): void } | null = null;
  if (qp.has('src') && !initialError && initialManifest !== EMPTY_MANIFEST) {
    liveUpdates = setupLiveUpdates(handle, initialManifest.signature);
  }

  // Wire the source-picker apply handler (was sourcePickerBridge). The picker
  // calls submitNewSource() → this applier; it needs the live scene + the
  // mutable live-updates handle, which only exist after boot.
  const disposeApplier = registerSourceApplier((payload) => {
    closeSourcePicker();
    applyNewSource({
      handle,
      payload,
      pendingSkipCache: !!payload.skipCache,
      liveUpdatesHandle: liveUpdates,
      onLiveUpdatesStarted(api) {
        liveUpdates = api;
      },
      onError({ dismissible, payload: errPayload, error }) {
        openSourcePicker({ dismissible, prefill: errPayload, error });
      },
    });
  });

  if (initialError) {
    openSourcePicker({
      dismissible: false,
      prefill: { src: qp.get('src')!, branch: qp.get('branch') ?? undefined },
      error: initialError,
    });
  } else if (!qp.has('src')) {
    openSourcePicker({ dismissible: false });
  }

  return function dispose() {
    disposeApplier();
    SCENE_HANDLE.value = null;
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Boot the city scene + manifest loading on mount, tear down on unmount.
 * CenterPane owns the <canvas> and passes its ref here.
 */
export function useCity(canvasRef: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    bootCity(canvas).then((d) => {
      if (cancelled) d();
      else dispose = d;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
}
