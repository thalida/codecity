// runtime/liveStatusBridge.ts — Bridges REBUILD_STATUS → LOADING_OVERLAY.
// When the world's decoration pass starts, REBUILD_STATUS transitions to
// 'decorating'; this effect advances the loading overlay's active step to
// 'decorating' so users see "Adding decorations…" during that phase.
//
// The effect is installed at module-load time so it runs before App boots.
// Self-contained: no exports, no external callers.

import { effect } from '@preact/signals';
import { REBUILD_STATUS } from '../state/runtime/liveStatus';
import { setLoadingStep } from '../state/runtime/uiState';

effect(() => {
  if (REBUILD_STATUS.value === 'decorating') {
    setLoadingStep('decorating');
  }
});
