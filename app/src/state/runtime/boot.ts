// state/runtime/boot.ts — Full app boot sequence. Called from <CenterPane />'s
// mount effect with the city <canvas> it owns; streams the initial manifest,
// wires the source-picker bridge and live updates, and returns a dispose() for
// cleanup on unmount.
//
// document.title + LAST_UPDATED_AT are derived from the canonical MANIFEST
// signal (useDocumentTitle hook + the LAST_UPDATED_AT effect in
// state/runtime/manifest.ts) — no imperative onChange handler here. The syntax
// theme is driven by <HljsThemeLink /> in App.tsx.

import { sourceKey, CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { setupLiveUpdates } from './manifestPoll';
import { openSourcePicker } from '@/state/stores/ui';
import { getServerConfig } from '@/api/config';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { streamInitialManifest } from './manifestStream';
import { installSourcePickerBridge } from './sourcePickerBridge';
import { SCENE_HANDLE } from '@/state/stores/scene';

export async function bootApp(canvas: HTMLCanvasElement): Promise<() => void> {
  const qp = new URLSearchParams(window.location.search);
  if (qp.has('src')) {
    CURRENT_SOURCE_KEY.value = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);
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
