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

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { effect } from '@preact/signals';

import { manifestUrl, manifestUrlFor, signatureUrl, streamManifest } from '@/api/manifest';
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
import { REBUILD_STATUS, LAST_REBUILD_ERROR, registerRefreshHandler } from '@/state/stores/manifest';
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

// ── Shared progress-event helper ─────────────────────────────────────

function _handleProgressEvent(event: {
  phase: string;
  percent?: number;
  stage?: string;
  files_scanned?: number;
}): void {
  if (event.phase === 'cloning') {
    setLoadingStep(LoadingStep.Cloning);
    if (event.percent !== undefined) {
      const stage = event.stage ? ` (${event.stage})` : '';
      setLoadingStepTail(LoadingStep.Cloning, `${event.percent}%${stage}`);
    }
  } else if (event.phase === 'scanning') {
    setLoadingStep(LoadingStep.Scanning);
    if (event.files_scanned !== undefined) {
      setLoadingStepTail(LoadingStep.Scanning, `${event.files_scanned.toLocaleString()} files`);
    }
  }
}

// ── Initial boot stream ──────────────────────────────────────────────

interface InitialStreamResult {
  manifest: Manifest;
  handle: SceneHandle;
  error: string | null;
}

/**
 * Run the initial manifest stream on cold boot. Reads ?src from the URL, shows
 * the loading overlay, builds the scene on the first manifest event, and writes
 * SOURCE_INFO. Returns the final manifest, scene handle, and any error (on
 * error the scene is started with EMPTY_MANIFEST). With no ?src, starts the
 * render loop empty and returns immediately.
 */
async function streamInitialManifest(canvas: HTMLCanvasElement): Promise<InitialStreamResult> {
  const qp = new URLSearchParams(window.location.search);
  const hasSrc = qp.has('src');

  let initialManifest: Manifest = EMPTY_MANIFEST;
  let initialError: string | null = null;
  let handle: SceneHandle | null = null;

  if (!hasSrc) {
    handle = await startRenderLoop(canvas, EMPTY_MANIFEST);
    SCENE_HANDLE.value = handle;
    attachCommitReactions({ world: handle.world, applyTheme: handle.applyTheme });
    return { manifest: initialManifest, handle, error: null };
  }

  const _bootSrc = qp.get('src')!;
  const _bootBranch = qp.get('branch') ?? undefined;

  showLoadingOverlay({
    kind: srcKind(_bootSrc),
    label: labelFromUrl(_bootSrc) ?? _bootSrc,
    branch: _bootBranch,
  });

  try {
    let _pendingTitleSet = false;
    for await (const event of streamManifest(manifestUrl())) {
      if (event.phase === 'error') throw new Error(event.error);

      if (!_pendingTitleSet && 'display_root' in event && event.display_root) {
        applyPendingTitle(event.display_root);
        setLoadingPendingLabel(labelFromUrl(event.display_root));
        _pendingTitleSet = true;
      }

      if (event.phase === 'cloning' || event.phase === 'scanning') {
        _handleProgressEvent(event);
        continue;
      }

      const m = event.manifest;
      setLoadingStepTail(LoadingStep.Cloning, null);
      setLoadingStepTail(LoadingStep.Scanning, null);
      setLoadingStep(event.phase === 'skeleton' ? LoadingStep.Skeleton : LoadingStep.Building);

      if (handle === null) {
        try {
          const _builtAtlas = await buildIconAtlas(m);
          setIconAtlas(_builtAtlas);
          setCellIconAtlas(_builtAtlas);
        } catch (err) {
          console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
        }
        handle = await startRenderLoop(canvas, m);
        SCENE_HANDLE.value = handle;
        attachCommitReactions({ world: handle.world, applyTheme: handle.applyTheme });
      } else {
        _applyDisplayLabel(m);
        await handle.world.applyManifest(m);
      }
      initialManifest = m;

      // Populate SOURCE_INFO so AppHeader renders its project chip.
      const _manifestBranch = m.repo.branch;
      const _looksLikeRealBranch =
        !!_manifestBranch &&
        !/\s/.test(_manifestBranch) &&
        !_manifestBranch.startsWith('(') &&
        !_manifestBranch.startsWith('detached');
      const _resolvedBranch = _bootBranch ?? (_looksLikeRealBranch ? _manifestBranch! : undefined);
      SOURCE_INFO.value = {
        label: labelFromManifest(m) ?? m.tree?.name ?? '',
        branch: _resolvedBranch,
        sourceUrl: srcKind(_bootSrc) === SourceKind.Git ? _bootSrc : undefined,
      };
    }
    if (handle === null) throw new Error('No manifest received');
  } catch (err) {
    initialError = err instanceof Error ? err.message : String(err);
    if (handle === null) {
      handle = await startRenderLoop(canvas, EMPTY_MANIFEST);
      SCENE_HANDLE.value = handle;
      attachCommitReactions({ world: handle.world, applyTheme: handle.applyTheme });
    }
    initialManifest = EMPTY_MANIFEST;
  } finally {
    hideLoadingOverlay();
  }

  return { manifest: initialManifest, handle: handle!, error: initialError };
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
 * Stream a new source submitted from the source picker. Updates the scene,
 * SOURCE_INFO, URL params, and per-source persistence; manages live-updates
 * startup. Calls onError (dismissible) if streaming fails.
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
    const url = manifestUrlFor({
      src: payload.src,
      branch: payload.branch,
      noCache: pendingSkipCache,
    });

    let manifest: Manifest | null = null;
    let _pendingTitleSet = false;

    for await (const event of streamManifest(url)) {
      if (event.phase === 'error') throw new Error(event.error);

      if (!_pendingTitleSet && 'display_root' in event && event.display_root) {
        applyPendingTitle(event.display_root);
        setLoadingPendingLabel(labelFromUrl(event.display_root));
        _pendingTitleSet = true;
      }

      if (event.phase === 'cloning' || event.phase === 'scanning') {
        _handleProgressEvent(event);
        continue;
      }

      setLoadingStepTail(LoadingStep.Cloning, null);
      setLoadingStepTail(LoadingStep.Scanning, null);
      setLoadingStep(event.phase === 'skeleton' ? LoadingStep.Skeleton : LoadingStep.Building);

      if (event.phase === 'skeleton') {
        _applyDisplayLabel(event.manifest);
        await handle.world.applyManifest(event.manifest);
        SOURCE_INFO.value = {
          label: labelFromManifest(event.manifest) ?? event.manifest.tree?.name ?? '',
          branch: payload.branch,
          sourceUrl: srcKind(payload.src) === SourceKind.Git ? payload.src : undefined,
        };
      }
      manifest = event.manifest;
    }
    if (!manifest) throw new Error('No manifest received');

    // Update URL
    const pageUrl = new URL(window.location.href);
    pageUrl.searchParams.set('src', payload.src);
    if (payload.branch) pageUrl.searchParams.set('branch', payload.branch);
    else pageUrl.searchParams.delete('branch');
    pageUrl.searchParams.delete('git_window');
    history.replaceState(null, '', pageUrl.toString());

    // Track the active source key (cameraRig resets the camera on change).
    CURRENT_SOURCE_KEY.value = sourceKey(payload.src, payload.branch);

    // Icon atlas
    try {
      const _builtAtlas = await buildIconAtlas(manifest);
      setIconAtlas(_builtAtlas);
      setCellIconAtlas(_builtAtlas);
    } catch (err) {
      console.warn('[codecity] icon atlas build failed', err);
    }

    // Final manifest apply
    _applyDisplayLabel(manifest);
    await handle.world.applyManifest(manifest);

    const manifestBranch = manifest.repo.branch;
    const looksLikeRealBranch =
      !!manifestBranch &&
      !/\s/.test(manifestBranch) &&
      !manifestBranch.startsWith('(') &&
      !manifestBranch.startsWith('detached');
    const resolvedBranch = payload.branch ?? (looksLikeRealBranch ? manifestBranch! : undefined);
    const branchIsDefault = !payload.branch && looksLikeRealBranch;

    SOURCE_INFO.value = {
      label: labelFromManifest(manifest) ?? manifest.tree?.name ?? '',
      branch: resolvedBranch,
      sourceUrl: srcKind(payload.src) === SourceKind.Git ? payload.src : undefined,
    };

    // Live updates — start on first successful load, or update signature on switch
    if (liveUpdatesHandle !== null) {
      liveUpdatesHandle.setSignature(manifest.signature);
    } else {
      const liveApi = setupLiveUpdates(handle, manifest.signature);
      onLiveUpdatesStarted(liveApi);
    }

    pushRecent({
      src: payload.src,
      branch: resolvedBranch,
      branchIsDefault,
      label: labelFromUrl(payload.src) ?? payload.src,
    });
  } catch (err) {
    onError({
      dismissible: true,
      payload,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
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
 * (refreshManifest) and arms a LIVE_UPDATES.ENABLED effect to start/stop.
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
    REBUILD_STATUS.value = 'rebuilding';
    try {
      for await (const event of streamManifest(manifestUrl())) {
        if (event.phase === 'error') throw new Error(event.error);
        // Live-update path: skip skeleton. The city is already drawn; applying
        // a skeleton would animate every building to placeholder heights and
        // back on every save. Only the final tweens into the new state.
        if (event.phase !== 'final') continue;
        const m = event.manifest;
        if (m?.signature) {
          lastSignature = m.signature;
          _applyDisplayLabel(m);
          await handle.world.applyManifest(m);
        }
      }
      REBUILD_STATUS.value = 'idle';
      LAST_REBUILD_ERROR.value = null;
    } catch (err) {
      REBUILD_STATUS.value = 'error';
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

  // Register the manual-refresh entrypoint (footer refresh button) so it
  // funnels through the same fetch+apply chain.
  registerRefreshHandler(refreshFromToggle);

  // effect() fires synchronously on call; arm AFTER registering so the initial
  // synthetic fire is suppressed (same pattern as attachCommitReactions).
  let _liveUpdatesArmed = false;
  effect(() => {
    const val = LIVE_UPDATES.value;
    if (!_liveUpdatesArmed) return;
    if (val.ENABLED) start();
    else stop();
  });
  _liveUpdatesArmed = true;
  if (LIVE_UPDATES.value.ENABLED) start();

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
