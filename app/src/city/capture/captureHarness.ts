// city/capture/captureHarness.ts — debug-only. When the app is opened with
// ?shot=<name> (and debug mode is on), wait for the city to finish its first
// render, pose the camera for that shot, let the tween + effects settle, then
// mark <html data-cc-capture-ready="1"> so an external screenshot script knows
// the frame is ready. Lazy-loaded from main.tsx only when ?shot is present, so
// it never ships in a normal session. See app/scripts/screenshots.mjs.

import { effect } from '@preact/signals';

import { isDebugMode } from '@/utils/debugMode';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST, REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

import { SHOTS } from './shots';

// Camera tween + bloom ramp + ad-panel texture fades all settle well under this.
const SETTLE_MS = 2200;

export function initCaptureHarness(): void {
  const shot = new URLSearchParams(window.location.search).get('shot');
  if (!shot || !isDebugMode()) return;

  const pose = SHOTS[shot];
  if (!pose) {
    console.warn(`[capture] unknown shot "${shot}"; known: ${Object.keys(SHOTS).join(', ')}`);
    return;
  }

  let posed = false;
  const stop = effect(() => {
    const handle = SCENE_HANDLE.value;
    const manifest = MANIFEST.value as Manifest;
    if (
      posed ||
      !handle ||
      isEmptyManifest(manifest) ||
      REBUILD_STATUS.value !== RebuildStatus.Idle
    )
      return;
    posed = true;
    const h = handle; // non-null past the guard

    // Pose OUTSIDE the effect's tracking scope: it writes CAMERA (a signal) and
    // starts a rig tween, and a signal write inside the sync scope would cycle.
    queueMicrotask(() => {
      stop();
      pose(h, manifest);
      window.setTimeout(() => {
        document.documentElement.dataset.ccCaptureReady = '1';
      }, SETTLE_MS);
    });
  });
}
