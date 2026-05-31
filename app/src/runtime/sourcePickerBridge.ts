// runtime/sourcePickerBridge.ts — Installs the window.__openSourcePicker and
// window.__applyNewSource hooks that view code (AppHeader, SourcePicker) calls.
//
// These hooks are set during app boot (after the scene handle and server config
// are available). The window hooks remain for now; removal is tracked as #20.
//
// installSourcePickerBridge() is called once from the boot orchestrator after
// streamInitialManifest() completes.

import { openSourcePicker, closeSourcePicker } from '../state/runtime/uiState';
import type { SourcePayload } from '../views/components/sourcePicker';
import { applyNewSource } from './manifestStream';
import type { SceneHandle } from './manifestStream';

export interface SourcePickerBridgeOpts {
  getHandle: () => SceneHandle;
  getLiveUpdatesHandle: () => { setSignature(sig: string): void } | null;
  onLiveUpdatesStarted: (api: { setSignature(sig: string): void }) => void;
}

/**
 * Install the __openSourcePicker and __applyNewSource window hooks.
 * Returns a cleanup function that unregisters them.
 */
export function installSourcePickerBridge(opts: SourcePickerBridgeOpts): () => void {
  (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker = () => {
    const cur = new URLSearchParams(window.location.search);
    openSourcePicker({
      dismissible: true,
      prefill: cur.has('src')
        ? { src: cur.get('src')!, branch: cur.get('branch') ?? undefined }
        : undefined,
    });
  };

  (window as Window & { __applyNewSource?: (payload: SourcePayload) => void }).__applyNewSource = (
    payload: SourcePayload
  ) => {
    closeSourcePicker();
    applyNewSource({
      handle: opts.getHandle(),
      payload,
      pendingSkipCache: !!payload.skipCache,
      liveUpdatesHandle: opts.getLiveUpdatesHandle(),
      onLiveUpdatesStarted: opts.onLiveUpdatesStarted,
      onError({ dismissible, payload: errPayload, error }) {
        openSourcePicker({
          dismissible,
          prefill: errPayload,
          error,
        });
      },
    });
  };

  return () => {
    delete (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker;
    delete (window as Window & { __applyNewSource?: (payload: SourcePayload) => void })
      .__applyNewSource;
  };
}
