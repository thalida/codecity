// appLogic.ts — Thin boot orchestrator. Delegates to focused runtime modules:
//   runtime/manifestStream.ts    — NDJSON streaming + scene init
//   runtime/liveStatusBridge.ts  — REBUILD_STATUS → loading overlay step
//   runtime/sourcePickerBridge.ts — window hook installation
//
// Called from App.tsx's useEffect. Returns a dispose() for cleanup.

import './runtime/liveStatusBridge'; // self-installs its effect at module load

import { SYNTAX_THEME } from './state/settings/prefs/syntaxTheme';
import { sourceKey, CURRENT_SOURCE_KEY } from './state/runtime/sourceContext';
import { loadPerSourceState } from './state/persist';
import { LAST_UPDATED_AT } from './state/runtime/liveStatus';
import { openSourcePicker } from './state/runtime/uiState';
import { getServerConfig } from './api/config';
import { SERVER_CONFIG } from './state/runtime/serverConfig';
import { setupLiveUpdates } from './state/runtime/liveUpdates';
import { NodeKind } from './types';

import { applyHljsTheme } from './utils/syntaxTheme';
import { labelFromManifest } from './utils/sources';
import { EMPTY_MANIFEST } from './utils/emptyManifest';

import { streamInitialManifest } from './runtime/manifestStream';
import { installSourcePickerBridge } from './runtime/sourcePickerBridge';

import { showLeftSidebar } from './views/shell/leftSidebar';
import { mountRightSidebarReactions } from './views/shell/rightSidebar';

export { applyPendingTitle } from './utils/pendingTitle';
export { EMPTY_MANIFEST } from './utils/emptyManifest';

export async function runAppLogic(): Promise<() => void> {
  // Pre-paint: syntax theme
  SYNTAX_THEME.subscribe(applyHljsTheme);

  // Per-source state hydration from URL params
  {
    const qp = new URLSearchParams(window.location.search);
    if (qp.has('src')) {
      CURRENT_SOURCE_KEY.value = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);
      loadPerSourceState(CURRENT_SOURCE_KEY.value);
    }
  }

  const canvas = document.getElementById('city') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[codecity] runAppLogic: #city canvas not found in DOM');
    return () => {};
  }

  // Stream initial manifest + start scene
  const { manifest: initialManifest, handle, error: initialError } = await streamInitialManifest(canvas);

  // Server config (needed by source picker)
  const serverConfig = await getServerConfig();
  SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };

  // Live updates — start after first successful source load
  let _liveUpdates: { setSignature(sig: string): void } | null = null;
  const qp = new URLSearchParams(window.location.search);
  if (qp.has('src') && !initialError && initialManifest !== EMPTY_MANIFEST) {
    _liveUpdates = setupLiveUpdates(handle, initialManifest.signature);
  }

  // Left sidebar
  const leftSidebarApi = showLeftSidebar(initialManifest, {
    onResetView() { handle.rig.reset(); },
    applyTheme: handle.applyTheme ?? (() => {}),
    onTreeSelect(node) {
      if (!node?.path) return;
      handle.picker.selectByPath(node.path);
    },
    onTreeFocus(node) {
      if (!node?.path) return;
      if (node.type === NodeKind.File) {
        const b = handle.world.getBuildingByPath(node.path);
        if (b) handle.rig.focusBuilding(b.mesh, b.building);
      } else if (node.type === NodeKind.Directory) {
        const st = handle.world.getStreetByDir(node.path);
        if (st) handle.rig.focusStreet(st, null);
      }
    },
    onTreeHover(node) {
      if (!node?.path) return;
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
    onTreeHoverEnd() { handle.picker.setHover(null); },
    onSearchSelect(path) { handle.picker.selectByPath(path); },
    onSearchFocus(path) {
      const b = handle.world.getBuildingByPath(path);
      if (b) handle.rig.focusBuilding(b.mesh, b.building);
    },
    onRunCollisionCheck: () => handle.world.runCollisionCheck(),
    onRunStemDiagnostic: () => handle.world.runStemPlacementDiagnostic(),
  });

  const disposeRightSidebar = mountRightSidebarReactions();

  // document.title management
  function _updateTitle(): void {
    const m = handle.world.getManifest();
    const label = labelFromManifest(m) ?? m?.tree?.name ?? '';
    document.title = label ? `${label} — codecity` : 'codecity';
  }
  _updateTitle();
  handle.world.onChange(() => {
    _updateTitle();
    LAST_UPDATED_AT.value = Date.now();
  });

  if (initialManifest !== EMPTY_MANIFEST) LAST_UPDATED_AT.value = Date.now();

  // Source picker bridge — installs window hooks for open/apply
  const disposeSourcePickerBridge = installSourcePickerBridge({
    getHandle: () => handle,
    getLiveUpdatesHandle: () => _liveUpdates,
    onLiveUpdatesStarted(api) {
      _liveUpdates = api;
    },
  });

  // Boot decisions: open source picker if no src or initial error
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
    disposeSourcePickerBridge();
    if (leftSidebarApi && 'dispose' in leftSidebarApi) {
      (leftSidebarApi as { dispose(): void }).dispose();
    }
    disposeRightSidebar();
  };
}
