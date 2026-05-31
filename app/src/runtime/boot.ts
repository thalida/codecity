// runtime/boot.ts — Full app boot sequence. Called from App.tsx's useEffect
// once the canvas is in the DOM. Composes all runtime modules and returns a
// dispose() for cleanup on unmount.

import './liveStatusBridge'; // self-installs its effect at module load

import { SYNTAX_THEME } from '../state/settings/prefs/syntaxTheme';
import { sourceKey, CURRENT_SOURCE_KEY } from '../state/runtime/sourceContext';
import { loadPerSourceState } from '../state/persist';
import { LAST_UPDATED_AT } from '../state/runtime/liveStatus';
import { openSourcePicker } from '../state/runtime/uiState';
import { getServerConfig } from '../api/config';
import { SERVER_CONFIG } from '../state/runtime/serverConfig';
import { setupLiveUpdates } from '../state/runtime/liveUpdates';
import { applyHljsTheme } from '../utils/syntaxTheme';
import { labelFromManifest } from '../utils/sources';
import { EMPTY_MANIFEST } from '../utils/emptyManifest';

import { streamInitialManifest } from './manifestStream';
import { installSourcePickerBridge } from './sourcePickerBridge';
import { setupSidebars } from './sidebarSetup';

export async function bootApp(): Promise<() => void> {
  SYNTAX_THEME.subscribe(applyHljsTheme);

  const qp = new URLSearchParams(window.location.search);
  if (qp.has('src')) {
    CURRENT_SOURCE_KEY.value = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);
    loadPerSourceState(CURRENT_SOURCE_KEY.value);
  }

  const canvas = document.getElementById('city') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[codecity] bootApp: #city canvas not found in DOM');
    return () => {};
  }

  const { manifest: initialManifest, handle, error: initialError } = await streamInitialManifest(canvas);

  const serverConfig = await getServerConfig();
  SERVER_CONFIG.value = { allowLocalRepos: serverConfig.allowLocalRepos };

  let _liveUpdates: { setSignature(sig: string): void } | null = null;
  if (qp.has('src') && !initialError && initialManifest !== EMPTY_MANIFEST) {
    _liveUpdates = setupLiveUpdates(handle, initialManifest.signature);
  }

  const sidebars = setupSidebars(handle, initialManifest);

  handle.world.onChange(() => {
    const m = handle.world.getManifest();
    const label = labelFromManifest(m) ?? m?.tree?.name ?? '';
    document.title = label ? `${label} — codecity` : 'codecity';
    LAST_UPDATED_AT.value = Date.now();
  });
  if (initialManifest !== EMPTY_MANIFEST) {
    const label = labelFromManifest(initialManifest) ?? initialManifest.tree?.name ?? '';
    document.title = label ? `${label} — codecity` : 'codecity';
    LAST_UPDATED_AT.value = Date.now();
  }

  const disposePickerBridge = installSourcePickerBridge({
    getHandle: () => handle,
    getLiveUpdatesHandle: () => _liveUpdates,
    onLiveUpdatesStarted(api) { _liveUpdates = api; },
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
    disposePickerBridge();
    sidebars.dispose();
  };
}
