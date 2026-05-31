// runtime/manifestStream.ts — Owns the NDJSON streaming loop for manifest
// fetches. Called during initial boot and on each user-submitted new source.
// Writes LOADING_OVERLAY signals as phases arrive; starts the render loop
// on the first manifest event; writes SCENE_HANDLE + SOURCE_INFO.

import { SCENE_HANDLE } from '../state/runtime/scene';
import { SOURCE_INFO } from '../state/runtime/sourceInfo';
import { savePerSourceState, loadPerSourceState } from '../state/persist';
import { sourceKey, CURRENT_SOURCE_KEY } from '../state/runtime/sourceContext';
import { attachCommitReactions } from '../state/reactions';
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingPendingLabel,
  setLoadingStepTail,
} from '../state/runtime/uiState';
import type { Manifest } from '../types';

import { manifestUrl } from '../api/manifest';
import { streamManifest } from '../api/manifest';
import { srcKind, labelFromUrl, labelFromManifest } from '../utils/sources';
import { applyPendingTitle } from '../utils/pendingTitle';
import { EMPTY_MANIFEST } from '../utils/emptyManifest';
import { buildIconAtlas } from '../scene/components/buildings/iconAtlas';
import { setIconAtlas } from '../scene/components/buildings/buildings';
import { setCellIconAtlas } from '../scene/components/buildings/buildingsCell';
import { startRenderLoop, _applyDisplayLabel } from '../scene/renderLoop';
import { pushRecent } from '../state/runtime/sourceRecents';
import { setupLiveUpdates } from '../state/runtime/liveUpdates';
import type { SourcePayload } from '../views/components/sourcePicker';

export type SceneHandle = Awaited<ReturnType<typeof startRenderLoop>>;

// ── Shared progress-event helpers ────────────────────────────────────────────

function _handleProgressEvent(event: { phase: string; percent?: number; stage?: string; files_scanned?: number }): void {
  if (event.phase === 'cloning') {
    setLoadingStep('cloning');
    if (event.percent !== undefined) {
      const stage = event.stage ? ` (${event.stage})` : '';
      setLoadingStepTail('cloning', `${event.percent}%${stage}`);
    }
  } else if (event.phase === 'scanning') {
    setLoadingStep('scanning');
    if (event.files_scanned !== undefined) {
      setLoadingStepTail('scanning', `${event.files_scanned.toLocaleString()} files`);
    }
  }
}

// ── Initial boot stream ───────────────────────────────────────────────────────

export interface InitialStreamResult {
  manifest: Manifest;
  handle: SceneHandle;
  error: string | null;
}

/**
 * Run the initial manifest stream on cold boot. Reads ?src from the current
 * URL, shows the loading overlay, builds the scene on first manifest event,
 * and writes SOURCE_INFO. Returns the final manifest, scene handle, and any
 * error string (on error, the scene is started with EMPTY_MANIFEST).
 *
 * If no ?src param is present, starts the render loop with EMPTY_MANIFEST
 * and returns immediately with no error.
 */
export async function streamInitialManifest(canvas: HTMLCanvasElement): Promise<InitialStreamResult> {
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
      setLoadingStepTail('cloning', null);
      setLoadingStepTail('scanning', null);
      setLoadingStep(event.phase === 'skeleton' ? 'skeleton' : 'building');

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
        sourceUrl: srcKind(_bootSrc) === 'git' ? _bootSrc : undefined,
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

// ── New-source stream (user-submitted via source picker) ──────────────────────

export interface ApplyNewSourceOpts {
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
 * SOURCE_INFO, URL params, and per-source persistence. Manages live-updates
 * startup. Calls onError (with dismissible=false) if streaming fails.
 */
export async function applyNewSource(opts: ApplyNewSourceOpts): Promise<void> {
  const { handle, payload, pendingSkipCache, liveUpdatesHandle, onLiveUpdatesStarted, onError } = opts;

  handle.world.resetCache();
  showLoadingOverlay({
    kind: srcKind(payload.src),
    label: labelFromUrl(payload.src) ?? payload.src,
    branch: payload.branch,
  });

  try {
    const url = new URL('/api/manifest', window.location.origin);
    url.searchParams.set('src', payload.src);
    if (payload.branch) url.searchParams.set('branch', payload.branch);
    if (pendingSkipCache) url.searchParams.set('no_cache', 'true');

    let manifest: Manifest | null = null;
    let _pendingTitleSet = false;

    for await (const event of streamManifest(url.toString())) {
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

      setLoadingStepTail('cloning', null);
      setLoadingStepTail('scanning', null);
      setLoadingStep(event.phase === 'skeleton' ? 'skeleton' : 'building');

      if (event.phase === 'skeleton') {
        _applyDisplayLabel(event.manifest);
        await handle.world.applyManifest(event.manifest);
        SOURCE_INFO.value = {
          label: labelFromManifest(event.manifest) ?? event.manifest.tree?.name ?? '',
          branch: payload.branch,
          sourceUrl: srcKind(payload.src) === 'git' ? payload.src : undefined,
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

    // Per-source persistence
    savePerSourceState(CURRENT_SOURCE_KEY.value);
    CURRENT_SOURCE_KEY.value = sourceKey(payload.src, payload.branch);
    loadPerSourceState(CURRENT_SOURCE_KEY.value);

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
      sourceUrl: srcKind(payload.src) === 'git' ? payload.src : undefined,
    };

    // Live updates — start on first successful load, or update signature on switch
    if (liveUpdatesHandle !== null) {
      // Already running; update the signature baseline so the next poll
      // skips a redundant fetch of a manifest we just applied.
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

