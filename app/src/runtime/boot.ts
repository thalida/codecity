// runtime/boot.ts — Full app boot sequence. Called from App.tsx's useEffect
// once the canvas is in the DOM. Composes all runtime modules and returns a
// dispose() for cleanup on unmount.

import { sourceKey, CURRENT_SOURCE_KEY } from '../state/runtime/activeSource';
import { LAST_UPDATED_AT, setupLiveUpdates } from '../state/runtime/manifestPoll';
import { openSourcePicker } from '../state/runtime/uiState';
import { getServerConfig } from '../api/config';
import { SERVER_CONFIG } from '../state/runtime/serverConfig';
import { labelFromManifest } from '../utils/sources';
import { EMPTY_MANIFEST } from '../constants/manifest';

import { streamInitialManifest } from './manifestStream';
import { installSourcePickerBridge } from './sourcePickerBridge';
import { SCENE_HANDLE } from '../state/runtime/scene';

export async function bootApp(): Promise<() => void> {
  // Syntax theme is now driven by <HljsThemeLink /> in App.tsx — no subscribe
  // here. The link element follows SYNTAX_THEME.value automatically.

  const qp = new URLSearchParams(window.location.search);
  if (qp.has('src')) {
    CURRENT_SOURCE_KEY.value = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);
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
    SCENE_HANDLE.value = null;
  };
}
