// appLogic.ts — App-level orchestration: manifest streaming, source picker,
// loading overlay, live updates, commit reactions. Called from App.tsx once
// the canvas is in the DOM. Extracted from boot.ts (Phase 3e) so App.tsx
// composes real Preact components while this module owns the async flow.
//
// Differences vs boot.ts:
//   - UI visibility (loading overlay, source picker) goes through runtime
//     signals (SOURCE_PICKER, LOADING_OVERLAY) instead of imperative DOM.
//   - handle.coordinator is gone; SOURCE_INFO signal is written directly.
//   - showLeftSidebar and mountRightSidebarReactions are called here.
//   - Returns a dispose() so App.tsx can clean up on unmount.

import * as Config from './state/settings/index';
import { REBUILD_STATUS } from './state/runtime/liveStatus';
import { attachPersistence, persistAtomPerSource } from './state/persist';
import { SYNTAX_THEME } from './state/settings/prefs/syntaxTheme';
import { sourceKey, CURRENT_SOURCE_KEY } from './state/runtime/sourceContext';
import { attachCommitReactions } from './state/reactions';
import { setupLiveUpdates } from './state/runtime/liveUpdates';
import { SCENE_HANDLE } from './state/runtime/scene';
import { SOURCE_INFO } from './state/runtime/sourceInfo';
import {
  openSourcePicker,
  closeSourcePicker,
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingPendingLabel,
  setLoadingStepTail,
} from './state/runtime/uiState';
import { LAST_UPDATED_AT } from './state/runtime/liveStatus';
import { NodeKind } from './types';
import type { Manifest } from './types';

import { PICKER_SELECTION_KEY } from './scene/system/picker';
import { manifestUrl } from './api/manifest';
import { srcKind, labelFromUrl, labelFromManifest } from './utils/sources';
import { applyHljsTheme } from './utils/syntaxTheme';
import { buildIconAtlas } from './scene/components/buildings/iconAtlas';
import { setIconAtlas } from './scene/components/buildings/buildings';
import { setCellIconAtlas } from './scene/components/buildings/buildingsCell';
import { streamManifest } from './api/manifest';
import { pushRecent } from './state/runtime/sourceRecents';
import { startRenderLoop, _applyDisplayLabel } from './scene/renderLoop';
import { getServerConfig } from './api/config';
import { showLeftSidebar } from './views/shell/leftSidebar';
import { mountRightSidebarReactions } from './views/shell/rightSidebar';
import type { SourcePayload } from './views/components/sourcePicker';
import { SERVER_CONFIG } from './state/runtime/serverConfig';

export { applyPendingTitle, EMPTY_MANIFEST } from './boot';

/**
 * Run the full app boot sequence. Called from App.tsx's useEffect once the
 * canvas is in the DOM. Returns a dispose function that should be called on
 * unmount (though in practice App never unmounts for the page lifetime).
 */
export async function runAppLogic(): Promise<() => void> {
  // ── Pre-paint: hydrate config + syntax theme + source key ────────────────
  attachPersistence(Config);
  SYNTAX_THEME.subscribe(applyHljsTheme);

  {
    const qp = new URLSearchParams(window.location.search);
    if (qp.has('src')) {
      CURRENT_SOURCE_KEY.value = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);
    }
  }

  persistAtomPerSource('selection', PICKER_SELECTION_KEY, null);

  const qp = new URLSearchParams(window.location.search);
  const hasSrc = qp.has('src');

  // Forward REBUILD_STATUS → loading overlay so the card advances to
  // "Adding decorations" during applyManifest's deferred foliage phase.
  const _rebuildUnsub = REBUILD_STATUS.subscribe((s) => {
    if (s === 'decorating') setLoadingStep('decorating');
  });

  // ── Initial manifest stream ───────────────────────────────────────────────
  let initialManifest: Manifest = EMPTY_MANIFEST;
  let initialError: string | null = null;
  let handle: Awaited<ReturnType<typeof startRenderLoop>> | null = null;

  const canvas = document.getElementById('city') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[codecity] runAppLogic: #city canvas not found in DOM');
    // Dispose function — nothing to clean up
    return () => { _rebuildUnsub(); };
  }

  if (hasSrc) {
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
          setLoadingStep(event.phase);
          if (event.phase === 'cloning' && event.percent !== undefined) {
            const stage = event.stage ? ` (${event.stage})` : '';
            setLoadingStepTail('cloning', `${event.percent}%${stage}`);
          } else if (event.phase === 'scanning' && event.files_scanned !== undefined) {
            setLoadingStepTail('scanning', `${event.files_scanned.toLocaleString()} files`);
          }
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
  } else {
    handle = await startRenderLoop(canvas, EMPTY_MANIFEST);
    SCENE_HANDLE.value = handle;
    attachCommitReactions({ world: handle.world, applyTheme: handle.applyTheme });
  }

  // ── Left + right sidebar reactions ───────────────────────────────────────
  // showLeftSidebar self-subscribes to SCENE_HANDLE for tree highlights.
  const leftSidebarApi = showLeftSidebar(initialManifest, {
    onResetView() { handle?.rig.reset(); },
    applyTheme: handle?.applyTheme ?? (() => {}),
    onTreeSelect(node) {
      if (!node?.path) return;
      handle?.picker.selectByPath(node.path);
    },
    onTreeFocus(node) {
      if (!node?.path) return;
      if (node.type === NodeKind.File) {
        const b = handle?.world.getBuildingByPath(node.path);
        if (b) handle?.rig.focusBuilding(b.mesh, b.building);
      } else if (node.type === NodeKind.Directory) {
        const st = handle?.world.getStreetByDir(node.path);
        if (st) handle?.rig.focusStreet(st, null);
      }
    },
    onTreeHover(node) {
      if (!node?.path || !handle) return;
      if (node.type === NodeKind.File) {
        const b = handle.world.getBuildingByPath(node.path);
        if (!b) return;
        handle.picker.setHover({ kind: NodeKind.File, mesh: b.mesh, data: b.building, file: b.building.file });
      } else if (node.type === NodeKind.Directory) {
        const sw = handle.world.getSidewalkByDir(node.path);
        const st = handle.world.getStreetByDir(node.path);
        if (!sw || !st || !st.dir) return;
        handle.picker.setHover({ kind: NodeKind.Directory, sidewalk: sw, street: st, dir: st.dir });
      }
    },
    onTreeHoverEnd() { handle?.picker.setHover(null); },
    onSearchSelect(path) { handle?.picker.selectByPath(path); },
    onSearchFocus(path) {
      const b = handle?.world.getBuildingByPath(path);
      if (b) handle?.rig.focusBuilding(b.mesh, b.building);
    },
    onRunCollisionCheck: () => handle?.world.runCollisionCheck(),
    onRunStemDiagnostic: () => handle?.world.runStemPlacementDiagnostic(),
  });

  const disposeRightSidebar = mountRightSidebarReactions();

  // ── Live updates ──────────────────────────────────────────────────────────
  let liveUpdatesStarted = false;
  let _liveUpdates: { setSignature(sig: string): void } | null = null;
  if (hasSrc && !initialError) {
    _liveUpdates = setupLiveUpdates(handle!, initialManifest.signature);
    liveUpdatesStarted = true;
  }

  // Seed LAST_UPDATED_AT from the initial manifest apply
  if (initialManifest !== EMPTY_MANIFEST) LAST_UPDATED_AT.value = Date.now();

  // ── document.title management ─────────────────────────────────────────────
  function _updateTitle(): void {
    const m = handle?.world.getManifest();
    const label = labelFromManifest(m) ?? m?.tree?.name ?? '';
    document.title = label ? `${label} — codecity` : 'codecity';
  }
  _updateTitle();
  handle?.world.onChange(() => {
    _updateTitle();
    LAST_UPDATED_AT.value = Date.now();
  });

  // ── Source picker ─────────────────────────────────────────────────────────
  let _pendingSkipCache = false;
  let _lastDismissible = false;
  const serverConfig = await getServerConfig();
  SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };

  async function applyNewSource(payload: SourcePayload): Promise<void> {
    handle!.world.resetCache();
    const dismissibleOnError = _lastDismissible;
    showLoadingOverlay({
      kind: srcKind(payload.src),
      label: labelFromUrl(payload.src) ?? payload.src,
      branch: payload.branch,
    });
    try {
      const url = new URL('/api/manifest', window.location.origin);
      url.searchParams.set('src', payload.src);
      if (payload.branch) url.searchParams.set('branch', payload.branch);
      if (_pendingSkipCache) {
        url.searchParams.set('no_cache', 'true');
        _pendingSkipCache = false;
      }

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
          setLoadingStep(event.phase);
          if (event.phase === 'cloning' && event.percent !== undefined) {
            const stage = event.stage ? ` (${event.stage})` : '';
            setLoadingStepTail('cloning', `${event.percent}%${stage}`);
          } else if (event.phase === 'scanning' && event.files_scanned !== undefined) {
            setLoadingStepTail('scanning', `${event.files_scanned.toLocaleString()} files`);
          }
          continue;
        }
        setLoadingStepTail('cloning', null);
        setLoadingStepTail('scanning', null);
        setLoadingStep(event.phase === 'skeleton' ? 'skeleton' : 'building');
        if (event.phase === 'skeleton') {
          _applyDisplayLabel(event.manifest);
          await handle!.world.applyManifest(event.manifest);
          SOURCE_INFO.value = {
            label: labelFromManifest(event.manifest) ?? event.manifest.tree?.name ?? '',
            branch: payload.branch,
            sourceUrl: srcKind(payload.src) === 'git' ? payload.src : undefined,
          };
        }
        manifest = event.manifest;
      }
      if (!manifest) throw new Error('No manifest received');

      const pageUrl = new URL(window.location.href);
      pageUrl.searchParams.set('src', payload.src);
      if (payload.branch) pageUrl.searchParams.set('branch', payload.branch);
      else pageUrl.searchParams.delete('branch');
      pageUrl.searchParams.delete('git_window');
      history.replaceState(null, '', pageUrl.toString());

      CURRENT_SOURCE_KEY.value = sourceKey(payload.src, payload.branch);

      try {
        const _builtAtlas = await buildIconAtlas(manifest);
        setIconAtlas(_builtAtlas);
        setCellIconAtlas(_builtAtlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed', err);
      }

      _applyDisplayLabel(manifest);
      await handle!.world.applyManifest(manifest);

      const manifestBranch = manifest.repo.branch;
      const looksLikeRealBranch =
        !!manifestBranch &&
        !/\s/.test(manifestBranch) &&
        !manifestBranch.startsWith('(') &&
        !manifestBranch.startsWith('detached');
      const resolvedBranch =
        payload.branch ?? (looksLikeRealBranch ? manifestBranch! : undefined);
      const branchIsDefault = !payload.branch && looksLikeRealBranch;

      SOURCE_INFO.value = {
        label: labelFromManifest(manifest) ?? manifest.tree?.name ?? '',
        branch: resolvedBranch,
        sourceUrl: srcKind(payload.src) === 'git' ? payload.src : undefined,
      };

      _liveUpdates?.setSignature(manifest.signature);
      pushRecent({
        src: payload.src,
        branch: resolvedBranch,
        branchIsDefault,
        label: labelFromUrl(payload.src) ?? payload.src,
      });

      if (!liveUpdatesStarted) {
        _liveUpdates = setupLiveUpdates(handle!, manifest.signature);
        liveUpdatesStarted = true;
      }
    } catch (err) {
      openSourcePicker({
        dismissible: dismissibleOnError,
        prefill: payload,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    } finally {
      hideLoadingOverlay();
    }
  }

  // Wire source picker submit
  // The sourcePicker component reads SOURCE_PICKER signal and calls
  // onSubmit when the user submits. We store the handler on a module-level
  // so sourcePicker.tsx can call it. Instead, we expose it via window hook
  // (same pattern as before) for backward compat — Phase 8 removes it.
  (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker = () => {
    const cur = new URLSearchParams(window.location.search);
    _lastDismissible = true;
    openSourcePicker({
      dismissible: true,
      prefill: cur.has('src')
        ? { src: cur.get('src')!, branch: cur.get('branch') ?? undefined }
        : undefined,
    });
  };

  // Boot decisions: open source picker or leave overlay hidden
  if (initialError) {
    _lastDismissible = false;
    openSourcePicker({
      dismissible: false,
      prefill: { src: qp.get('src')!, branch: qp.get('branch') ?? undefined },
      error: initialError,
    });
  } else if (!hasSrc) {
    _lastDismissible = false;
    openSourcePicker({ dismissible: false });
  }

  // Store for SourcePicker's onSubmit. The SourcePicker component reads
  // SOURCE_PICKER signal; when the user submits, it needs to call
  // applyNewSource. We expose a global hook for the signal-based picker to call.
  (window as Window & { __applyNewSource?: (payload: SourcePayload) => void }).__applyNewSource =
    (payload: SourcePayload) => {
      _pendingSkipCache = !!payload.skipCache;
      closeSourcePicker();
      applyNewSource(payload);
    };

  return function dispose() {
    _rebuildUnsub();
    if (leftSidebarApi && 'dispose' in leftSidebarApi) {
      (leftSidebarApi as { dispose(): void }).dispose();
    }
    disposeRightSidebar();
    SCENE_HANDLE.value = null;
  };
}

function applyPendingTitle(displayRoot: string): void {
  const label = labelFromUrl(displayRoot);
  document.title = label ? `${label} (pending) — codecity` : 'codecity';
}

const EMPTY_MANIFEST: Manifest = {
  root: '',
  scanned_at: new Date().toISOString(),
  signature: '',
  tree_signature: '',
  tree: {
    name: '',
    type: NodeKind.Directory,
    path: '',
    fullPath: '',
    children: [],
    children_count: 0,
    children_file_count: 0,
    children_dir_count: 0,
    descendants_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
  },
  repo: {
    branch: null,
    remote_url: null,
    head_sha: null,
    head_subject: null,
    dirty: false,
  },
  commits: [],
};
