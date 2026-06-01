// runtime/boot.ts — Full app boot sequence. Called from App.tsx's useEffect
// once the canvas is in the DOM. Composes all runtime modules and returns a
// dispose() for cleanup on unmount.

import { sourceKey, CURRENT_SOURCE_KEY } from '../state/runtime/activeSource';
import { setupLiveUpdates } from '../state/runtime/manifestPoll';
import { openSourcePicker } from '../state/runtime/uiState';
import { getServerConfig } from '../api/config';
import { SERVER_CONFIG } from '../state/runtime/serverConfig';
import { EMPTY_MANIFEST } from '../constants/manifest';
// document.title + LAST_UPDATED_AT are now derived from the canonical MANIFEST
// signal (useDocumentTitle hook + the LAST_UPDATED_AT effect in
// state/runtime/manifest.ts) — no imperative onChange handler here.

import { streamInitialManifest } from '../state/runtime/manifestStream';
import { installSourcePickerBridge } from '../state/runtime/sourcePickerBridge';
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
