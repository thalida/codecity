// state/runtime/sourcePickerBridge.ts — Registers the apply-new-source handler that
// the picker UI invokes via submitNewSource(). The handler needs the live
// scene + live-update handles, which only exist after boot, so it's wired here
// rather than in the view. No window globals — the picker calls submitNewSource
// (uiState) and the header calls openSourcePickerForCurrentSource (uiState).
//
// installSourcePickerBridge() is called once from the boot orchestrator after
// streamInitialManifest() completes.

import { openSourcePicker, closeSourcePicker, registerSourceApplier } from './uiState';
import { applyNewSource } from './manifestStream';
import type { SceneHandle } from './scene';

export interface SourcePickerBridgeOpts {
  getHandle: () => SceneHandle;
  getLiveUpdatesHandle: () => { setSignature(sig: string): void } | null;
  onLiveUpdatesStarted: (api: { setSignature(sig: string): void }) => void;
}

/**
 * Register the apply-new-source handler. Returns a cleanup function that
 * unregisters it.
 */
export function installSourcePickerBridge(opts: SourcePickerBridgeOpts): () => void {
  return registerSourceApplier((payload) => {
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
  });
}
